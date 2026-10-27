/** Helpers every part of the trusted extension uses. Like the rest of
 * `src/extension/`, this imports no OMA runtime module (PI-001). */

import { createHash } from "node:crypto";
import { logicalFromDisplay } from "@oma/domain/display-address";
import { isValidActorName as validActorName, isValidRequestKey as validRequestKey } from "@oma/domain/identifiers";

export function integerEnv(name: string): number | null {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
export function textResult(text: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text" as const, text }], details };
}
/** A value that does not fit its slot is refused before anything is started. */
export function refused(what: string, value: unknown): never {
  throw new Error(`${what} is not valid: ${JSON.stringify(value)?.slice(0, 120)}`);
}
/** AV30, AV15's rule for every slot that names an actor: the name OMA shows
 * for it -- the bare name, or this society's address as a header or notice
 * shows it. A new name is not one OMA has shown, so creation keeps its own check. */
export function actorNameOf(value: unknown, society: string | undefined, what: string): string {
  const logical: unknown = logicalFromDisplay(value, society) ?? value;
  return typeof logical === "string" && validActorName(logical) ? logical : refused(what, value);
}
/** What a tool knows of the call it serves: the engine's call id and, when
 * the engine gives it, the session the call is in. */
export interface ToolCallOrigin {
  readonly id: string;
  readonly tool: string;
  readonly params: Record<string, unknown>;
  readonly context?: { readonly sessionManager?: { getSessionId(): string; getBranch(): readonly unknown[] } } | undefined;
}

/** Sorted keys, so one set of arguments has one spelling. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
const withoutRequest = (params: unknown): unknown => {
  if (params === null || typeof params !== "object" || Array.isArray(params)) return params;
  const { request: _omitted, ...rest } = params as Record<string, unknown>;
  return rest;
};

/** How many calls of this tool with these arguments already have a result
 * on the session's branch (the call being served has none yet). */
function answeredAlike(origin: ToolCallOrigin, branch: readonly unknown[]): number {
  const target = canonical([origin.tool, withoutRequest(origin.params)]);
  const calls = new Map<string, string>();
  let answered = 0;
  for (const entry of branch) {
    const message = (entry as { type?: unknown; message?: { role?: unknown; content?: unknown; toolCallId?: unknown } }).message;
    if ((entry as { type?: unknown }).type !== "message" || message === undefined) continue;
    if (message.role === "assistant" && Array.isArray(message.content))
      for (const block of message.content as { type?: unknown; id?: unknown; name?: unknown; arguments?: unknown }[])
        if (block.type === "toolCall" && typeof block.id === "string")
          calls.set(block.id, canonical([block.name, withoutRequest(block.arguments)]));
    if (message.role === "toolResult" && typeof message.toolCallId === "string" && calls.get(message.toolCallId) === target) answered += 1;
  }
  return answered;
}

/** What the model is told of `request` (P0V-110). */
export const REQUEST_PARAMETER_HELP =
  "Optional request key. Without one, calling again with the same arguments before you have seen a result is the same request, done once; give a new key to do the same thing again.";

/** P0V-110 (seventh review F-07, P0-4, P0-5): the request key a tool call
 * is made under -- the model's, if it gives one, and otherwise one the call
 * itself determines, so that it is known again when the call's result was
 * not. A result can be lost after the broker accepted the effect (the engine
 * died before recording it); the engine then answers the call with "No
 * result provided" and does not run it again, and the model makes the call
 * again. The key is derived from the session, the tool, the arguments and
 * how many calls alike already had a result: the repeated call of a lost
 * result gets the same key, which the broker answers with the first
 * effect's receipt; a call made after a result the model saw gets a new one.
 * Without the engine's session the call's own id stands in for it. */
export function requestKeyOf(value: unknown, origin: ToolCallOrigin): string {
  if (value !== undefined) return validRequestKey(value) ? value : refused("request key", value);
  const manager = origin.context?.sessionManager;
  const identity = manager === undefined
    ? ["call", origin.id, origin.tool, withoutRequest(origin.params)]
    : ["session", manager.getSessionId(), origin.tool, withoutRequest(origin.params), answeredAlike(origin, manager.getBranch())];
  return `pi-${createHash("sha256").update(canonical(identity)).digest("hex").slice(0, 40)}`;
}
