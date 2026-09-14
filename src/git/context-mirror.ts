// CTX-006: immutable mirror verification must precede derived-pointer repair.
import { constants, openSync, closeSync, readdirSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ContextEntry } from "../../implementation/contracts.js";
import type { GitPaths } from "./paths.js";
import { assertContextDirectory } from "../storage/context-files.js";
import { StoreError } from "../domain/errors.js";
import { publishContextRevision } from "../storage/context-snapshot.js";
import { isValidFullOid } from "../ids.js";
import { contextRevisionPathAt } from "../storage/paths.js";
import { sha256Hex } from "../hash.js";
import { contextFileCheck, contextPathCheck } from "../validate.js";
import { GIT_ENV } from "../process/policies.js";
import { runProcessSync } from "../process/run.js";
import { GIT_BIN, CANONICAL_PROCESS_LIMITS as PROCESS_LIMITS } from "./canonical-command.js";
function canonicalGit(argv: readonly string[], input?: Uint8Array) {
  return runProcessSync({ executable: GIT_BIN, argv, env: GIT_ENV, timeoutMs: PROCESS_LIMITS.timeout,
    stdoutBytes: PROCESS_LIMITS.maxBuffer, stderrBytes: PROCESS_LIMITS.maxBuffer,
    ...(input === undefined ? {} : { input }) });
}

/** No silent reconstruction of a missing/corrupt immutable revision. */
export function repairContextMirror(paths: Pick<GitPaths, "worldDir" | "contextGit">, revision: string): void {
  const immutable = contextRevisionPathAt(paths.worldDir, revision);
  if (!lstatSync(immutable, { throwIfNoEntry: false })) throw new StoreError("REF_STATE_UNKNOWN", "immutable context revision missing; reconcile accepted intent first");
  assertContextDirectory(immutable);
  const listing = canonicalGit(["--git-dir", paths.contextGit, "ls-tree", "-r", "-z", "--full-tree", revision]);
  if (listing.kind !== "exited" || listing.exitCode !== 0) throw new StoreError("REF_STATE_UNKNOWN", "context canonical tree unavailable");
  let tree: string;
  try { tree = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(listing.stdout); }
  catch { throw new StoreError("STORE_CORRUPT", "context canonical tree metadata is malformed UTF-8"); }
  if (!tree.endsWith("\0")) throw new StoreError("STORE_CORRUPT", "context tree is unterminated");
  const entries: ContextEntry[] = []; const expected = new Map<string, string>();
  for (const line of tree.slice(0, -1).split("\0")) {
    const tab = line.indexOf("\t"); const fields = line.slice(0, tab).split(" "); const path = line.slice(tab + 1);
    const oid = fields[2];
    if (tab < 0 || fields.length !== 3 || fields[0] !== "100644" || fields[1] !== "blob" || !isValidFullOid(oid) || contextPathCheck(path) || expected.has(path))
      throw new StoreError("STORE_CORRUPT", "context canonical tree contains an unsupported entry");
    expected.set(path, oid);
  }
  if (!expected.has("GOAL.md")) throw new StoreError("STORE_CORRUPT", "context canonical tree has no GOAL.md");
  const seen = new Set<string>();
  const verify = (relative = ""): void => {
    assertContextDirectory(join(immutable, relative));
    for (const name of readdirSync(join(immutable, relative))) {
      const path = relative ? `${relative}/${name}` : name; const absolute = join(immutable, path); const stat = lstatSync(absolute);
      if (stat.isDirectory() && path === "decisions" && [...expected.keys()].some(key => key.startsWith("decisions/"))) { verify(path); continue; }
      if (!stat.isFile() || stat.nlink !== 1 || !expected.has(path)) throw new StoreError("STORE_CORRUPT", `unexpected context mirror entry ${path}`);
      const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      let bytes: Buffer;
      try { bytes = readFileSync(fd); } finally { closeSync(fd); }
      if (contextFileCheck(path, bytes)) throw new StoreError("STORE_CORRUPT", `context mirror policy mismatch ${path}`);
      const canonical = canonicalGit(["--git-dir", paths.contextGit, "hash-object", "--stdin"], bytes);
      if (canonical.kind !== "exited" || canonical.exitCode !== 0) throw new StoreError("REF_STATE_UNKNOWN", "context mirror object hash unavailable");
      if (canonical.stdout.toString("utf8").trim() !== expected.get(path)) throw new StoreError("STORE_CORRUPT", `context mirror bytes differ from canonical revision: ${path}`);
      seen.add(path); entries.push({ path, bytes: bytes.length, sha256: sha256Hex(bytes) });
    }
  };
  verify();
  if (seen.size !== expected.size) throw new StoreError("STORE_CORRUPT", "context mirror is incomplete");
  entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  publishContextRevision(paths.worldDir, revision, entries, immutable);
}
