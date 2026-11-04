/** Original-call capture, authorized continuation and observational reconnection
 * on Pi's own boundaries. No background executor or replacement session lives here. */
import { createHash } from "node:crypto";
import { basename, isAbsolute } from "node:path";
import type { ContextWithSystemEvent, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Json } from "@oma/contracts";
import type { InvocationOrigin } from "@oma/contracts/public-wire";
import { ClientError, SubmissionPublicationError, type Client } from "@oma/client";
import { decodeReceipt } from "@oma/protocol/receipt-codec";
import { canonicalCollaborationJson } from "@oma/domain/collaboration-targets";
import { collaborationInputProblem, collaborationArguments, collaborationMutationMethod } from "@oma/domain/collaboration-inputs";
import { invocationRejectionGuidance } from "@oma/protocol/invocation-rejection";

const RECONNECTION = "oma-invocation-reconnection";
const RECORD_HEALTH = "oma-records-health";
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
export function captureInvocation(context: ExtensionContext, id: string, tool: string, args: unknown): {
  readonly origin: InvocationOrigin; readonly args: { [key: string]: Json };
} {
  const file = context.sessionManager.getSessionFile();
  if (!file || !isAbsolute(file)) throw new Error("Original Pi session file is unavailable; no new execution");
  const expected = canonicalCollaborationJson(collaborationArguments(tool, args));
  let captured: { branch: string; args: { [key: string]: Json } } | undefined;
  for (const entry of context.sessionManager.getBranch()) {
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;
    for (const block of entry.message.content) {
      if (block.type !== "toolCall" || block.id !== id) continue;
      if (captured !== undefined || block.name !== tool || canonicalCollaborationJson(collaborationArguments(tool, block.arguments)) !== expected)
        throw new Error("Original Pi call is ambiguous or its arguments changed; no new execution");
      const raw: Json = JSON.parse(canonicalCollaborationJson(block.arguments));
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Original Pi call arguments are not an object");
      captured = { branch: entry.id, args: raw };
    }
  }
  if (captured === undefined) throw new Error("Original tool call is not on the active Pi branch; no new execution");
  return { origin: { file: basename(file), session: context.sessionManager.getSessionId(), branch: captured.branch, toolCall: id }, args: captured.args };
}

/** A persisted adapter result is presentation, never an acceptance/approval source. */
export function invocationDetails(origin: InvocationOrigin, tool: string, key: string | null, acceptance: "accepted" | "absent" | "unknown" | "not-submitted") {
  return { omaInvocation: { version: 1, origin, tool, key, acceptance } };
}

/** Pure last-resort presentation. Receipt/linkage facts remain in details and
 * their original owners; failed output spooling must not reclassify acceptance. */
export function invocationPresentation(client: Client, value: unknown, facts: {
  readonly key: string | null; readonly acceptance: string; readonly execution: string | null;
  readonly operation: string | null; readonly referencedOperation?: string | null;
}): string {
  try { return client.formatInvocation(value); }
  catch {
    return JSON.stringify({ ...facts, presentation: "unavailable", guidance:
      "Complete local presentation is unavailable. These are retained original-invocation observations, not a new execution. Preserve the original key and receipt; do not create a replacement to escape uncertainty. Referenced operations are not this invocation's acceptance." });
  }
}

