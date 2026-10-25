/** Host-private, rebuildable notice projection. The broker owns the ledger;
 * the Human's Mail screen reads only this bounded presentation file. */
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { isValidActor, isValidMessageId } from "@oma/domain/identifiers";
import { READ_BOUNDS } from "@oma/domain/surface-bounds";

export const mailNoticeViewPath = (stateRoot: string): string => join(stateRoot, "mail-notices.json");
export const MAIL_NOTICE_VIEW_BYTES = 256 * 1024;
export function readMailNotices(stateRoot: string, ids: readonly string[]): {
  readonly requesters: ReadonlyMap<string, string>; readonly unreadable: string | null;
} {
  const requesters = new Map<string, string>();
  let fd: number | undefined;
  try {
    fd = openSync(mailNoticeViewPath(stateRoot), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAIL_NOTICE_VIEW_BYTES) throw new Error("Invalid notice view");
    const buffer = Buffer.alloc(stat.size);
    let filled = 0;
    while (filled < buffer.length) {
      const count = readSync(fd, buffer, filled, buffer.length - filled, null);
      if (count === 0) throw new Error("Incomplete notice view");
      filled += count;
    }
    const view = JSON.parse(buffer.toString("utf8"));
    if (view?.schema !== 1 || !Array.isArray(view.messages) || view.messages.length > READ_BOUNDS.mailListRows.value)
      throw new Error("Invalid notice view");
    const observed = new Set<string>();
    for (const row of view.messages) {
      if (!row || !isValidMessageId(row.id) || observed.has(row.id) ||
          (row.requester !== null && !isValidActor(row.requester))) throw new Error("Invalid notice row");
      observed.add(row.id);
      if (row.requester !== null) requesters.set(row.id, row.requester);
    }
    return { requesters, unreadable: ids.every(id => observed.has(id)) ? null : "Automatic notice metadata is refreshing" };
  } catch {
    return { requesters: new Map(), unreadable: "Could not read automatic notice metadata" };
  } finally { if (fd !== undefined) closeSync(fd); }
}
