/** DR27: the first clone starts at a working-tree snapshot. Only the owned
 * repository is written: no add, index lock, filter or ref write in the source.
 * This prepares objects, not authority to move canonical main. */
import { closeSync, constants, fstatSync, openSync, readFileSync, readSync, writeSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { StoreError } from "@oma/domain/errors";
import { runProcessSync, decodeProcessText } from "@oma/process/run";
import { GIT_ENV, requireTextExit } from "@oma/process/policies";
import { withCleanup } from "@oma/native/cleanup";
import { SnapshotReader, copySnapshotFile, sameSnapshotFile } from "@oma/native/snapshot-reader";
import { prepareProjectDirectory } from "./project-preparation.js";
import { type ProjectPreparation } from "./project-preparation.js";

/** Commands that inspect the Human's repository must not run its programs.
 * In particular, ls-files would otherwise invoke core.fsmonitor. */
export const SNAPSHOT_GIT_OPTIONS = [
  "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "core.pager=cat",
  "-c", "credential.helper=", "-c", "core.sshCommand=false", "-c", "protocol.allow=never",
  "-c", "protocol.file.allow=always", "-c", "uploadpack.packObjectsHook=",
  "-c", "fetch.fsckObjects=true", "-c", "transfer.fsckObjects=true", "-c", "gc.auto=0",
] as const;
type Git = (argv: readonly string[], input?: string | Uint8Array) => string;
type Item = { readonly mode: string; readonly oid: string };
interface Tree { readonly files: Map<string, Item>; readonly trees: Map<string, Tree> }
const tree = (): Tree => ({ files: new Map(), trees: new Map() });
function paths(output: string): string[] {
  if (output === "") return [];
  if (!output.endsWith("\0")) throw new StoreError("STORE_CORRUPT", "snapshot path list was incomplete");
  return output.slice(0, -1).split("\0");
}
function record(root: Tree, path: string, item: Item): void {
  const parts = path.split("/");
  if (parts.some(part => !part || part === "." || part === ".." || part.toLowerCase() === ".git"))
    throw new StoreError("INVALID_REQUEST", "snapshot contains a reserved path");
  let into = root;
  for (const part of parts.slice(0, -1)) {
    if (into.files.has(part)) throw new StoreError("REF_STATE_UNKNOWN", "snapshot has conflicting file and directory paths");
    let child = into.trees.get(part);
    if (!child) { child = tree(); into.trees.set(part, child); }
    into = child;
  }
  const name = parts.at(-1)!;
  if (into.trees.has(name)) throw new StoreError("REF_STATE_UNKNOWN", "snapshot has conflicting file and directory paths");
  into.files.set(name, item);
}
function writeTree(root: Tree, git: Git): string {
  const lines: string[] = [];
  const pending = [{ tree: root, prefix: "" }];
  while (pending.length > 0) {
    const { tree: next, prefix } = pending.pop()!;
    for (const [name, item] of next.files) lines.push(`${item.mode} ${item.oid}\t${prefix}${name}\0`);
    for (const [name, child] of next.trees) pending.push({ tree: child, prefix: `${prefix}${name}/` });
  }
  // This index belongs to the temporary repository, never the source. Git
  // builds all subtrees in one invocation rather than one child per directory.
  git(["update-index", "-z", "--index-info"], lines.join(""));
  return git(["write-tree"]);
}

/** The preparation stays owned through synchronous or asynchronous bundle/fetch.
 * Callers may supply the preparation owner; the default uses held-parent
 * storage. A command timeout never proves child or descendant death. */
export function withProjectSnapshot<T>(options: {
  readonly source: string; readonly parent: string | null; readonly format: "sha1" | "sha256";
  readonly sourceIsGit: boolean; readonly temporaryParent: string; readonly executable: string;
  /** Already owned local history, when provisioning prepared its mirror. */
  readonly historySource?: string;
  readonly prepare?: (path: string) => ProjectPreparation;
}, use: (snapshot: { readonly repository: string; readonly head: string; readonly empty: boolean;
  readonly git: Git }) => T): T {
  const temporary = join(options.temporaryParent, `.snapshot.staging.${randomBytes(8).toString("hex")}`);
  const prepared = (options.prepare ?? prepareProjectDirectory)(temporary);
  const descriptor = prepared.descriptor;
  let reader: SnapshotReader | undefined;
  let content: number | undefined;
  const closeContent = (): void => { const fd = content; content = undefined; if (fd !== undefined) closeSync(fd); };
  let active = true;
  const finish = (failures: unknown[] = []): void => {
    active = false;
    try { closeContent(); } catch (error) { failures.push(error); }
    try { reader?.close(); } catch (error) { failures.push(error); }
    try { prepared.dispose(); } catch (error) { failures.push(error); }
    if (failures.length > 1) throw new AggregateError(failures, "project snapshot and owned cleanup failed");
    if (failures.length === 1) throw failures[0];
  };
  let result: T;
  let pending = false;
  try {
    const repository = join(temporary, "repository.git");
    // A repository's listing is exactly as large as the repository is -- it
    // must never die for crossing a buffer bound, so both streams are
    // descriptor-spooled into this invocation's own staging: the file holds
    // the stream whole, and its head is read back only where a failure's
    // message or the answer needs it.
    const spoolOut = join(temporary, "git.stdout");
    const spoolErr = join(temporary, "git.stderr");
    const readHead = (path: string, bytes: number): Buffer => {
      const fd = openSync(path, constants.O_RDONLY);
      try {
        const buffer = Buffer.alloc(bytes);
        const count = readSync(fd, buffer, 0, bytes, 0);
        return buffer.subarray(0, count);
      } finally { closeSync(fd); }
    };
    const run = (argv: readonly string[], input?: string | Uint8Array, stdinFd?: number): string => {
      if (!active) throw new StoreError("INTERNAL_ERROR", "project snapshot ownership has ended");
      const result = runProcessSync({ executable: options.executable,
        argv: [...SNAPSHOT_GIT_OPTIONS, ...argv],
        env: { ...GIT_ENV, GIT_OPTIONAL_LOCKS: "0", GIT_AUTHOR_NAME: "OMA", GIT_AUTHOR_EMAIL: "oma@localhost",
          GIT_COMMITTER_NAME: "OMA", GIT_COMMITTER_EMAIL: "oma@localhost" },
        cwd: temporary,
        ...(input === undefined ? {} : { input }),
        ...(stdinFd === undefined ? {} : { stdinFd }), timeoutMs: 10 * 60_000,
        stdoutBytes: 32 * 1024 * 1024, stderrBytes: 1024 * 1024,
        stdoutSpool: spoolOut, stderrSpool: spoolErr }, undefined, [descriptor]);
      // requireTextExit already maps the non-exited kinds; spooled streams
      // report empty buffers there, so the streams are read from the files
      // the invocation named.
      const exited = requireTextExit(result, "project snapshot git");
      if (exited.status !== 0) {
        const stderr = result.stderrSpooledTo === undefined ? exited.stderr
          : decodeProcessText(readHead(result.stderrSpooledTo, 8192));
        throw new StoreError("STORE_CORRUPT", `project snapshot git failed: ${stderr.trim().slice(0, 200)}`);
      }
      return result.stdoutSpooledTo === undefined ? exited.stdout
        : decodeProcessText(readFileSync(result.stdoutSpooledTo));
    };
    const git: Git = (argv, input) => run(["--git-dir", repository, ...argv], input).trimEnd();
    // A parent commit describes the whole repository, not the invocation
    // subdirectory. Mixing that tree with subdirectory-relative paths would
    // silently delete siblings and move files to the root.
    const sourceRoot = options.sourceIsGit
      ? run(["-C", options.source, "rev-parse", "--show-toplevel"]).replace(/\n$/, "") : options.source;
    if (options.parent === null) run(["init", "--quiet", "--bare", "--template=", `--object-format=${options.format}`, repository]);
    else {
      // Local cloning copies existing objects without repeatedly packing the
      // same history. Never hardlink the Human's objects into owned state.
      run(["clone", "--quiet", "--bare", "--local", ...(options.historySource === undefined ? ["--no-hardlinks"] : []), "--dissociate", "--no-tags",
        options.historySource ?? sourceRoot, repository]);
      if (options.historySource === undefined) git(["fsck", "--full", "--no-dangling", "--no-progress"]);
      git(["rev-parse", "--verify", `${options.parent}^{commit}`]);
    }
    const source = (argv: readonly string[]) => run(options.sourceIsGit
      ? ["-C", sourceRoot, ...argv]
      : ["--git-dir", repository, "--work-tree", sourceRoot, ...argv]);
    const list = (): string[] => paths(source(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]));
    const parentEntries = options.parent === null ? [] : paths(run(["--git-dir", repository, "ls-tree", "-rz", options.parent]));
    const tracked = parentEntries.map(entry => entry.slice(entry.indexOf("\t") + 1));
    const gitlinks = new Set(parentEntries.filter(entry => entry.startsWith("160000 ")).map(entry => entry.slice(entry.indexOf("\t") + 1)));
    if (options.sourceIsGit) for (const entry of paths(source(["ls-files", "--stage", "-z"])))
      if (entry.startsWith("160000 ")) gitlinks.add(entry.slice(entry.indexOf("\t") + 1));
    const initialSelection = list();
    const selected = [...new Set([...tracked, ...initialSelection])].sort();
    // A missing sparse file is not a deletion. Refuse to invent a snapshot of
    // files the Human's checkout deliberately does not hold.
    if (options.sourceIsGit && paths(source(["ls-files", "-tz"])).some(item => item.startsWith("S ")))
      throw new StoreError("UNSUPPORTED_PROFILE", "expand the sparse checkout before taking the initial project snapshot");
    reader = new SnapshotReader(sourceRoot);
    const root = tree();
    const observed = new Map<string, ReturnType<SnapshotReader["entry"]>>();
    const blobs: { readonly path: string; readonly mode: string }[] = [];
    const leaves = new Set<string>();
    const scratch = Buffer.alloc(64 * 1024);
    // One framed Git stream keeps exact binary bytes without one private file
    // and inode per source entry. Filenames never enter this protocol.
    const write = (bytes: Buffer): void => {
      content ??= prepared.openContent();
      for (let at = 0; at < bytes.length;) {
        const count = writeSync(content, bytes, at, bytes.length - at);
        if (count <= 0) throw new StoreError("INTERNAL_ERROR", "snapshot content write made no progress");
        at += count;
      }
    };
    for (const path of selected) {
      if (path.endsWith("/")) throw new StoreError("UNSUPPORTED_PROFILE", `snapshot contains a nested repository: ${path}`);
      // A tracked directory replaced by a file or symlink deletes its old
      // descendants. Never follow that replacement while examining old paths.
      const parts = path.split("/");
      if (parts.slice(0, -1).some((_, at) => leaves.has(parts.slice(0, at + 1).join("/")))) continue;
      const entry = reader.entry(path);
      if (entry === null) { observed.set(path, null); continue; }
      try {
        if (entry.stat.isDirectory()) {
          if (gitlinks.has(path)) throw new StoreError("UNSUPPORTED_PROFILE", `snapshot contains a submodule: ${path}`);
          // A tracked file replaced by an ordinary directory contributes only
          // its selected children; an empty/ignored-only directory has no blob.
          observed.set(path, entry); continue;
        }
        leaves.add(path);
        write(Buffer.from(`blob\nmark :${blobs.length + 1}\ndata ${entry.link?.length ?? entry.stat.size}\n`));
        if (entry.link !== null) write(entry.link); else copySnapshotFile(entry, path, write, scratch);
        write(Buffer.from("\n"));
        blobs.push({ path, mode: entry.link !== null ? "120000" : (entry.stat.mode & 0o111) !== 0 ? "100755" : "100644" });
        observed.set(path, entry);
      } finally { closeSync(entry.descriptor); }
    }
    // A changed or unreadable source aborts before the caller can publish main.
    // This is a coherent best-effort capture, not a claim of an atomic OS snapshot.
    if (JSON.stringify(initialSelection) !== JSON.stringify(list()))
      throw new StoreError("REF_STATE_UNKNOWN", "project file selection changed during the snapshot");
    for (const [path, before] of observed) {
      const after = reader.entry(path);
      try {
        if ((before === null) !== (after === null) || (before !== null && after !== null &&
            (!sameSnapshotFile(before.stat, after.stat) || !Buffer.from(before.link ?? []).equals(Buffer.from(after.link ?? [])))))
          throw new StoreError("REF_STATE_UNKNOWN", `project file changed during the snapshot: ${path}`);
      } finally { if (after !== null) closeSync(after.descriptor); }
    }
    if (!sameSnapshotFile(reader.identity, fstatSync(reader.descriptor)))
      throw new StoreError("REF_STATE_UNKNOWN", "project directory changed during the snapshot");
    if (blobs.length > 0) {
      write(Buffer.from("done\n"));
      closeContent();
      const input = prepared.readContent(), marksPath = join(temporary, "git.marks");
      withCleanup(() => run(["--git-dir", repository, "fast-import", "--quiet", "--done", `--export-marks=${marksPath}`],
        undefined, input), () => closeSync(input));
      const marks = new Map<number, string>();
      const pattern = new RegExp(`^:([1-9][0-9]*) ([0-9a-f]{${options.format === "sha256" ? 64 : 40}})$`);
      for (const line of readFileSync(marksPath, "utf8").trimEnd().split("\n")) {
        const match = pattern.exec(line), index = match === null ? 0 : Number(match[1]);
        if (match === null || !Number.isSafeInteger(index) || index < 1 || index > blobs.length || marks.has(index))
          throw new StoreError("REF_STATE_UNKNOWN", "snapshot blob import returned invalid marks");
        marks.set(index, match[2]!);
      }
      if (marks.size !== blobs.length) throw new StoreError("REF_STATE_UNKNOWN", "snapshot blob import returned incomplete marks");
      for (let index = 0; index < blobs.length; index++)
        record(root, blobs[index]!.path, { mode: blobs[index]!.mode, oid: marks.get(index + 1)! });
    }
    const treeId = writeTree(root, git);
    const unchanged = options.parent !== null && treeId === git(["rev-parse", `${options.parent}^{tree}`]);
    const head = unchanged ? options.parent! : git(["commit-tree", treeId,
      ...(options.parent === null ? [] : ["-p", options.parent]), "-m", "oma: initial project snapshot"]);
    git(["update-ref", "refs/heads/snapshot", head]);
    result = use({ repository, head, empty: root.files.size === 0 && root.trees.size === 0, git });
    pending = result !== null && (typeof result === "object" || typeof result === "function") &&
      typeof (result as { then?: unknown }).then === "function";
  } catch (error) { finish([error]); throw error; }
  if (pending) return Promise.resolve(result).then(
    value => { finish(); return value; },
    error => { finish([error]); throw error; },
  ) as T;
  finish();
  return result;
}
