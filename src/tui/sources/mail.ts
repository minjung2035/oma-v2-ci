/** TUI-011: the Mail screen's read-only view of the Principal mailbox.
 *
 * The eml files are the originals (FS-006). This module reads them as the host
 * and derives what it shows; it writes nothing, moves nothing between new and
 * cur, and stores no read state. "Unread" is the Maildir position the broker
 * already owns, not a new durable flag.
 */
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { MailBody, MailboxRead, MailRow } from "../model.js";
import { READ_BOUNDS } from "../limits.js";
import { displaySubject } from "../../mail/headers.js";
import { headerEnd, readableBody } from "../../mail/display.js";
import { unobserved } from "../../domain/errors.js";
import { errorWords } from "../words.js";

export interface MailboxPaths {
  readonly newDir: string;
  readonly curDir: string;
}

export function principalMailbox(stateRoot: string): MailboxPaths {
  const base = join(stateRoot, "mail", "inboxes", "principal");
  return Object.freeze({ newDir: join(base, "new"), curDir: join(base, "cur") });
}

const HEADER_LIMIT = READ_BOUNDS.mailHeaderBytes.value;

export interface ParsedMessage {
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** Folded headers are joined before lookup so that a wrapped Subject is not
 * silently truncated at the fold. AV26: the header block ends at the first
 * blank line the writer emits (CRLF), a value is shown by the one reader rule
 * for headers (`displaySubject`: adjacent encoded words join without the fold's
 * space), and the body as its sender wrote it (`readableBody`).
 */
export function parseMessage(text: string): ParsedMessage {
  const end = headerEnd(text);
  const head = end.at < 0 ? text : text.slice(0, end.at);
  const body = readableBody(text);
  const headers: Record<string, string> = {};
  let field = "";
  const commit = (): void => {
    const colon = field.indexOf(":");
    if (colon > 0) headers[field.slice(0, colon).trim().toLowerCase()] = displaySubject(field.slice(colon + 1).trim());
    field = "";
  };
  for (const raw of head.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line.length === 0) continue;
    if (/^[ \t]/.test(line)) { field += ` ${line.trim()}`; continue; }
    commit();
    field = line;
  }
  commit();
  return Object.freeze({ headers: Object.freeze(headers), body });
}

function addressName(value: string | undefined): string {
  if (!value) return "(unknown)";
  const angle = value.match(/<([^>]+)>/);
  const address = (angle ? angle[1]! : value).trim();
  const local = address.split("@")[0] ?? address;
  return local.length > 0 ? local : address;
}

/** Reads at most `limit` bytes of a regular file without following a link.
 *
 * A mailbox is a directory of files other processes create, so the read is
 * bounded at the syscall — never a whole file sliced afterwards — and a symlink
 * is refused rather than followed: a corrupted Maildir must not be able to put
 * the contents of a host file on this screen. The time the message arrived is
 * taken from the same descriptor, so what is read and what it is ordered by
 * come from one observation of one file.
 */
type BoundedRead =
  /** `complete` is false when the file holds more than the bound allowed. */
  | { readonly kind: "read"; readonly text: string; readonly deliveredAtMs: number; readonly complete: boolean }
  /** Not a message: gone, a link, or not a regular file. */
  | { readonly kind: "none" }
  /** DR13: a file that could not be read now is not "no message". */
  | { readonly kind: "unreadable"; readonly reason: string };
function readBounded(path: string, limit: number): BoundedRead {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile()) return { kind: "none" };
    const wanted = Math.min(limit, stat.size);
    const buffer = Buffer.allocUnsafe(wanted);
    let filled = 0;
    while (filled < wanted) {
      const count = readSync(fd, buffer, filled, wanted - filled, null);
      if (count === 0) break;
      filled += count;
    }
    return { kind: "read", text: buffer.subarray(0, filled).toString("utf8"), deliveredAtMs: stat.mtimeMs,
      complete: stat.size <= limit && filled === stat.size };
  } catch (error) {
    const unknown = unobserved(error, path);
    return unknown === null ? { kind: "none" } : { kind: "unreadable", reason: errorWords(unknown) };
  } finally { if (fd !== undefined) closeSync(fd); }
}

/** A mailbox directory's names. One that does not exist holds no mail; one
 * that exists and cannot be listed is not an empty one (arch §23.5, INV02), and
 * says why. */
function listDir(path: string): { readonly names: readonly string[] } | { readonly unreadable: string } {
  try { return { names: readdirSync(path).sort() }; }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" ? { names: [] } : { unreadable: `${code ?? "error"}: ${path}` };
  }
}

