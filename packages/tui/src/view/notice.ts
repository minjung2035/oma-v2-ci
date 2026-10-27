/** The one-line notice under a screen, worded from what happened. */
import type { Notice } from "../model.js";
import { applyLabel, extensionLabel } from "./labels.js";
import { assertNever } from "@oma/domain/exhaustive";

function worded(notice: Notice): string {
  switch (notice.kind) {
    case "saved": {
      // Arch §23.6: a confirmed value is a saved value, and the message says
      // when it actually takes effect.
      const scope = notice.apply === null ? "" : ` · ${applyLabel(notice.apply)}`;
      return `${notice.label} = ${notice.value} · Saved${scope}`;
    }
    case "unchanged":
      return `${notice.label} = ${notice.value} · Already set (no changes to save)`;
    case "saved-unread":
      return `${notice.label} = ${notice.value} · Saved; displayed values are unconfirmed because settings could not be read back: ${notice.reason}`;
    case "extension":
      return `${extensionLabel(notice.id, notice.source)} · ${notice.role === "principal" ? "Principal" : "Workers"} ${notice.enabled ? "enabled" : "disabled"} · Saved · ${applyLabel(notice.apply)}`;
    case "saved-unconfirmed":
      return `Saved; durability is unconfirmed (will check again before the next edit): ${notice.message}`;
    case "save-failed":
      // A rejected write says nothing was saved rather than leaving the old
      // value looking like it changed.
      return `Could not save: ${notice.message}`;
    case "send-failed":
      // Nothing was sent, and the message says where the text went: a bare
      // failure would leave the Human unsure whether to retype it. Where the
      // text went comes before why it failed, because this line is cut to the
      // screen's width and the cause is the only part of it the engine can
      // make arbitrarily long. Cut, the Human loses the reason but keeps the
      // recovery; the other order loses the recovery.
      return notice.kept === "draft"
        ? `Could not send; input remains in the draft: ${notice.message}`
        : `Could not send; input is kept in the conversation: ${notice.message}`;
    case "prompt-limit":
      // The way out differs by cause, so the wording does. Telling the Human
      // to press Backspace after a refused paste would have them delete their
      // own last character to recover from a paste that added none.
      return notice.cause === "paste"
        ? "Paste limit exceeded; nothing was inserted. Continue typing or paste in smaller parts."
        : "Input limit exceeded; not sent. Use Backspace to shorten it.";
    case "text":
      return notice.text;
    default:
      return assertNever(notice);
  }
}

export function noticeText(notice: Notice | null, busy: boolean): string | null {
  const status = busy ? "· Generating response" : null;
  if (notice === null) return status;
  return status === null ? worded(notice) : `${worded(notice)} ${status}`;
}