function branchInvocations(context: ExtensionContext, tools: readonly string[]) {
  const calls = new Map<string, { tool: string; args: unknown; branch: string }>();
  const answered = new Set<string>();
  const observations = new Map<string, { signature: string; content: string }>();
  let recordNotice: string | null = null;
  for (const entry of context.sessionManager.getBranch()) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      for (const block of entry.message.content) if (block.type === "toolCall" && tools.includes(block.name) && block.name !== "oma_wait") {
        if (calls.has(block.id)) throw new Error("Duplicate original Pi call identity; continuation remains fenced");
        calls.set(block.id, { tool: block.name, args: block.arguments, branch: entry.id });
      }
    } else if (entry.type === "message" && entry.message.role === "toolResult") {
      const details = entry.message.details;
      if (object(details) && object(details.omaInvocation) && details.omaInvocation.version === 1 &&
          (details.omaInvocation.acceptance === "accepted" || details.omaInvocation.acceptance === "not-submitted")) answered.add(entry.message.toolCallId);
    } else if (entry.type === "custom" && entry.customType === RECONNECTION && object(entry.data) &&
        entry.data.version === 1 && typeof entry.data.call === "string" && typeof entry.data.content === "string" && typeof entry.data.signature === "string") {
      observations.set(entry.data.call, { signature: entry.data.signature, content: entry.data.content });
    } else if (entry.type === "custom" && entry.customType === RECORD_HEALTH && object(entry.data) &&
        entry.data.version === 1 && (entry.data.content === null || typeof entry.data.content === "string")) {
      recordNotice = entry.data.content;
    }
  }
  return { calls, answered, observations, recordNotice };
}
export function registerInvocationReconnection(pi: ExtensionAPI, client: Client, tools: readonly string[], records: readonly string[] = [], continuationPermitted?: (name: string) => boolean, recordRoot?: string): void {
  // Diagnostic only, scoped to Pi's current run. This is not a durable work list.
  const continuationFailures = new Map<string, unknown>();
  pi.on("agent_start", async (_event, context) => {
    continuationFailures.clear();
    const signal = context.signal;
    if (!signal || signal.aborted || continuationPermitted === undefined) return; // Session loading/idle observation cannot execute.
    try {
      const { calls, answered } = branchInvocations(context, tools);
      for (const [id, call] of calls) {
        if (answered.has(id) || collaborationInputProblem(call.tool, call.args) !== null) continue;
        signal.throwIfAborted();
        if (continuationPermitted(call.tool) !== true) throw new Error("Original continuation tool is not in the current verified role loadout");
        const { origin, args } = captureInvocation(context, id, call.tool, call.args);
        try { await client.resumeInvocation(call.tool, origin, args, signal, () => continuationPermitted(call.tool)); }
        catch (error) {
          continuationFailures.set(id, error);
          // Do not pass an uncertain earlier original with another effect attempt.
          // The next request may still observe every original and do permitted work.
          break;
        }
      }
    } catch (error) {
      context.abort(); // Pi reports hook errors; abort must also fence its run.
      throw error;
    }
  });
  const observeBeforeRequest = async (event: ContextWithSystemEvent, context: ExtensionContext) => {
    const { calls, answered, observations, recordNotice } = branchInvocations(context, tools);
    // Context reconstruction observes only. It never continues or prepares an effect.
    const file = context.sessionManager.getSessionFile();
    const reconnect = [];
    for (const [id, call] of calls) {
      if (answered.has(id) || collaborationInputProblem(call.tool, call.args) !== null) continue;
      if (!file || !isAbsolute(file)) throw new Error("Original Pi session is unavailable; continuation remains fenced");
      const origin: InvocationOrigin = { file: basename(file), session: context.sessionManager.getSessionId(), branch: call.branch, toolCall: id };
      let key: string | null = null;
      let acceptance: "accepted" | "absent" | "unknown" | "not-submitted" = "unknown";
      const continuationFailure = continuationFailures.get(id);
      let outcome: Record<string, unknown>;
      try {
        const observation = await client.observeInvocation(call.tool, origin, call.args, context.signal);
        key = observation.link.key;
        if (observation.link.resolution !== undefined) {
          acceptance = "not-submitted";
          outcome = { invocation: { ...origin, key }, disposition: "existing", acceptance, execution: "not-applicable",
            operation: null, receipt: null, existing: observation.link.resolution,
            observedAt: new Date(observation.link.resolution.observedAtMs).toISOString(),
            guidance: "This original invocation durably resolved to an existing request. No new operation, revision or attempt was submitted. The referenced receipt is its recorded observation, not current authority or a new execution." };
        } else if (observation.link.rejection !== undefined) {
          const rejection = observation.link.rejection;
          acceptance = "not-submitted";
          outcome = { invocation: { ...origin, key }, disposition: "rejected", acceptance, execution: "not-applicable",
            operation: null, receipt: null, rejection, observedAt: new Date(rejection.observedAtMs).toISOString(),
            error: { reason: rejection.reason, failure: rejection.failure }, guidance: invocationRejectionGuidance(rejection.reason) };
        } else {
          acceptance = observation.receipt === null ? "absent" : "accepted";
          outcome = { invocation: { ...origin, key }, acceptance, receipt: observation.receipt, execution: observation.receipt?.state ?? null, operation: observation.receipt?.operation ?? null, publication: observation.link.publication ?? null, mail: observation.link.mail ?? null,
            observedAt: new Date().toISOString(),
            guidance: observation.receipt === null
              ? observation.link.publication?.receipt?.state === "succeeded"
                ? "Publication succeeded; no accepted review operation was observed. Continuation requires an authorized activation using this original invocation and frozen review input; never substitute current HEAD or a new key."
                : "No accepted original operation was observed. This does not authorize a new invocation or reconstruction of missing frozen sources."
              : "This is the original operation's receipt, not a new execution. Acceptance and effect completion are distinct." };
        }
      } catch (error) {
        if (key === null && error instanceof ClientError && error.request !== undefined) key = error.request;
        const decoded = error instanceof ClientError && error.request !== undefined && error.request === key ? decodeReceipt(error.receipt, { expectedKind: collaborationMutationMethod(call.tool, call.args) }) : null;
        const retained = continuationFailure instanceof ClientError && continuationFailure.request !== undefined && (key === null || continuationFailure.request === key) ? decodeReceipt(continuationFailure.receipt, { expectedKind: collaborationMutationMethod(call.tool, call.args) }) : null;
        const receipt = decoded?.ok ? decoded.value : retained?.ok ? retained.value : undefined;
        if (key === null && continuationFailure instanceof ClientError && continuationFailure.request !== undefined) key = continuationFailure.request;
        acceptance = receipt === undefined ? "unknown" : "accepted";
        outcome = { invocation: { ...origin, key }, acceptance, receipt: receipt ?? null, execution: receipt?.state ?? null, operation: receipt?.operation ?? null,
          guidance: receipt === undefined
            ? "Original acceptance could not be observed. Preserve this invocation; do not use another key, wording, proposal or Worker name to escape uncertainty."
            : "The original operation was accepted. Its receipt remains known even though its linkage could not be refreshed.",
          error: error instanceof Error ? error.message : String(error) };
      }
      outcome = { ...outcome, records, ...(continuationFailures.has(id) ? {
        continuation: { error: continuationFailure instanceof Error ? continuationFailure.message : String(continuationFailure),
          ...(continuationFailure instanceof SubmissionPublicationError ? { publication: continuationFailure.publication } : {}),
          guidance: "This activation could not continue the exact frozen original. No replacement source, key or intent was created. The receipt observation is separate; preserve the original evidence for recovery or operator repair." },
      } : {}) };
      const { observedAt: _time, ...stable } = outcome;
      const signature = createHash("sha256").update(canonicalCollaborationJson(stable)).digest("hex");
      const previous = observations.get(id);
      // Observation time is presentation, not a new outcome. Reuse the persisted
      // content (and its spool) when the original outcome did not change.
      const changed = !previous || previous.signature !== signature;
      const content = changed ? invocationPresentation(client, outcome, { key, acceptance,
        execution: typeof outcome.execution === "string" ? outcome.execution : null,
        operation: typeof outcome.operation === "string" ? outcome.operation : null }) : previous.content;
      const details = invocationDetails(origin, call.tool, key, acceptance);
      if (changed) {
        // Pi persists its custom entry before this hook returns to provider request
        // construction. A persistence error blocks continuation, never the effect.
        pi.appendEntry(RECONNECTION, { version: 1, call: id, signature, content, details });
      }
      reconnect.push({ role: "custom" as const, customType: RECONNECTION, content, details, display: false, timestamp: Date.now() });
    }
    if (recordRoot !== undefined) {
      // This bounded caller-side file read cannot refresh or execute any group/tool.
      // Persist only authored diagnostics, never arbitrary health/body instructions.
      const notice = client.collaborationRecordNotice(recordRoot);
      if (notice !== recordNotice) pi.appendEntry(RECORD_HEALTH, { version: 1, content: notice });
      if (notice !== null) reconnect.push({ role: "custom" as const, customType: RECORD_HEALTH, content: notice,
        details: { version: 1, recordRoot, observational: true }, display: false, timestamp: Date.now() });
    }
    if (reconnect.length > 0) return { messages: [...event.messages, ...reconnect] };
  };
  pi.on("context_with_system", async (event, context) => {
    try { return await observeBeforeRequest(event, context); }
    catch (error) {
      // Pi deliberately reports context-hook errors and continues. Explicitly abort
      // its active run if identity verification or reconnection persistence fails.
      context.abort();
      throw error;
    }
  });
}
