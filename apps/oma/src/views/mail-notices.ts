/** Rebuildable host presentation facts; all authority remains in the ledger. */
import type { Store } from "@oma/storage";
import { publishedMailEntries, publishedMailId } from "@oma/storage/published-mail";
import { mailNoticeViewPath, MAIL_NOTICE_VIEW_BYTES } from "@oma/storage/mail-notices";
import { replaceDerivedFile as writeAtomic } from "@oma/storage/durable-fs";
import { StoreError } from "@oma/domain/errors";

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
