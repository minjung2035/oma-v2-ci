/** MCS-T01..T09: one owner for provider schemas and non-coercing action checks.
 * No authority, source reads, default application or execution lives here. */
import type { Json, MutationMethod, ProtocolLimits } from "@oma/contracts";
import { checkArray, checkBool, checkEnum, checkObject, checkOptional, checkString, type Check } from "./validation.js";
import { StoreError } from "./errors.js";
import { logicalFromDisplay } from "./display-address.js";
import { isLogicalAddress } from "./mail-values.js";
import { canonicalCollaborationJson } from "./collaboration-targets.js";
import { isValidActorName, isValidFullOid } from "./identifiers.js";

export type CollaborationParameterBounds = Pick<ProtocolLimits, "addresses">;
function recipientBound(bounds: CollaborationParameterBounds): number {
  if (!Number.isSafeInteger(bounds.addresses) || bounds.addresses < 1) throw new TypeError("invalid collaboration recipient bound");
  return bounds.addresses;
}
interface Field {
  readonly schema: { readonly [key: string]: Json };
  readonly check: Check;
  readonly optional?: true;
}
const string = (description: string, nonempty = false): Field => ({
  schema: { type: "string", description, ...(nonempty ? { minLength: 1 } : {}) },
  check: checkString(nonempty ? { min: 1 } : undefined),
});
const enumeration = (values: string[], description: string): Field => ({
  schema: { type: "string", enum: values, description }, check: checkEnum(values),
});
const optional = (field: Field): Field => ({ ...field, check: checkOptional(field.check), optional: true });
const array = (field: Field, description: string, minimum?: number): Field => ({
  schema: { type: "array", items: { ...field.schema }, description, ...(minimum === undefined ? {} : { minItems: minimum }) },
  check: checkArray(field.check, minimum === undefined ? undefined : { min: minimum }),
});
const object = (fields: Readonly<Record<string, Field>>, description?: string): Field => ({
  schema: { type: "object", additionalProperties: false,
    properties: Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, { ...field.schema }])),
    required: Object.entries(fields).filter(([, field]) => !field.optional).map(([name]) => name),
    ...(description === undefined ? {} : { description }) },
  check: checkObject(Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, field.check]))),
});
const content = (description: string): Field => object({
  kind: enumeration(["text", "file"], "Use text for an inline body or file to read a permitted UTF-8 file once."),
  value: string("The complete inline text, or the path of the file whose bytes become the body. A file path is not sent to the recipient."),
}, description);
const revision = string("Full current context commit OID from goal/status.json. Use null only to assert that no context has been published.", true);
const definitions: Readonly<Record<string, Field>> = Object.freeze({
  oma_send: object({
    to: array(string("A Worker, principal, commons/residents, topic/<name>, or a displayed project address.", true),
      "Explicit recipients. A Worker may use @self alone for a continuation note; no optional fields may accompany it.", 1),
    content: content("The message body, supplied inline or from an existing file. The body never supplies routing or authority."),
    subject: optional(string("Optional single-line subject. Omit to inherit the reply subject or derive one from the first nonblank body line.")),
    replyTo: optional(string("Existing message ID or displayed message reference. This links the thread; it does not choose or expand recipients.", true)),
    attachments: optional(array(object({ commit: string("Committed project revision, resolved once. A Principal must use an already accessible published full commit OID.", true) }),
      "Committed project trees to share. Uncommitted edits are excluded; a path summary would not limit access to the published tree.")),
    urgent: optional({ schema: { type: "boolean", description: "Use true for time-sensitive coordination. This does not grant authority or guarantee preemption." }, check: checkBool() }),
  }),
  oma_spawn: object({
    name: string("New unique Worker name. This names a colleague, not a task or a disposable retry attempt.", true),
    from: string("Commit revision for the new clone. OMA freezes it once and publishes it if necessary and permitted; uncommitted work is excluded.", true),
    brief: content("Inline text or a file describing the outcome, relevant context, interfaces, evidence, and how to report results. This is a brief, not a shell command."),
  }),
  oma_merge: object({
    reason: string("Evidence and rationale for the requested integration or exact existing-proposal action."),
    tier: enumeration(["LOW", "MEDIUM", "HIGH"], "Requested risk tier; policy may raise it but never silently lower it."),
    proposal: optional(string("Exact proposal or submission record reference for an existing request; omit to create a new proposal.", true)),
    change: optional(object({ candidate: string("Committed candidate revision to freeze once.", true),
      base: optional(string("Exact committed base revision; omitted base uses the recorded project base.", true)) })),
    title: optional(string("Optional short title. Omission on an existing proposal preserves its title.")),
  }),
  oma_challenge: object({
    merge: string("Exact applied record reference identifying the immutable integration being challenged.", true),
    reason: string("Why the applied change needs correction, with evidence and the intended outcome."),
    tier: enumeration(["LOW", "HIGH"], "Requested correction risk tier; the existing challenge policy remains authoritative."),
    proposal: optional(string("Exact proposal record reference for an existing challenge.", true)),
    replacement: optional(object({ candidate: string("Exact committed correction candidate.", true), base: string("Exact committed correction base.", true) })),
    title: optional(string("Optional short title; omission preserves an existing challenge title.")),
  }),
  oma_review: object({
    target: string("Exact review, vote, proposal or submission record reference for this decision. A request name alone is not an exact target.", true),
    decision: enumeration(["approve", "reject", "withdraw"], "Record this exact decision; withdraw affects only your exact vote or your own eligible request."),
    reason: string("Evidence and rationale for the decision. This text is not a substitute for the exact target."),
  }),
  oma_wait: object({}),
  oma_follow: object({
    topic: string("Topic name without the topic/ prefix, using the project's topic-name syntax.", true),
    enabled: { schema: { type: "boolean", description: "true subscribes you to future topic delivery; false removes your subscription." }, check: checkBool() },
  }),
  oma_goal: object({
    content: content("The complete new GOAL text, inline or from a readable file. This replaces GOAL.md, not the other context files."),
    expectedRevision: { schema: { anyOf: [{ ...revision.schema }, { type: "null" }], description: revision.schema.description! },
      check: value => value === null ? null : revision.check(value) },
  }),
  oma_society: object({ action: enumeration(["open", "close"], "open permits Worker execution; close requests its termination while preserving durable state.") }),
});
const methods: Readonly<Record<string, readonly MutationMethod[]>> = Object.freeze({
  oma_send: ["mail.send", "agent.continue"], oma_spawn: ["agent.create"], oma_merge: ["attest.record"],
  oma_challenge: ["attest.record"], oma_review: ["attest.record"],
  oma_follow: ["route.follow", "route.unfollow"], oma_goal: ["context.publish"], oma_society: ["society.set"],
});
/** Match Pi's optional-null normalization without changing the recorded raw call.
 * Required null (notably GOAL's expectedRevision) is preserved, never defaulted. */
