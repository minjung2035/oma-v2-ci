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
    case "unchanged":
      return `${notice.label} = ${notice.value} · 이미 이 값입니다(저장할 변경 없음)`;
    case "saved-unread":
      return `${notice.label} = ${notice.value} · 저장됨 · 설정을 다시 읽지 못해 화면 값은 확인되지 않았습니다: ${notice.reason}`;
    case "extension":
      return `${notice.id} · ${notice.role === "principal" ? "Principal" : "Workers"} ${notice.enabled ? "사용" : "해제"} · 저장됨`;
    case "saved-unconfirmed":
      return `저장됨 · 디스크에 남았는지는 아직 확인되지 않았습니다(다음 편집 전에 다시 확인합니다): ${notice.message}`;
    case "save-failed":
      // A rejected write says nothing was saved rather than leaving the old
      // value looking like it changed.
      return `저장하지 못했습니다: ${notice.message}`;
    case "send-failed":
      // Nothing was sent, and the message says where the text went: a bare
      // failure would leave the Human unsure whether to retype it. Where the
      // text went comes before why it failed, because this line is cut to the
      // screen's width and the cause is the only part of it the engine can
      // make arbitrarily long. Cut, the Human loses the reason but keeps the
      // recovery; the other order loses the recovery.
      return notice.kept === "draft"
        ? `전송하지 못했습니다 · 입력은 그대로 있습니다: ${notice.message}`
        : `전송하지 못했습니다 · 대화에 남겨 두었습니다: ${notice.message}`;
    case "prompt-limit":
      // The way out differs by cause, so the wording does. Telling the Human
      // to press Backspace after a refused paste would have them delete their
      // own last character to recover from a paste that added none.
      return notice.cause === "paste"
        ? "붙여넣기 한도 초과 · 아무것도 입력되지 않았습니다. 계속 입력하거나 나눠서 붙여넣어 주세요."
        : "입력 한도 초과 · 전송하지 않습니다. Backspace로 줄여 주세요.";
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
