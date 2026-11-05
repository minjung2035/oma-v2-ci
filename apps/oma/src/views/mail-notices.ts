/** Rebuildable host presentation facts; all authority remains in the ledger. */
import type { Store } from "@oma/storage";
import { publishedMailEntries, publishedMailId } from "@oma/storage/published-mail";
import { mailNoticeViewPath, MAIL_NOTICE_VIEW_BYTES } from "@oma/storage/mail-notices";
import { replaceDerivedFile as writeAtomic, replaceDerivedFileAt } from "@oma/storage/durable-fs";
import { StoreError } from "@oma/domain/errors";
import { basename } from "node:path";

export function publishMailNoticeView(store: Pick<Store, "integrationNoticeRequester">, stateRoot: string, control: { readonly directoryFd?: number } = {}): void {
  const published = publishedMailEntries(stateRoot, control);
  if (published.unreadable === null) {
    const messages = published.entries.map(entry => {
      const id = publishedMailId(entry.name);
      return { id, requester: store.integrationNoticeRequester(id) };
    });
    const text = JSON.stringify({ schema: 1, messages });
    if (Buffer.byteLength(text) > MAIL_NOTICE_VIEW_BYTES) throw new StoreError("LIMIT_EXCEEDED", "Mail notice view exceeds its bound");
    const path = mailNoticeViewPath(stateRoot);
    if (control.directoryFd === undefined) writeAtomic(path, text, 0o600);
    else replaceDerivedFileAt(control.directoryFd, basename(path), path, text, 0o600);
  }
}
