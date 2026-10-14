/** Rebuildable host presentation facts; all authority remains in the ledger. */
import type { Store } from "../store.js";
import { publishedMailEntries, publishedMailId } from "../storage/published-mail.js";
import { mailNoticeViewPath, MAIL_NOTICE_VIEW_BYTES } from "../storage/mail-notices.js";
import { replaceDerivedFile as writeAtomic } from "../storage/durable-fs.js";
import { StoreError } from "../domain/errors.js";

export function publishMailNoticeView(store: Pick<Store, "integrationNoticeRequester">, stateRoot: string): void {
  const published = publishedMailEntries(stateRoot);
  if (published.unreadable === null) {
    const messages = published.entries.map(entry => {
      const id = publishedMailId(entry.name);
      return { id, requester: store.integrationNoticeRequester(id) };
    });
    const text = JSON.stringify({ schema: 1, messages });
    if (Buffer.byteLength(text) > MAIL_NOTICE_VIEW_BYTES) throw new StoreError("LIMIT_EXCEEDED", "Mail notice view exceeds its bound");
    writeAtomic(mailNoticeViewPath(stateRoot), text, 0o600);
  }
}
