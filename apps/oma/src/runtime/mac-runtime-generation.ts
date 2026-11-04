/** Private installed-byte generation. Scope retirement, rather than child EOF
 * or a caller-supplied death predicate, controls when its flags may be cleared. */
import { closeSync, constants, fchmodSync, fstatSync, fsyncSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { snapshotCommand, type CommandSpec } from "@oma/process/command";
import { ExecutionNotStarted, type BlockedExecution } from "@oma/process/owned-execution";
import { launchDarwinJobScope, launchSeatbeltJobScope, type DarwinJobScopeOptions } from "@oma/platform-mac/job-scope";
import type { SeatbeltPolicy } from "@oma/platform-mac/seatbelt";
import type { DarwinCoalitionIdentity } from "@oma/native/audit-session";
import { openBeneath, openDirectory, openRegularBeneath } from "@oma/native/files";
import { assertHostDirectoryLayout } from "@oma/native/directory-layout";
import { setDarwinUserImmutable, darwinOwnedEntryFlags } from "@oma/native/darwin-file-flags";
import { symlinkAt } from "@oma/native/posix-files";
import { mkdirAt, reopenDirectory } from "@oma/file-descriptors";
import { copyDescriptorToEntry } from "@oma/storage/file-digest";
import { removeOwnedTreeAt } from "@oma/storage/directory";
import { cleanupAll, withCleanup } from "@oma/native/cleanup";
import { StoreError } from "@oma/domain/errors";
import { isDeploymentDigest } from "@oma/domain/deployment";
import { deploymentManifest } from "./deployment-manifest.js";

type Identity = { readonly dev: bigint; readonly ino: bigint };
type Entry = Identity & { readonly path: string; readonly directory: boolean };
export interface MacRuntimeGeneration {
  readonly root: string;
  readonly node: string;
  /** Only a selected installed JS entry can precede application arguments. */
  launchNode(source: CommandSpec, options?: DarwinJobScopeOptions, policy?: SeatbeltPolicy): Promise<BlockedExecution<DarwinCoalitionIdentity>>;
  /** Refuses while any acquired or uncertain scope still holds this tree. */
  close(): void;
}
function refused(message: string, cause?: unknown): never { throw new StoreError("UNSUPPORTED_PROFILE", message, { cause }); }
function canonical(path: string): boolean {
  return path.length > 0 && !path.includes("\\") && !path.includes("\0") &&
    path.split("/").every(part => part !== "" && part !== "." && part !== "..");
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
/** The caller supplies an already owned private parent, outside Actor writable
 * roots. No configured digest or accepted state is rewritten. This producer
 * is not yet the startup/recovery collector for orphaned generations. */
export function createMacRuntimeGeneration(sourceInstallation: {
  readonly libdir: string; readonly node: string; readonly deploymentDigest: string;
}, parent: string): MacRuntimeGeneration {
  if (process.platform !== "darwin") refused("private immutable runtime generations require Darwin");
  const installation = Object.freeze({ ...sourceInstallation });
  if (!isDeploymentDigest(installation.deploymentDigest) || resolve(parent) !== parent || resolve(installation.libdir) !== installation.libdir ||
      resolve(installation.node) !== installation.node)
    refused("runtime generation requires canonical roots and a trusted digest");
  for (const path of [parent, installation.libdir, dirname(installation.node)]) assertHostDirectoryLayout(path);
  const manifest = deploymentManifest(installation.libdir);
  if (digest(manifest) !== installation.deploymentDigest) refused("runtime generation source differs from deploymentDigest");
  const paths = [...manifest.files.map(file => file.path), ...manifest.directories, ...manifest.links.map(link => link.path)];
  if (paths.some(path => !canonical(path))) refused("runtime generation contains a noncanonical entry");
  const parentFd = openDirectory(parent), name = ".oma-runtime-" + randomUUID(), root = join(parent, name), entries: Entry[] = [];
  let sourceFd: number | undefined, held: number | undefined, created = false, closed = false, active = 0, uncertain = false;
  let parentOpen = true, returnFailure: unknown;
  const closeSource = (): void => { if (sourceFd !== undefined) { const fd = sourceFd; sourceFd = undefined; closeSync(fd); } };
  const closeRoot = (): void => { if (held !== undefined) { const fd = held; held = undefined; closeSync(fd); } };
  const closeParent = (): void => { if (parentOpen) { parentOpen = false; closeSync(parentFd); } };
  const identity = (fd: number): Identity => { const stat = fstatSync(fd, { bigint: true }); return { dev: stat.dev, ino: stat.ino }; };
  const same = (fd: number, entry: Identity): boolean => { const actual = identity(fd); return actual.dev === entry.dev && actual.ino === entry.ino; };
  const heldEntry = (path: string, directory: boolean): number => path === "." ? reopenDirectory(held!) : directory ?
    openBeneath(held!, path, constants.O_RDONLY | constants.O_DIRECTORY) : openRegularBeneath(held!, path);
  const record = (path: string, directory: boolean): void => {
    const fd = heldEntry(path, directory); withCleanup(() => entries.push({ path, directory, ...identity(fd) }), () => closeSync(fd));
  };
  const cleanup = (): void => {
    const failures: unknown[] = [];
    for (const entry of entries) try {
      const fd = heldEntry(entry.path, entry.directory);
      withCleanup(() => {
        if (!same(fd, entry)) throw new Error("runtime generation entry changed before return");
        if (darwinOwnedEntryFlags(fd) & 2) setDarwinUserImmutable(fd, false);
      }, () => closeSync(fd));
    } catch (error) { failures.push(error); }
    if (failures.length) throw new StoreError("RUN_TERMINATION_UNKNOWN", "runtime generation flags could not be returned", { cause: new AggregateError(failures) });
    if (created) {
      const actual = openBeneath(parentFd, name, constants.O_RDONLY | constants.O_DIRECTORY);
      withCleanup(() => { if (!same(actual, identity(held!))) throw new Error("runtime generation root changed"); }, () => closeSync(actual));
      removeOwnedTreeAt(parentFd, name); created = false;
    }
  };
  try {
    const owner = fstatSync(parentFd);
    if (owner.uid !== process.getuid?.() || (owner.mode & 0o077) !== 0) refused("runtime generation parent must be private and owned");
    sourceFd = openDirectory(installation.libdir);
    mkdirAt(parentFd, name, 0o700); created = true;
    held = openBeneath(parentFd, name, constants.O_RDONLY | constants.O_DIRECTORY); record(".", true);
    const directories = new Set(manifest.directories);
    for (const path of paths) for (let part = dirname(path); part !== "."; part = dirname(part)) directories.add(part);
    for (const path of [...directories].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))) {
      const fd = dirname(path) === "." ? held : heldEntry(dirname(path), true);
      withCleanup(() => mkdirAt(fd!, basename(path), 0o700), () => { if (fd !== held) closeSync(fd!); }); record(path, true);
    }
    const copy = (source: number, path: string, expected?: { readonly bytes: number; readonly sha256: string }): void => {
      const parent = dirname(path) === "." ? held! : heldEntry(dirname(path), true);
      withCleanup(() => {
        const result = copyDescriptorToEntry(source, parent, basename(path), { flushParent: false }); record(path, false);
        if (expected !== undefined && (result.bytes !== expected.bytes || result.sha256 !== expected.sha256))
          refused("copied runtime byte differs from its trusted inventory");
        const fd = openRegularBeneath(parent, basename(path));
        withCleanup(() => fchmodSync(fd, 0o400 | (fstatSync(source).mode & 0o111 ? 0o100 : 0)), () => closeSync(fd));
      }, () => { if (parent !== held) closeSync(parent); });
    };
    for (const file of manifest.files) {
      const fd = openRegularBeneath(sourceFd, file.path); withCleanup(() => copy(fd, file.path, file), () => closeSync(fd));
    }
    closeSource();
    for (const link of manifest.links) {
      const fd = dirname(link.path) === "." ? held : heldEntry(dirname(link.path), true);
      withCleanup(() => symlinkAt(relative(dirname(join(root, link.path)), join(root, link.target)), fd!, basename(link.path)),
        () => { if (fd !== held) closeSync(fd!); });
    }
    mkdirAt(held, ".oma-node-bin", 0o700); record(".oma-node-bin", true);
    const node = join(root, ".oma-node-bin/node"), nodeParent = openDirectory(dirname(installation.node));
    // Node source ownership is independent of the disposable output ownership.
    withCleanup(() => {
      const nodeSource = openRegularBeneath(nodeParent, basename(installation.node));
      withCleanup(() => {
        const stat = fstatSync(nodeSource);
        if (stat.size < 1 || stat.size > 268435456 || !(stat.mode & 0o111)) refused("selected Node is not a bounded executable");
        copy(nodeSource, ".oma-node-bin/node");
      }, () => closeSync(nodeSource));
    }, () => closeSync(nodeParent));
    if (digest(deploymentManifest(root)) !== installation.deploymentDigest) refused("private runtime inventory differs after copy");
    for (const entry of [...entries].reverse()) {
      const fd = heldEntry(entry.path, entry.directory);
      withCleanup(() => { setDarwinUserImmutable(fd, true); if (entry.directory) fsyncSync(fd); }, () => closeSync(fd));
    }
    const installedEntries = new Set(manifest.files.filter(file => /\.(?:js|mjs|cjs)$/.test(file.path)).map(file => join(installation.libdir, file.path)));
    const privateEntries = new Set([...installedEntries].map(path => join(root, relative(installation.libdir, path))));
    return Object.freeze({ root, node,
      async launchNode(input: CommandSpec, options: DarwinJobScopeOptions = {}, policy?: SeatbeltPolicy) {
        let source: CommandSpec;
        try { source = snapshotCommand(input); } catch (error) { throw new ExecutionNotStarted(error); }
        if (closed || uncertain) throw new ExecutionNotStarted(new StoreError("RUN_TERMINATION_UNKNOWN", "runtime generation is unavailable"));
        if (source.executable !== installation.node || !installedEntries.has(source.argv[0] ?? "") ||
            Object.keys(source.env).some(key => source.env[key] !== undefined && /^(?:DYLD_|LD_|NODE_OPTIONS$|NODE_PATH$)/.test(key)))
          throw new ExecutionNotStarted(new StoreError("UNSUPPORTED_PROFILE", "runtime generation requires a selected installed Node entry and clean loader environment"));
        if (policy?.writable.some(entry => root === entry.path || root.startsWith(entry.path + "/") || entry.path.startsWith(root + "/")))
          throw new ExecutionNotStarted(new StoreError("UNSUPPORTED_PROFILE", "runtime generation overlaps Actor writable roots"));
        if (policy?.nodePreload !== undefined && !privateEntries.has(policy.nodePreload))
          throw new ExecutionNotStarted(new StoreError("UNSUPPORTED_PROFILE", "runtime generation preload must be a selected immutable entry"));
        active++;
        try {
          const command = { ...source, executable: node, argv: ["--no-global-search-paths", join(root, relative(installation.libdir, source.argv[0]!)), ...source.argv.slice(1)] };
          const physicalPolicy = policy === undefined ? undefined : { ...policy,
            readable: [...policy.readable, { path: root, kind: "directory" as const }],
            mapped: [...(policy.mapped ?? []), { path: root, kind: "directory" as const }],
            executable: [...policy.executable, { path: node, kind: "file" as const }] };
          const scope = physicalPolicy === undefined ? await launchDarwinJobScope(command, options) : await launchSeatbeltJobScope(command, physicalPolicy, options);
          let retired = false;
          return Object.freeze({ witness: scope.witness, get prepared() { return scope.prepared ?? Promise.resolve(); },
            ...(scope.terminal === undefined ? {} : { terminal: scope.terminal }),
            result: scope.result, closed: scope.closed, population: () => scope.population(), release: () => scope.release(), terminate: () => scope.terminate(),
            close() { if (retired) return; scope.close(); retired = true; active--; } });
        } catch (error) { if (error instanceof ExecutionNotStarted) active--; else uncertain = true; throw error; }
      },
      close() {
        if (returnFailure !== undefined) throw returnFailure;
        if (closed) return;
        if (active !== 0 || uncertain) throw new StoreError("RUN_TERMINATION_UNKNOWN", "runtime generation still has live or unconfirmed scopes");
        cleanup(); closed = true;
        try { cleanupAll([closeRoot, closeParent]); } catch (error) { returnFailure = error; throw error; }
      },
    });
  } catch (error) {
    return withCleanup(() => { throw error; }, () => cleanupAll([
      () => { if (held !== undefined) cleanup(); }, closeSource, closeRoot, closeParent,
    ]));
  }
}
