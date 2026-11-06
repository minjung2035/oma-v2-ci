/** Private installed-byte generation. Scope retirement, rather than child EOF
 * or a caller-supplied death predicate, controls when its flags may be cleared. */
import { setImmediate } from "node:timers/promises";
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
import { mkdirAt, reopenDirectory, renameExclusiveAt } from "@oma/file-descriptors";
import { copyDescriptorToEntry } from "@oma/storage/file-digest";
import { removeOwnedTreeAt } from "@oma/storage/directory";
import { cleanupAll, withCleanup, completeIterator, withIteratorCleanup } from "@oma/native/cleanup";
import { StoreError } from "@oma/domain/errors";
import { isDeploymentDigest } from "@oma/domain/deployment";
import { GENERATION_OWNER, writeRuntimeArtifactOwner, retainRuntimeArtifact } from "./mac-runtime-artifact.js";
import { deploymentManifestSteps } from "./deployment-manifest.js";
import type { ProtectedMacNode } from "./mac-protected-node.js";

type Identity = { readonly dev: bigint; readonly ino: bigint };
type Entry = Identity & { readonly path: string; readonly directory: boolean };
export interface MacRuntimeGeneration {
  readonly root: string;
  readonly node: string;
  /** Only a selected installed JS entry can precede application arguments. */
  launchNode(source: CommandSpec, options?: DarwinJobScopeOptions, policy?: SeatbeltPolicy): Promise<BlockedExecution<DarwinCoalitionIdentity>>;
  /** Refuses while any acquired or uncertain scope still holds this tree. */
  close(): void;
  closeAsync(): Promise<void>;
}
function refused(message: string, cause?: unknown): never { throw new StoreError("UNSUPPORTED_PROFILE", message, { cause }); }
function canonical(path: string): boolean {
  return path.length > 0 && !path.includes("\\") && !path.includes("\0") &&
    path.split("/").every(part => part !== "" && part !== "." && part !== "..");
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
/** The caller supplies an already owned private parent, outside Actor writable
 * roots. No configured digest or accepted state is rewritten. Startup recovery
 * uses the separate held-directory artifact collector before this producer. */
type SourceInstallation = { readonly libdir: string; readonly node: string; readonly deploymentDigest: string };
export function createMacRuntimeGeneration(sourceInstallation: SourceInstallation, parent: string): MacRuntimeGeneration {
  return completeIterator(runtimeGenerationSteps(sourceInstallation, parent));
}
/** The same physical producer yields between inventory/copy/seal operations.
 * Cancellation is delivered once; cleanup must finish even after that signal. */
async function scheduled<T>(steps: Generator<void, T, void>, signal?: AbortSignal): Promise<T> {
  let interrupted = false, turn = performance.now();
  for (;;) {
    let step: IteratorResult<void, T>;
    if (signal?.aborted && !interrupted) {
      interrupted = true;
      step = steps.throw(new StoreError("CANCELLED_BEFORE_COMMIT", "runtime generation preparation was cancelled"));
    } else step = steps.next();
    if (step.done) return step.value;
    if (performance.now() - turn >= 8) { await setImmediate(); turn = performance.now(); }
  }
}
export function prepareMacRuntimeGeneration(sourceInstallation: SourceInstallation, parent: string, signal?: AbortSignal,
  protectedNode?: ProtectedMacNode): Promise<MacRuntimeGeneration> {
  return scheduled(runtimeGenerationSteps(sourceInstallation, parent, protectedNode), signal);
}
function* runtimeGenerationSteps(sourceInstallation: SourceInstallation, parent: string, protectedNode?: ProtectedMacNode): Generator<void, MacRuntimeGeneration, void> {
  if (process.platform !== "darwin" || (process.getuid?.() ?? 0) <= 0) refused("private immutable runtime generations require an ordinary Darwin owner");
  // Configuration accepts the normalized `${libdir}/` form; the generation owns one canonical root.
  const libdir = sourceInstallation.libdir.length > 1 && sourceInstallation.libdir.endsWith("/") ? sourceInstallation.libdir.slice(0, -1) : sourceInstallation.libdir;
  const installation = Object.freeze({ ...sourceInstallation, libdir });
  if (!isDeploymentDigest(installation.deploymentDigest) || resolve(parent) !== parent || resolve(installation.libdir) !== installation.libdir ||
      resolve(installation.node) !== installation.node)
    refused("runtime generation requires canonical roots and a trusted digest");
  for (const path of [parent, installation.libdir, dirname(installation.node)]) assertHostDirectoryLayout(path);
  const manifest = yield* deploymentManifestSteps(installation.libdir);
  if (digest(manifest) !== installation.deploymentDigest) refused("runtime generation source differs from deploymentDigest");
  const paths = [...manifest.files.map(file => file.path), ...manifest.directories, ...manifest.links.map(link => link.path)];
  if (paths.some(path => !canonical(path))) refused("runtime generation contains a noncanonical entry");
  const parentFd = openDirectory(parent), name = ".oma-runtime-" + randomUUID(), root = join(parent, name), entries: Entry[] = [];
  let sourceFd: number | undefined, held: number | undefined, created = false, closed = false, active = 0, uncertain = false;
  let parentOpen = true, returnFailure: unknown, retiring = false, closeTask: Promise<void> | undefined;
  let entryName = name.replace(".oma-runtime-", ".oma-runtime-opening-"), releaseArtifact: (() => void) | undefined;
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
  // Hold each directory once. Reopening every full relative path for every
  // entry made deep installed closures spend their budget on repeated walks.
  const flagSteps = function* (seal: boolean): Generator<void, void, void> {
    const children = new Map<string, Entry[]>(), failures: unknown[] = [];
    for (const entry of entries) if (entry.path !== ".") {
      const parent = dirname(entry.path), list = children.get(parent) ?? [];
      list.push(entry); children.set(parent, list);
    }
    const change = (fd: number, entry: Entry): void => {
      if (!same(fd, entry)) throw new Error("runtime generation entry changed before flag transition");
      if (seal || darwinOwnedEntryFlags(fd) & 2) setDarwinUserImmutable(fd, seal);
      if (seal && entry.directory) fsyncSync(fd);
    };
    const walk = function* (entry: Entry, fd: number): Generator<void, void, void> {
      if (!seal) {
        try { change(fd, entry); } catch (error) { failures.push(error); }
        yield;
      }
      for (const child of children.get(entry.path) ?? []) {
        try {
          const opened = child.directory ? openBeneath(fd, basename(child.path), constants.O_RDONLY | constants.O_DIRECTORY) : openRegularBeneath(fd, basename(child.path));
          yield* withIteratorCleanup(function* () {
            if (child.directory) yield* walk(child, opened);
            else { change(opened, child); yield; }
          }, () => closeSync(opened));
        } catch (error) { if (seal) throw error; failures.push(error); }
      }
      if (seal) { change(fd, entry); yield; }
    };
    if (entries[0] !== undefined) yield* walk(entries[0], held!);
    if (failures.length) throw new StoreError("RUN_TERMINATION_UNKNOWN", "runtime generation flags could not be returned", { cause: new AggregateError(failures) });
  };
  const cleanupSteps = function* (): Generator<void, void, void> {
    yield* flagSteps(false);
    if (created) {
      const actual = openBeneath(parentFd, entryName, constants.O_RDONLY | constants.O_DIRECTORY);
      withCleanup(() => { if (!same(actual, identity(held!))) throw new Error("runtime generation root changed"); }, () => closeSync(actual));
      removeOwnedTreeAt(parentFd, entryName); created = false;
    }
  };
  const cleanup = (): void => completeIterator(cleanupSteps());
  const finishReturn = (): void => {
    closed = true;
    try { cleanupAll([closeRoot, closeParent]); releaseArtifact?.(); } catch (error) { returnFailure = error; throw error; }
  };
  try {
    const owner = fstatSync(parentFd);
    if (owner.uid !== process.getuid?.() || (owner.mode & 0o077) !== 0) refused("runtime generation parent must be private and owned");
    sourceFd = openDirectory(installation.libdir);
    mkdirAt(parentFd, entryName, 0o700); created = true;
    held = openBeneath(parentFd, entryName, constants.O_RDONLY | constants.O_DIRECTORY); record(".", true);
    releaseArtifact = retainRuntimeArtifact(held);
    const directories = new Set(manifest.directories);
    for (const path of paths) for (let part = dirname(path); part !== "."; part = dirname(part)) directories.add(part);
    writeRuntimeArtifactOwner(parentFd, held, name, installation.deploymentDigest, {
      files: [...manifest.files.map(file => file.path), ".oma-node-bin/node", GENERATION_OWNER],
      directories: [...directories, ".oma-node-bin"], links: manifest.links,
    });
    record(GENERATION_OWNER, false);
    renameExclusiveAt(parentFd, entryName, parentFd, name); entryName = name; fsyncSync(parentFd);
    for (const path of [...directories].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))) {
      const fd = dirname(path) === "." ? held : heldEntry(dirname(path), true);
      withCleanup(() => mkdirAt(fd!, basename(path), 0o700), () => { if (fd !== held) closeSync(fd!); }); record(path, true);
      yield;
    }
    const copy = (source: number, path: string, expected?: { readonly bytes: number; readonly sha256: string }, targetParent?: number): { readonly bytes: number; readonly sha256: string } => {
      const parent = targetParent ?? (dirname(path) === "." ? held! : heldEntry(dirname(path), true));
      return withCleanup(() => {
        const result = copyDescriptorToEntry(source, parent, basename(path), { flushParent: false });
        if (expected !== undefined && (result.bytes !== expected.bytes || result.sha256 !== expected.sha256))
          refused("copied runtime byte differs from its trusted inventory");
        const fd = openRegularBeneath(parent, basename(path));
        withCleanup(() => { entries.push({ path, directory: false, ...identity(fd) }); fchmodSync(fd, 0o400 | (fstatSync(source).mode & 0o111 ? 0o100 : 0)); }, () => closeSync(fd));
        return result;
      }, () => { if (targetParent === undefined && parent !== held) closeSync(parent); });
    };
    const groups = new Map<string, typeof manifest.files[number][]>();
    for (const file of manifest.files) { const directory = dirname(file.path), group = groups.get(directory) ?? []; group.push(file); groups.set(directory, group); }
    for (const [directory, files] of groups) {
      const from = directory === "." ? sourceFd : openBeneath(sourceFd, directory, constants.O_RDONLY | constants.O_DIRECTORY);
      yield* withIteratorCleanup(function* () {
        const to = directory === "." ? held! : heldEntry(directory, true);
        yield* withIteratorCleanup(function* () {
          for (const file of files) {
            const fd = openRegularBeneath(from, basename(file.path));
            withCleanup(() => copy(fd, file.path, file, to), () => closeSync(fd)); yield;
          }
        }, () => { if (to !== held) closeSync(to); });
      }, () => { if (from !== sourceFd) closeSync(from); });
    }
    closeSource();
    for (const link of manifest.links) {
      const fd = dirname(link.path) === "." ? held : heldEntry(dirname(link.path), true);
      withCleanup(() => symlinkAt(relative(dirname(join(root, link.path)), join(root, link.target)), fd!, basename(link.path)),
        () => { if (fd !== held) closeSync(fd!); });
      yield;
    }
    mkdirAt(held, ".oma-node-bin", 0o700); record(".oma-node-bin", true);
    const node = join(root, ".oma-node-bin/node");
    // Node source ownership is independent of the disposable output ownership.
    const nodeDigest = protectedNode === undefined ? (() => {
      const nodeParent = openDirectory(dirname(installation.node));
      return withCleanup(() => {
        const nodeSource = openRegularBeneath(nodeParent, basename(installation.node));
        return withCleanup(() => {
          const stat = fstatSync(nodeSource);
          if (stat.size < 1 || stat.size > 268435456 || !(stat.mode & 0o111)) refused("selected Node is not a bounded executable");
          return copy(nodeSource, ".oma-node-bin/node").sha256;
        }, () => closeSync(nodeSource));
      }, () => closeSync(nodeParent));
    })() : copy(protectedNode.fd, ".oma-node-bin/node", protectedNode).sha256;
    const trustedAsset = (path: string): string => {
      const entry = manifest.files.find(file => file.path === path);
      if (entry === undefined) refused("runtime generation has no trusted native helper");
      return entry.sha256;
    };
    const helperDigest = trustedAsset("packages/native/dist/job-helper/oma-job-helper"),
      seatbeltDigest = trustedAsset("packages/native/dist/seatbelt/oma-seatbelt");
    if (digest(yield* deploymentManifestSteps(root)) !== installation.deploymentDigest) refused("private runtime inventory differs after copy");
    yield* flagSteps(true);
    fsyncSync(parentFd);
    const installedEntries = new Set(manifest.files.filter(file => /\.(?:js|mjs|cjs)$/.test(file.path)).map(file => join(installation.libdir, file.path)));
    const privateEntries = new Set([...installedEntries].map(path => join(root, relative(installation.libdir, path))));
    return Object.freeze({ root, node,
      async launchNode(input: CommandSpec, options: DarwinJobScopeOptions = {}, policy?: SeatbeltPolicy) {
        let source: CommandSpec;
        try { source = snapshotCommand(input); } catch (error) { throw new ExecutionNotStarted(error); }
        if (closed || retiring || uncertain) throw new ExecutionNotStarted(new StoreError("RUN_TERMINATION_UNKNOWN", "runtime generation is unavailable"));
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
          const privatePath = (entry: SeatbeltPolicy["readable"][number]) => ({ ...entry,
            path: entry.path === installation.libdir || entry.path.startsWith(installation.libdir + "/")
              // Preserve spelling so Seatbelt validation still rejects ..,
              // duplicate separators and other noncanonical policy inputs.
              ? root + entry.path.slice(installation.libdir.length) : entry.path });
          const physicalPolicy = policy === undefined ? undefined : { ...policy,
            readable: [...policy.readable.map(privatePath), { path: root, kind: "directory" as const }],
            mapped: [...(policy.mapped ?? []).map(privatePath), { path: root, kind: "directory" as const }],
            executable: [...policy.executable.map(privatePath), { path: node, kind: "file" as const }],
            denied: policy.denied.map(privatePath) };
          const launchOptions = { ...options, imageDigests: Object.freeze({ helper: helperDigest,
            images: Object.freeze(physicalPolicy === undefined ? [nodeDigest] : [seatbeltDigest, nodeDigest]) }) };
          const scope = physicalPolicy === undefined ? await launchDarwinJobScope(command, launchOptions) : await launchSeatbeltJobScope(command, physicalPolicy, launchOptions);
          let retired = false;
          return Object.freeze({ witness: scope.witness, get prepared() { return scope.prepared ?? Promise.resolve(); },
            ...(scope.terminal === undefined ? {} : { terminal: scope.terminal }),
            ...(scope.pinChild === undefined ? {} : { pinChild: () => scope.pinChild!() }),
            result: scope.result, closed: scope.closed, population: () => scope.population(), release: () => scope.release(), terminate: () => scope.terminate(),
            close() { if (retired) return; scope.close(); retired = true; active--; } });
        } catch (error) { if (error instanceof ExecutionNotStarted) active--; else uncertain = true; throw error; }
      },
      close() {
        if (returnFailure !== undefined) throw returnFailure;
        if (closed) return;
        if (active !== 0 || uncertain) throw new StoreError("RUN_TERMINATION_UNKNOWN", "runtime generation still has live or unconfirmed scopes");
        if (retiring) throw new StoreError("RUN_TERMINATION_UNKNOWN", "runtime generation return is already pending");
        cleanup(); finishReturn();
      },
      closeAsync() {
        if (returnFailure !== undefined) return Promise.reject(returnFailure);
        if (closed) return Promise.resolve();
        if (closeTask !== undefined) return closeTask;
        if (active !== 0 || uncertain) return Promise.reject(new StoreError("RUN_TERMINATION_UNKNOWN", "runtime generation still has live or unconfirmed scopes"));
        retiring = true;
        closeTask = scheduled(cleanupSteps()).then(finishReturn);
        void closeTask.catch(() => {}); return closeTask;
      },
    });
  } catch (error) {
    const failures: unknown[] = [error];
    try { if (held !== undefined) yield* cleanupSteps(); } catch (cleanup) { failures.push(cleanup); }
    try { cleanupAll([closeSource, closeRoot, closeParent]); } catch (cleanup) { failures.push(cleanup); }
    if (failures.length > 1) throw new AggregateError(failures, "Owned effect and cleanup failed");
    releaseArtifact?.(); throw error;
  }
}
