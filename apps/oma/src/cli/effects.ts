import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { dirname, join } from "node:path";
import { FULL_OID_RE } from "@oma/domain/identifiers";
import { isValidFullOid } from "@oma/domain/identifiers";
import { StoreError } from "@oma/domain/errors";
import { GIT_ENV, requireTextExit, runGitText } from "@oma/process/policies";
import { runProcessSync } from "@oma/process/run";
import { fail } from "@oma/client/errors";
import { currentContext } from "@oma/client/context";
import { frameBytes as cliFrameBytes } from "@oma/client/settings";
import { decodeUtf8 } from "@oma/domain/utf8";

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A local file a command was given, read as WP26 records for CLI effects:
 * the named file is not followed if it is a link (FS-005), only a regular file
 * is read, and never more than a request frame can carry (INV10) -- anything
 * larger could not be sent, and a device such as /dev/zero would never end. */
export function readLocalFile(path: string): Buffer {
  return readLocal(path, cliFrameBytes(), true);
}

/** P0V-63: the first `bytes` bytes of a local file, with the same checks --
 * for a command that needs a file's beginning, not the whole of it. A reply
 * needs the message's headers; the stored message it replies to may be far
 * larger than a request, and nothing of its body is sent. */
export function readLocalHead(path: string, bytes: number): Buffer {
  return readLocal(path, bytes, false);
}

function readLocal(path: string, limit: number, whole: boolean): Buffer {
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") fail(`file not found: ${path}`, 2);
    if (code === "ELOOP") fail(`not a regular file (a link is not followed): ${path}`, 2);
    return fail(`cannot open ${path}: ${code ?? String(error)}`, 2);
  }
  try {
    return readBounded(fd, limit, whole, refusal => fail(
      refusal === "type" ? `not a regular file: ${path}`
        : refusal === "size" ? `file is larger than a request can carry (${limit} bytes): ${path}`
          : refusal === "grew" ? `file grew while it was read: ${path}`
            : `file changed while it was read: ${path}`, 2));
  } finally { closeSync(fd); }
}

export type LocalReadRefusal = "type" | "size" | "grew" | "changed";

/** P0V-78, INV10: the one way the CLI reads a local input -- a file a command
 * names, a context document, the bundle Git wrote. The descriptor was opened
 * without following a link. Only a regular file is read; a whole read is held
 * to `limit` by the size the descriptor reports before anything is allocated,
 * and a file that grows past that size while it is read is refused rather
 * than read on (a device such as /dev/zero would never end). A head read takes
 * at most `limit` bytes of a file of any size. NB-18: a file that shrank while
 * it was read is refused like FILE_CHANGED_DURING_READ -- never silently
 * accepted as the strict prefix it happened to leave. */
export function readBounded(fd: number, limit: number, whole: boolean, refuse: (refusal: LocalReadRefusal) => never): Buffer {
  const stat = fstatSync(fd, { bigint: true });
  if (!stat.isFile()) refuse("type");
  const size = Number(stat.size);
  if (whole && size > limit) refuse("size");
  const expected = whole ? size : Math.min(size, limit);
  const buffer = Buffer.alloc(expected + 1);
  let filled = 0;
  for (let count = 1; count > 0 && filled < buffer.length; filled += count)
    count = readSync(fd, buffer, filled, buffer.length - filled, null);
  if (whole && filled > size) refuse("grew");
  // A head read's buffer intentionally holds one byte past the head, so only
  // a short read detects shrinkage there; a whole read also re-checks the
  // descriptor so a truncation or in-place rewrite inside the read window is
  // reported like FILE_CHANGED_DURING_READ rather than silently accepted.
  if (filled < expected) refuse("changed");
  if (whole) {
    const after = fstatSync(fd, { bigint: true });
    if (after.size !== stat.size || after.mtimeNs !== stat.mtimeNs || after.ctimeNs !== stat.ctimeNs) refuse("changed");
  }
  return buffer.subarray(0, Math.min(filled, whole ? filled : limit));
}

