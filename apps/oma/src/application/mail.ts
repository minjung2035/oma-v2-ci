import { unobserved, exceptionText } from "@oma/domain/errors";
/** TUI-011: the Mail screen's read-only view of the Principal mailbox.
 *
 * The eml files are the originals (FS-006). This module reads them as the host
 * and derives what it shows; it writes nothing, moves nothing between new and
 * cur, and stores no read state. "Unread" is the Maildir position the broker
 * already owns, not a new durable flag.
 */
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { MailBody, MailboxRead, MailRow } from "@oma/tui/model";
import { mailNamerFor, type MailRoster } from "@oma/tui/mail-names";
import { READ_BOUNDS } from "@oma/domain/surface-bounds";
import { displaySubject } from "@oma/mail/headers";
import { headerEnd, readableBody } from "@oma/mail/display";
import { publishedMailEntries } from "@oma/storage/published-mail";
import { readMailNotices } from "@oma/storage/mail-notices";

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

/** The To header's recipients as the screen names them, comma-joined, or
 * absent when the message carries none: a To can name more than one
 * recipient, and each maps on its own. Display only -- the stored header
 * keeps the RFC addresses the durable fact's logical addresses became. */
function recipientNames(value: string | undefined, party: (local: string) => string): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const names = value.split(",")
    .map(part => part.trim())
    .filter(part => part.length > 0)
    .map(part => party(addressName(part)));
  return names.length === 0 ? undefined : names.join(", ");
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
    return unknown === null ? { kind: "none" } : { kind: "unreadable", reason: exceptionText(unknown) };
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

type DirectoryRows = { readonly rows: readonly { row: MailRow; deliveredAtMs: number; threadKey: string | null }[];
  readonly unreadable: string | null; readonly omitted: number };
type Entry = { readonly name: string; readonly deliveredAtMs: number };

/** The mailbox's arrival journal: `<ms> <id>\n` appended when a link appears
 * in new/. An inbox entry's inode is the immutable object's, so its mtime
 * says when the object was frozen — not when it arrived here (AV-11). The
 * last line for an id wins: a republished link is the newest arrival. A
 * missing journal predates it and falls back to inode times; one that cannot
 * be read says the ordering evidence was not wholly read. */
