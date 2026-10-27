/** Words the screens use for closed vocabularies. */
import type { ApplyScope } from "../model.js";

const APPLY_LABEL: Readonly<Record<ApplyScope, string>> = Object.freeze({
  immediate: "Applies immediately",
  "next-activation": "Next worker activation",
  "next-session": "Next session",
  restart: "After restart",
  "bootstrap-only": "Bootstrap only",
  "new-agents": "New workers only",
});

export function applyLabel(scope: ApplyScope): string { return APPLY_LABEL[scope]; }

/** An extension as the Human knows it: its file in the installation, or
 * (DR25) the package it came from and its file there. */
export function extensionLabel(id: string, source?: string): string {
  return source === undefined ? id : `${source} · ${id.split("/").slice(-2).join("/")}`;
}