export function collaborationArguments(tool: string, value: unknown): { [key: string]: Json } {
  if (!Object.hasOwn(definitions, tool)) throw new StoreError("INVALID_REQUEST", "unknown collaboration action");
  const raw: Json = JSON.parse(canonicalCollaborationJson(value));
  const normalize = (input: Json, schema: { readonly [key: string]: Json }): Json => {
    if (Array.isArray(input) && schema.type === "array" && schema.items !== null && typeof schema.items === "object" && !Array.isArray(schema.items))
      return input.map(item => normalize(item, schema.items as { [key: string]: Json }));
    if (input === null || typeof input !== "object" || Array.isArray(input) || schema.type !== "object") return input;
    const properties = schema.properties;
    if (properties === null || typeof properties !== "object" || Array.isArray(properties)) throw new TypeError("invalid owned parameter schema");
    const required = Array.isArray(schema.required) ? schema.required : [];
    const entries: [string, Json][] = [];
    for (const [key, child] of Object.entries(input)) {
      const field = Object.hasOwn(properties, key) ? properties[key] : undefined;
      if (field !== undefined && child === null && !required.includes(key)) continue;
      entries.push([key, field !== null && typeof field === "object" && !Array.isArray(field) ? normalize(child, field) : child]);
    }
    return Object.fromEntries(entries);
  };
  const normalized = normalize(raw, definitions[tool]!.schema);
  const problem = definitions[tool]!.check(normalized);
  if (problem !== null || normalized === null || typeof normalized !== "object" || Array.isArray(normalized))
    throw new StoreError("INVALID_REQUEST", problem ?? "action arguments must be an object");
  if (["oma_merge", "oma_challenge", "oma_review"].includes(tool) &&
      (typeof normalized.reason !== "string" || normalized.reason.trim().length === 0))
    throw new StoreError("INVALID_REQUEST", "a nonblank reason is required");
  return normalized;
}
export function collaborationInputProblem(tool: string, value: unknown, bounds?: CollaborationParameterBounds): string | null {
  try {
    const args = collaborationArguments(tool, value);
    if (tool === "oma_send" && bounds !== undefined && Array.isArray(args.to) && args.to.length > recipientBound(bounds))
      return `to exceeds the effective recipient bound of ${bounds.addresses}`;
    return null;
  } catch (error) { return error instanceof Error ? error.message : String(error); }
}
/** Independent copies: provider serializers and extensions cannot mutate the input owner. */
export function collaborationParameters(tool: string, role: "resident" | "principal", bounds?: CollaborationParameterBounds): { [key: string]: Json } {
  if (!Object.hasOwn(definitions, tool)) throw new TypeError("unknown collaboration action");
  const schema: { [key: string]: Json } = JSON.parse(JSON.stringify(definitions[tool]!.schema));
  if (tool === "oma_send" && bounds !== undefined) {
    const properties = schema.properties as { [key: string]: { [key: string]: Json } };
    properties.to!.maxItems = recipientBound(bounds);
  }
  if (tool === "oma_send" && role === "principal") {
    const properties = schema.properties as { [key: string]: { [key: string]: Json } };
    properties.to!.description = "Explicit recipients: a Worker, principal, commons/residents, topic/<name>, or a displayed project address.";
    const attachments = properties.attachments!.items as { properties: { commit: { description: string } } };
    attachments.properties.commit.description = "Full commit OID of an already accessible published commit, copied from a permitted record.";
  }
  return schema;
}
export function collaborationMutationMethods(tool: string): readonly MutationMethod[] {
  return Object.hasOwn(methods, tool) ? [...methods[tool]!] : [];
}
/** Called only after the action check. There is no model-provided raw method. */
export function collaborationMutationMethod(tool: string, value: unknown): MutationMethod {
  value = collaborationArguments(tool, value);
  if (tool === "oma_send" && value !== null && typeof value === "object" && "to" in value &&
      Array.isArray(value.to) && value.to.includes("@self")) {
    if (value.to.length !== 1 || Object.keys(value).some(key => !["to", "content"].includes(key)))
      throw new TypeError("@self must be the sole recipient and forbids optional fields by presence");
    return "agent.continue";
  }
  if (tool === "oma_follow") {
    if (value === null || typeof value !== "object" || !("enabled" in value) || typeof value.enabled !== "boolean")
      throw new TypeError("invalid follow action");
    return value.enabled ? "route.follow" : "route.unfollow";
  }
  const method = collaborationMutationMethods(tool)[0];
  if (method === undefined) throw new TypeError("this action does not create a mutation binding");
  return method;
}

