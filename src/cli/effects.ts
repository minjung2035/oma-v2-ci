import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { FULL_OID_RE } from "../ids.js";
import { isValidFullOid } from "../domain/identifiers.js";
import { runGitText } from "../process/policies.js";
import { fail } from "../client/errors.js";
import { currentContext } from "../client/context.js";
import { frameBytes as cliFrameBytes } from "../client/settings.js";
import { decodeUtf8 } from "../domain/utf8.js";

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

/** Uncommitted work is never part of a resolved candidate; `merge open` warns. */
export function workspaceDirty(): boolean {
  const status = runGitText(["status", "--porcelain"], { cwd: currentContext().cwd, maxBuffer: 256 * 1024 });
  return status.status === 0 && status.stdout.trim().length > 0;
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