const JOURNAL_WINDOW = READ_BOUNDS.mailArrivalJournalBytes.value;
function arrivalJournal(mailbox: string): { readonly arrivals: ReadonlyMap<string, number>; readonly unreadable: string | null } {
  const empty = { arrivals: new Map<string, number>(), unreadable: null };
  const journal = join(mailbox, "arrival");
  let fd: number | undefined;
  let text = "";
  try {
    fd = openSync(journal, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile()) return empty;
    const start = Math.max(0, stat.size - JOURNAL_WINDOW);
    const buffer = Buffer.allocUnsafe(stat.size - start);
    let filled = 0;
    while (filled < buffer.length) {
      const count = readSync(fd, buffer, filled, buffer.length - filled, start + filled);
      if (count === 0) break;
      filled += count;
    }
    text = buffer.subarray(0, filled).toString("utf8");
    if (start > 0) {
      const boundary = text.indexOf("\n");
      text = boundary < 0 ? "" : text.slice(boundary + 1);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty;
    const unknown = unobserved(error, journal);
    return unknown === null ? empty
      : { arrivals: new Map(), unreadable: `${exceptionText(unknown)}: ${journal}` };
  } finally { if (fd !== undefined) closeSync(fd); }
  const arrivals = new Map<string, number>();
  for (const line of text.split("\n")) {
    const space = line.indexOf(" ");
    const at = space > 0 ? Number(line.slice(0, space)) : NaN;
    const id = space > 0 ? line.slice(space + 1) : "";
    if (id.length > 0 && Number.isSafeInteger(at) && at >= 0) arrivals.set(id, at);
  }
  return { arrivals, unreadable: null };
}
/** The journal's key for a maildir entry name: `cur` names carry `:2,`. */
const arrivalKeyOf = (name: string): string => name.endsWith(":2,") ? name.slice(0, -3) : name;

/** mail-v1: the messages of one review request (thread revisions, withdrawn/
 * decision notes, a HIGH approval and its successor) arrive separately and
 * answer each other. The screen folds a thread into one row for its latest
 * arrival -- the earlier ones are counted, and their paths stay listed on the
 * open message's detail, so every arrival is still reachable and the fold
 * changes no delivery or acknowledgement fact. The root is the first
 * References entry, else the In-Reply-To, else the message's own Message-ID --
 * the headers this same reader already parses. */
function threadKeyOf(headers: Readonly<Record<string, string>>): string | null {
  const normalize = (value: string | undefined): string | null => {
    const token = value?.trim().match(/^<([^>]*)>$/)?.[1] ?? value?.trim() ?? null;
    return token !== null && token.length > 0 ? token : null;
  };
  return normalize(headers["references"]?.split(/\s+/).filter(Boolean)[0])
    ?? normalize(headers["in-reply-to"]) ?? normalize(headers["message-id"]);
}

/** A mailbox directory's messages, most recently delivered first, by a name
 * observation only (lstat): a regular file is a message, a directory or a
 * symlink is not. The one derivation of "what counts as a message" for the
 * list and for the count of messages waiting. An entry that could not be
 * observed now is not known to be no message; the directory says so. */
function entriesIn(directory: string, arrivals: ReadonlyMap<string, number>): { readonly entries: readonly Entry[]; readonly unreadable: string | null } {
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
      if (unknown !== null) unreadable ??= exceptionText(unknown);
      continue;
    }
    if (stat.isFile()) entries.push({ name, deliveredAtMs: arrivals.get(arrivalKeyOf(name)) ?? stat.mtimeMs });
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
function rowsIn(directory: string, unread: boolean, budget: number,
    arrivals: ReadonlyMap<string, number>, party: (local: string) => string,
    selected?: readonly Entry[]): DirectoryRows {
  const rows: { row: MailRow; deliveredAtMs: number; threadKey: string | null }[] = [];
  const listed = selected === undefined ? entriesIn(directory, arrivals) : { entries: selected, unreadable: null };
  let unreadable = listed.unreadable;
  const shown = listed.entries.slice(0, Math.max(0, budget));
  for (const { name, deliveredAtMs } of shown) {
    const path = join(directory, name);
    const read = readBounded(path, HEADER_LIMIT);
    if (read.kind === "unreadable") { unreadable ??= read.reason; continue; }
    if (read.kind === "none") continue;
    const { headers } = parseMessage(read.text);
    const to = recipientNames(headers["to"], party);
    rows.push({
      // AV-11: the link's arrival time (journal, or the inode as its fallback),
      // not the immutable object's mtime the bounded read observed.
      deliveredAtMs,
      threadKey: threadKeyOf(headers),
      row: Object.freeze({
        id: name,
        from: party(addressName(headers["from"])),
        ...(to === undefined ? {} : { to }),
        kind: headers["x-oma-kind"] ?? "message",
        subject: headers["subject"] ?? "(No subject)",
        unread,
        path,
        threadCount: 1,
        earlier: [],
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
type Entry2 = { readonly row: MailRow; readonly deliveredAtMs: number; readonly threadKey: string | null };

/** One row per thread: the latest arrival carries the count, and is placed
 * where it arrived; an unread member makes the folded row unread. Messages
 * without a thread key stay single rows. */
function foldThreads(entries: readonly Entry2[]): readonly Entry2[] {
  const groups = new Map<string, Entry2[]>();
  for (const entry of entries) {
    if (entry.threadKey === null) continue;
    const group = groups.get(entry.threadKey) ?? [];
    group.push(entry); groups.set(entry.threadKey, group);
  }
  const folded: Entry2[] = [];
  for (const entry of entries) {
    if (entry.threadKey === null || groups.get(entry.threadKey)!.length < 2) { folded.push(entry); continue; }
    const group = groups.get(entry.threadKey)!;
    // "Latest" is the list's own order: most recent arrival first, a stable
    // name order for a tie. The thread's other members fold under it.
    const ordered = [...group].sort((a, b) => b.deliveredAtMs - a.deliveredAtMs
      || a.row.id.localeCompare(b.row.id));
    const latest = ordered[0]!;
    if (entry !== latest) continue;   // earlier members fold into the latest
    const earlier = ordered.slice(1).reverse().map(member => member.row.path);
    folded.push({ ...latest, row: Object.freeze({ ...latest.row,
      unread: group.some(member => member.row.unread),
      threadCount: group.length, earlier }) });
  }
  return folded;
}

function byArrival(rows: readonly Entry2[]): readonly MailRow[] {
  return [...rows]
    .sort((left, right) => right.deliveredAtMs - left.deliveredAtMs || left.row.id.localeCompare(right.row.id))
    .map(entry => entry.row);
}

/** The roster disambiguates actor names that resemble topic addresses.
 * Actor names and broadcast addresses remain stable; headers are untouched. */
export function readMailbox(paths: MailboxPaths, roster?: MailRoster): MailboxRead {
  const party = mailNamerFor(roster);
  const budget = READ_BOUNDS.mailListRows.value;
  const journal = arrivalJournal(dirname(paths.newDir));
  const pending = rowsIn(paths.newDir, true, budget, journal.arrivals, party);
  const settled = rowsIn(paths.curDir, false, budget - pending.rows.length, journal.arrivals, party);
  // Threads fold across both directories -- a thread can straddle them -- but
  // the screen's contract stays: unread rows first, by arrival, then read rows.
  const folded = foldThreads([...pending.rows, ...settled.rows]);
  const unreadRows = folded.filter(entry => entry.row.unread);
  const readRows = folded.filter(entry => !entry.row.unread);
  return Object.freeze({
    rows: Object.freeze([...byArrival(unreadRows), ...byArrival(readRows)]),
    unreadable: journal.unreadable ?? pending.unreadable ?? settled.unreadable,
    omitted: pending.omitted + settled.omitted,
  });
}

/** Human overview of published society mail, not the engine's delivery inbox.
 * Archive and worker-board links are publication evidence; unaccepted objects
 * in mail/objects are never displayed. Every message has its own selectable
 * row, including sent GOALs and separate replies to the same question. */
export function readSocietyMail(stateRoot: string, roster?: MailRoster): MailboxRead {
  const party = mailNamerFor(roster);
  const published = publishedMailEntries(stateRoot);
  const selected = published.entries;
  let unreadable = published.unreadable;
  const pending = listDir(principalMailbox(stateRoot).newDir);
  if ("unreadable" in pending) unreadable ??= pending.unreadable;
  const pendingIds = new Set("names" in pending ? pending.names.map(arrivalKeyOf) : []);
  const metadata = selected.length === 0 ? { requesters: new Map<string, string>(), unreadable: null }
    : readMailNotices(stateRoot, selected.map(entry => arrivalKeyOf(entry.name)));
  unreadable ??= metadata.unreadable;
  const rows: MailRow[] = [];
  for (const entry of selected) {
    const read = rowsIn(entry.directory, pendingIds.has(arrivalKeyOf(entry.name)), 1, new Map(), party, [entry]);
    unreadable ??= read.unreadable;
    for (const { row } of read.rows) {
      const requester = metadata.requesters.get(arrivalKeyOf(entry.name));
      rows.push(requester === undefined ? row : Object.freeze({ ...row, from: "OMA", kind: "notice", requester }));
    }
  }
  return Object.freeze({ rows: Object.freeze(rows), unreadable, omitted: published.omitted });
}

/** Messages not yet delivered to the Principal's session, or null when the
 * directory holding them could not be observed: never a 0 for an unread
 * mailbox. Counted by name observation alone, reading no message (P0V-43). */
export function unreadCount(paths: MailboxPaths): number | null {
  const pending = entriesIn(paths.newDir, new Map());
  return pending.unreadable === null ? pending.entries.length : null;
}

/** P0V-42, P0-5: a stored message's body, read within `limit` -- the most a
 * stored message of this society can take (`storedMailBytes` of its body
 * limit) -- and whether what was read is only its beginning. */
export function readBody(path: string, limit: number): MailBody | null {
  const read = readBounded(path, limit);
  return read.kind === "read" ? Object.freeze({ text: parseMessage(read.text).body, truncated: !read.complete }) : null;
}
