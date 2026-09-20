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
    case "send-failed":
      // Nothing was sent and the text is still in the prompt, so the message
      // says both: a bare failure would leave the Human unsure whether to
      // retype it.
      return `전송하지 못했습니다: ${notice.message} · 입력은 그대로 남겨 두었습니다.`;
    case "prompt-limit":
      return "입력 한도 초과 · 전송하지 않습니다. Backspace로 줄여 주세요.";
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