export function readBody(path: string | null): string {
  if (path === null) return "";
  const bytes = readLocalFile(path);
  try {
    return decodeUtf8(bytes)
      .replace(/\r\n/g, "\n");
  } catch {
    return fail(`cannot read UTF-8 text file: ${path}`, 2);
  }
}

/** The workspace clone's recorded upstream base (`clone --single-branch main`
 * leaves refs/remotes/origin/main), or null when it is absent. */
export function recordedBase(): string | null {
  const result = runGitText(["rev-parse", "--verify", "--quiet", "--end-of-options", "refs/remotes/origin/main^{commit}"],
    { cwd: currentContext().cwd });
  const oid = result.status === 0 ? result.stdout.trim() : "";
  return isValidFullOid(oid) ? oid : null;
}

/** The not-a-repo words are absence only once nothing claims the workspace.
 * Git says "not a git repository" for a dir that never had one and for a
 * `.git` it found but cannot use -- a corrupt HEAD, an unreadable or
 * dangling `.git`, a `.git` file whose gitdir pointer leads nowhere, or a
 * claim across a mount boundary discovery will not cross -- so the message
 * alone cannot tell a missing workspace from a present-but-refusing one.
 * The corroboration walks the queried dir and its ancestors for a `.git`
 * entry: a directory or a gitdir-pointer file both claim the workspace, and
 * lstat sees the claim even when it is a link whose target is gone. An
 * entry that exists but cannot be observed (an ancestor the caller cannot
 * traverse) fails the corroboration too -- absence is asserted only when
 * every level answers ENOENT/ENOTDIR, never on an uncertain stat. */
function workspaceClaimPresent(dir: string): boolean {
  for (let current = dir;; current = dirname(current)) {
    try { lstatSync(join(current, ".git")); return true; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") return true;
    }
    if (dirname(current) === current) return false;
  }
}

/** Uncommitted work is never part of a resolved candidate; `merge open` warns.
 * The answer is boolean, so the bounded listing never refuses: a truncated
 * porcelain stream still proves dirty, and only a listing that captured no
 * entry needs the command's own outcome. A nonzero exit is git declining the
 * question, not an empty listing -- and even the two known declines answer
 * false only when `workspaceClaimPresent` corroborates that nothing claims
 * the workspace. A `.git` that is there but damaged or unreachable (a
 * corrupt HEAD, an unreadable entry, a gitdir pointer to nowhere, a claim
 * across a mount boundary) is a refusal on a present workspace, like a
 * corrupt index or an ownership git declines: it propagates rather than
 * answer clean. The one decline that stays a factual negative without a
 * `.git` is "must be run in a work tree" -- git read the repository enough
 * to know it has no work tree, and a bare repository has no place for
 * uncommitted work to be, while the same words with a `.git` present (a
 * mis-set core.bare, a cwd inside the gitdir) may hide unobserved work and
 * propagate. */
export function workspaceDirty(): boolean {
  const result = runProcessSync({ executable: "/usr/bin/git", argv: ["status", "--porcelain"],
    env: GIT_ENV, cwd: currentContext().cwd, timeoutMs: 30000, stdoutBytes: 256 * 1024, stderrBytes: 256 * 1024 });
  if (result.stdout.length > 0) return true;
  const status = requireTextExit(result, "git");
  if (status.status !== 0 &&
      (!/^fatal: (?:not a git repository|this operation must be run in a work tree)/m.test(status.stderr)
        || workspaceClaimPresent(currentContext().cwd)))
    throw new StoreError("INTERNAL_ERROR",
      `git status: ${status.stderr.trim().split("\n", 1)[0]!.slice(0, 200) || `exit ${status.status}`}`);
  return false;
}

export function resolveOid(revision: string): string {
  if (FULL_OID_RE.test(revision)) return revision;
  // INV09: the revision is a value, and Git would read a leading `-` as an option.
  // No revision needs one, and `--end-of-options` says so to Git as well.
  if (revision.startsWith("-")) fail(`invalid revision ${revision}`, 2);
  const result = runGitText(["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`], { cwd: currentContext().cwd });
  const oid = result.stdout.trim();
  if (result.status !== 0 || !FULL_OID_RE.test(oid)) fail(`cannot resolve ${revision} to a commit`, 2);
  return oid;
}
