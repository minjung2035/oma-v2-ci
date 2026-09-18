/** TUI-011: the Mail screen's read-only view of the Principal mailbox.
 *
 * The eml files are the originals (FS-006). This module reads them as the host
 * and derives what it shows; it writes nothing, moves nothing between new and
 * cur, and stores no read state. "Unread" is the Maildir position the broker
 * already owns, not a new durable flag.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { MailRow } from "../model.js";
import { READ_BOUNDS } from "../limits.js";

export interface MailboxPaths {
  readonly newDir: string;
  readonly curDir: string;
}

export function principalMailbox(stateRoot: string): MailboxPaths {
  const base = join(stateRoot, "mail", "inboxes", "principal");
  return Object.freeze({ newDir: join(base, "new"), curDir: join(base, "cur") });
}

const HEADER_LIMIT = READ_BOUNDS.mailHeaderBytes.value;

function decodeWord(text: string): string {
  return text.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (whole, charset: string, encoding: string, payload: string) => {
    if (!/^utf-?8$/i.test(charset)) return whole;
    try {
      if (encoding.toLowerCase() === "b") return Buffer.from(payload, "base64").toString("utf8");
      const bytes = payload.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
      return Buffer.from(bytes, "binary").toString("utf8");
    } catch { return whole; }
  });
}

export interface ParsedMessage {
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** Folded headers are joined before lookup so that a wrapped Subject is not
 * silently truncated at the fold.
 */
export function parseMessage(text: string): ParsedMessage {
  const split = text.indexOf("\n\n");
  const head = split < 0 ? text : text.slice(0, split);
  const body = split < 0 ? "" : text.slice(split + 2);
  const headers: Record<string, string> = {};
  let field = "";
  const commit = (): void => {
    const colon = field.indexOf(":");
    if (colon > 0) headers[field.slice(0, colon).trim().toLowerCase()] = decodeWord(field.slice(colon + 1).trim());
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

function listDir(path: string): readonly string[] {
  try { return readdirSync(path).sort(); } catch { return []; }
}

function rowFrom(path: string, name: string, unread: boolean): MailRow | null {
  let text: string;
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return null;
    text = readFileSync(path, "utf8").slice(0, HEADER_LIMIT);
  } catch { return null; }
  const { headers } = parseMessage(text);
  return Object.freeze({
    id: name,
    from: addressName(headers["from"]),
    kind: headers["x-oma-kind"] ?? "message",
    subject: headers["subject"] ?? "(제목 없음)",
    unread,
    path,
  });
}

/** Newest first: the mailbox is a list to scan, not a queue to drain. */
export function readMailbox(paths: MailboxPaths): readonly MailRow[] {
  const rows: MailRow[] = [];
  for (const name of listDir(paths.newDir)) {
    const row = rowFrom(join(paths.newDir, name), name, true);
    if (row) rows.push(row);
  }
  for (const name of listDir(paths.curDir)) {
    const row = rowFrom(join(paths.curDir, name), name, false);
    if (row) rows.push(row);
  }
  return Object.freeze(rows.reverse());
}

export function unreadCount(paths: MailboxPaths): number {
  return listDir(paths.newDir).length;
}

export function readBody(path: string, limit = READ_BOUNDS.mailBodyBytes.value): string | null {
  try { return parseMessage(readFileSync(path, "utf8").slice(0, limit)).body; } catch { return null; }
}