type DirectoryRows = { readonly rows: readonly { row: MailRow; deliveredAtMs: number }[]; readonly unreadable: string | null; readonly omitted: number };
type Entry = { readonly name: string; readonly deliveredAtMs: number };

/** A mailbox directory's messages, most recently delivered first, by a name
 * observation only (lstat): a regular file is a message, a directory or a
 * symlink is not. The one derivation of "what counts as a message" for the
 * list and for the count of messages waiting. An entry that could not be
 * observed now is not known to be no message; the directory says so. */
function entriesIn(directory: string): { readonly entries: readonly Entry[]; readonly unreadable: string | null } {
  const listed = listDir(directory);
  if ("unreadable" in listed) return { entries: [], unreadable: listed.unreadable };
  const entries: Entry[] = [];
  let unreadable: string | null = null;
  for (const name of listed.names) {
    const path = join(directory, name);
    let stat;
    try { stat = lstatSync(path); }
    catch (error) {
      const unknown = unobserved(error, path);
      if (unknown !== null) unreadable ??= errorWords(unknown);
      continue;
    }
    if (stat.isFile()) entries.push({ name, deliveredAtMs: stat.mtimeMs });
  }
  // Entries delivered in the same millisecond keep a stable order by name.
  entries.sort((left, right) => right.deliveredAtMs - left.deliveredAtMs || left.name.localeCompare(right.name));
  return { entries, unreadable };
}

/** The rows of a mailbox directory: a header is read for at most `budget` of
 * its messages, the most recent first (P0V-43). A refresh used to open and read
 * every message in the mailbox, synchronously, on the event loop that also
 * reads keys -- a cost that grew with every message ever delivered. The rest
 * are counted as omitted, never shown as absent. An entry that could not be
 * read now is not known to be no message: the rows that were read are kept,
 * and the directory says it was not wholly read, as one it cannot list does. */
function rowsIn(directory: string, unread: boolean, budget: number): DirectoryRows {
  const rows: { row: MailRow; deliveredAtMs: number }[] = [];
  const listed = entriesIn(directory);
  let unreadable = listed.unreadable;
  const shown = listed.entries.slice(0, Math.max(0, budget));
  for (const { name } of shown) {
    const path = join(directory, name);
    const read = readBounded(path, HEADER_LIMIT);
    if (read.kind === "unreadable") { unreadable ??= read.reason; continue; }
    if (read.kind === "none") continue;
    const { headers } = parseMessage(read.text);
    rows.push({
      deliveredAtMs: read.deliveredAtMs,
      row: Object.freeze({
        id: name,
        from: addressName(headers["from"]),
        kind: headers["x-oma-kind"] ?? "message",
        subject: headers["subject"] ?? "(제목 없음)",
        unread,
        path,
      }),
    });
  }
  return { rows, unreadable, omitted: listed.entries.length - shown.length };
}

/** Most recently delivered first, within unread and then read.
 *
 * A message id carries a random UUID, so the file name says nothing about when
 * the message arrived; the Maildir file's own modification time does, and that
 * is what orders the list. Entries that arrived in the same millisecond keep a
 * stable order by name so the screen does not reshuffle between refreshes.
 */
function byArrival(rows: readonly { row: MailRow; deliveredAtMs: number }[]): readonly MailRow[] {
  return [...rows]
    .sort((left, right) => right.deliveredAtMs - left.deliveredAtMs || left.row.id.localeCompare(right.row.id))
    .map(entry => entry.row);
}

export function readMailbox(paths: MailboxPaths): MailboxRead {
  const budget = READ_BOUNDS.mailListRows.value;
  const pending = rowsIn(paths.newDir, true, budget);
  const settled = rowsIn(paths.curDir, false, budget - pending.rows.length);
  return Object.freeze({
    rows: Object.freeze([...byArrival(pending.rows), ...byArrival(settled.rows)]),
    unreadable: pending.unreadable ?? settled.unreadable,
    omitted: pending.omitted + settled.omitted,
  });
}

/** Messages not yet delivered to the Principal's session, or null when the
 * directory holding them could not be observed: never a 0 for an unread
 * mailbox. Counted by name observation alone, reading no message (P0V-43). */
export function unreadCount(paths: MailboxPaths): number | null {
  const pending = entriesIn(paths.newDir);
  return pending.unreadable === null ? pending.entries.length : null;
}

/** P0V-42, P0-5: a stored message's body, read within `limit` -- the most a
 * stored message of this society can take (`storedMailBytes` of its body
 * limit) -- and whether what was read is only its beginning. */
export function readBody(path: string, limit: number): MailBody | null {
  const read = readBounded(path, limit);
  return read.kind === "read" ? Object.freeze({ text: parseMessage(read.text).body, truncated: !read.complete }) : null;
}
