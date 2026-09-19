/** The one-line notice under a screen, worded from what happened. */
import type { Notice } from "../model.js";
import { applyLabel } from "./labels.js";
import { assertNever } from "../../domain/exhaustive.js";

function worded(notice: Notice): string {
  switch (notice.kind) {
    case "saved": {
      // Arch §23.6: a confirmed value is a saved value, and the message says
      // when it actually takes effect.
      const scope = notice.apply === null ? "" : ` · ${applyLabel(notice.apply)}`;
      return `${notice.label} = ${notice.value} · 저장됨${scope}`;
    }
    case "extension":
      return `${notice.id} · ${notice.role === "principal" ? "Principal" : "Workers"} ${notice.enabled ? "사용" : "해제"} · 저장됨`;
    case "save-failed":
      // A rejected write says nothing was saved rather than leaving the old
      // value looking like it changed.
      return `저장하지 못했습니다: ${notice.message}`;
    case "text":
      return notice.text;
    default:
      return assertNever(notice);
  }
}

export function noticeText(notice: Notice | null, busy: boolean): string | null {
  const status = busy ? "· 응답 생성 중" : null;
  if (notice === null) return status;
  return status === null ? worded(notice) : `${worded(notice)} ${status}`;
}
