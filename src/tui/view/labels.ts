/** Words the screens use for closed vocabularies. */
import type { ApplyScope } from "../model.js";

const APPLY_LABEL: Readonly<Record<ApplyScope, string>> = Object.freeze({
  immediate: "즉시 적용",
  "next-activation": "다음 worker 활성화부터",
  "next-session": "다음 세션부터",
  restart: "재시작 후",
  "bootstrap-only": "bootstrap 전용",
});

export function applyLabel(scope: ApplyScope): string { return APPLY_LABEL[scope]; }
