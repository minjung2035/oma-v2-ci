/** RFC display to logical address only; registry membership grants no authority here. */
import { isValidActorName, isValidTopicName } from "./identifiers.js";
export function logicalFromDisplay(value: unknown, society: string | undefined): string | null {
  if (typeof value !== "string" || society === undefined) return null;
  const suffix = `@${society}.oma.invalid`;
  if (!value.endsWith(suffix)) return null;
  const local = value.slice(0, -suffix.length);
  if (local === "principal" || local === "commons" || local === "residents") return local;
  if (local.startsWith("topic-")) return isValidTopicName(local.slice(6)) ? `topic/${local.slice(6)}` : null;
  return isValidActorName(local) ? local : null;
}