/** Source-free drivers shared by the model adapter and protected host verification.
 * Source-bearing actions must use protected staging, not mutable rereads on retry. */
export function collaborationInlineParameters(tool: string, value: unknown,
  scope: { readonly society?: string; readonly role?: "resident" | "principal"; readonly subjectBytes?: number } = {},
): { method: MutationMethod; params: { [key: string]: Json } } {
  const args = collaborationArguments(tool, value);
  const method = collaborationMutationMethod(tool, value);
  if (tool === "oma_follow" && typeof args.topic === "string") return { method, params: { topic: args.topic } };
  if (tool === "oma_society") return { method, params: { state: args.action === "open" ? "open" : "closed" } };
  if (tool === "oma_spawn") {
    if (scope.role === "principal" || !isValidActorName(args.name) || !isValidFullOid(args.from) ||
        args.brief === null || typeof args.brief !== "object" || Array.isArray(args.brief) ||
        args.brief.kind !== "text" || typeof args.brief.value !== "string")
      throw new StoreError("UNSUPPORTED_PROFILE", "this spawn driver requires a frozen full commit OID and an inline brief");
    if (args.brief.value.trim().length === 0) throw new StoreError("INVALID_REQUEST", "Worker brief must not be blank");
    return { method, params: { name: args.name, from: args.from, brief: args.brief.value } };
  }
  if (tool !== "oma_send" || !Array.isArray(args.to) || !args.to.every((item): item is string => typeof item === "string") ||
      args.content === null || typeof args.content !== "object" || !("kind" in args.content) || args.content.kind !== "text" ||
      !("value" in args.content) || typeof args.content.value !== "string" || Object.hasOwn(args, "replyTo") ||
      (Object.hasOwn(args, "attachments") && (!Array.isArray(args.attachments) || args.attachments.length !== 0)))
    throw new StoreError("UNSUPPORTED_PROFILE", "this action requires a protected source/publication staging driver");
  const body = args.content.value;
  if (method === "agent.continue") {
    if (scope.role === "principal" || body.trim().length === 0) throw new StoreError("INVALID_REQUEST", "@self requires a Worker's nonblank continuation note");
    return { method, params: { note: body } };
  }
  const to = [...new Set(args.to.map(address => logicalFromDisplay(address, scope.society) ?? address))].sort();
  if (!to.every(isLogicalAddress)) throw new StoreError("INVALID_REQUEST", "invalid explicit mail recipient");
  const maximum = scope.subjectBytes ?? 512;
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new TypeError("invalid host subject byte bound");
  let subject: unknown = args.subject;
  if (!Object.hasOwn(args, "subject")) {
    const derived = (body.split(/\r\n|\r|\n/u).find(line => line.trim().length > 0)?.trim() ?? "Message")
      .replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ");
    subject = "";
    let bytes = 0;
    for (const point of derived) {
      bytes += Buffer.byteLength(point, "utf8");
      if (bytes > maximum) break;
      subject += point;
    }
  }
  if (typeof subject !== "string" || /[\u0000-\u001f\u007f-\u009f]/u.test(subject) || Buffer.byteLength(subject, "utf8") > maximum)
    throw new StoreError("INVALID_REQUEST", "explicit mail subject contains controls or exceeds its byte bound");
  return { method, params: { to, subject, kind: args.urgent === true ? "critical" : "message", body,
    collaboration: { version: "collaboration-v1", resolutions: [], attachments: [] } } };
}
