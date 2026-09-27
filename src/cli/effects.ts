import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { FULL_OID_RE } from "../ids.js";
import { runGitText } from "../process/policies.js";
import { fail } from "./exit.js";
import { cliFrameBytes } from "./transport.js";

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
          : `file grew while it was read: ${path}`, 2));
  } finally { closeSync(fd); }
}

export type LocalReadRefusal = "type" | "size" | "grew";

/** P0V-78, INV10: the one way the CLI reads a local input -- a file a command
 * names, a context document, the bundle Git wrote. The descriptor was opened
 * without following a link. Only a regular file is read; a whole read is held
 * to `limit` by the size the descriptor reports before anything is allocated,
 * and a file that grows past that size while it is read is refused rather
 * than read on (a device such as /dev/zero would never end). A head read takes
 * at most `limit` bytes of a file of any size. */
export function readBounded(fd: number, limit: number, whole: boolean, refuse: (refusal: LocalReadRefusal) => never): Buffer {
  const stat = fstatSync(fd);
  if (!stat.isFile()) refuse("type");
  if (whole && stat.size > limit) refuse("size");
  const buffer = Buffer.alloc((whole ? stat.size : Math.min(stat.size, limit)) + 1);
  let filled = 0;
  for (let count = 1; count > 0 && filled < buffer.length; filled += count)
    count = readSync(fd, buffer, filled, buffer.length - filled, null);
  if (whole && filled > stat.size) refuse("grew");
  return buffer.subarray(0, Math.min(filled, whole ? filled : limit));
}

export function readBody(path: string | null): string {
  if (path === null) return "";
  const bytes = readLocalFile(path);
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
      .decode(bytes)
      .replace(/\r\n/g, "\n");
  } catch {
    return fail(`cannot read UTF-8 text file: ${path}`, 2);
  }
}

export function resolveOid(revision: string): string {
  if (FULL_OID_RE.test(revision)) return revision;
  // INV09: the revision is a value, and Git would read a leading `-` as an option.
  // No revision needs one, and `--end-of-options` says so to Git as well.
  if (revision.startsWith("-")) fail(`invalid revision ${revision}`, 2);
  const result = runGitText(["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`], { cwd: process.cwd() });
  const oid = result.stdout.trim();
  if (result.status !== 0 || !FULL_OID_RE.test(oid)) fail(`cannot resolve ${revision} to a commit`, 2);
  return oid;
}
