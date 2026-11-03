/** Collaboration model actions bind real invocations, never legacy aliases or
 * random/counter request-key derivation. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isAbsolute, normalize } from "node:path";
import type { Json, Receipt } from "@oma/contracts";
import { Type } from "typebox";
import { Client, ClientError, PreacceptRejectionError, SubmissionPublicationError, type CollaborationOutcome, type InvocationObservation } from "@oma/client";
import { collaborationOmaNames, type CollaborationRole } from "@oma/domain/collaboration-surface";
import { collaborationInputProblem, collaborationMutationMethod, collaborationParameters, type CollaborationParameterBounds } from "@oma/domain/collaboration-inputs";
import { canonicalCollaborationJson } from "@oma/domain/collaboration-targets";
import { textResult } from "@oma/tool-runtime/shared";
import { collaborationHelp } from "./collaboration-help.js";
import { captureInvocation, invocationDetails, invocationPresentation, registerInvocationReconnection } from "./collaboration-invocations.js";
import { decodeReceipt } from "@oma/protocol/receipt-codec";
import { invocationRejectionGuidance } from "@oma/protocol/invocation-rejection";

export function registerCollaborationTools(pi: ExtensionAPI, client: Client, role: CollaborationRole, bounds: CollaborationParameterBounds, recordRoot?: string, continuationPermitted?: (name: string) => boolean): (() => Promise<boolean>) | undefined {
  if (recordRoot !== undefined && (!isAbsolute(recordRoot) || normalize(recordRoot) !== recordRoot || recordRoot === "/" || recordRoot.includes("\0")))
    throw new Error("Invalid host-bound collaboration record root");
  const records = recordRoot === undefined ? [] : [`${recordRoot}/receipts/index.md`, `${recordRoot}/health.md`];
  const names = collaborationOmaNames(role);
  registerInvocationReconnection(pi, client, names, records, continuationPermitted, recordRoot);
  for (const name of names) {
    const prepareArguments = (value: unknown): { [key: string]: Json } => {
      // Canonicalization rejects accessors and non-JSON values without executing
      // caller-defined property getters. Validation never coerces presence/null.
      const snapshot: unknown = JSON.parse(canonicalCollaborationJson(value));
      const problem = collaborationInputProblem(name, snapshot, bounds);
      if (problem !== null) throw new Error(`INVALID_ARGUMENT: ${problem}`);
      if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new Error("INVALID_ARGUMENT: expected an object");
      // SAFETY: canonical JSON parsing and the closed action check validated this object.
      return snapshot as { [key: string]: Json };
    };
    pi.registerTool({
      name, ...collaborationHelp(name, role), promptGuidelines: [],
      parameters: Type.Unsafe<{ [key: string]: Json }>(collaborationParameters(name, role, bounds)),
      constrainedSampling: { type: "json_schema", strict: "prefer" },
      // Pi owns scheduling. Use its native ordered barrier rather than a
      // second executor or an application-owned promise/work queue.
      executionMode: "sequential",
      prepareArguments,
      async execute(id, input, signal, _update, context) {
        const prepared = prepareArguments(input);
        const { origin, args } = captureInvocation(context, id, name, prepared);
        if (name === "oma_wait") {
          const result = await client.query("agent.wait", {}, signal);
          if (result.accepted !== true) throw new Error("The current activation's yield intent was not accepted");
          return textResult("Yield requested for this activation. The run ends at the next safe tool boundary.\nThis does not acknowledge mail, complete work, or release Worker capacity.",
            { requested: true, acceptance: "ephemeral", invocation: origin });
        }
        let key: string | null = null;
        let observed: InvocationObservation | undefined;
        let completed: CollaborationOutcome | undefined;
        try {
          // This only observes the original operation. It never sends, reads a
          // mutable source, repairs a completed freeze or creates a fresh intent.
          const original = await client.observeInvocation(name, origin, args, signal);
          observed = original;
          key = original.link.key;
          if (original.link.rejection !== undefined) throw new PreacceptRejectionError(original.link.key, original.link.rejection);
          const outcome: CollaborationOutcome = original.link.resolution !== undefined
            ? { disposition: "existing", key: original.link.key, resolution: original.link.resolution }
            : original.receipt !== null ? { disposition: "replayed", receipt: original.receipt,
              ...(original.link.publication === undefined ? {} : { publication: original.link.publication }),
              ...(original.link.mail === undefined ? {} : { mail: original.link.mail }) }
              : await client.collaborationReceipt(name, origin, args, role, signal);
          completed = outcome;
          if (outcome.disposition === "existing") {
            const result = {
              disposition: "existing", acceptance: "not-submitted", execution: "not-applicable",
              invocation: { ...origin, key }, operation: null, receipt: null, existing: outcome.resolution,
              observedAt: new Date(outcome.resolution.observedAtMs).toISOString(), records, error: null,
              guidance: "No new operation, revision or attempt was submitted. The existing receipt is an observation of the explicitly referenced request, not acceptance of this invocation. Read current review status for later changes.",
            };
            return textResult(invocationPresentation(client, result, { key, acceptance: "not-submitted", execution: "not-applicable", operation: null, referencedOperation: outcome.resolution.receipt.operation }), { ...result, ...invocationDetails(origin, name, key, "not-submitted"), omaError: false });
          }
          const receipt = outcome.receipt;
          const result = {
            disposition: outcome.disposition,
            acceptance: "accepted", execution: receipt.state,
            invocation: { ...origin, key }, operation: receipt.operation,
            observedAt: new Date().toISOString(), records, receipt,
            publication: outcome.publication ?? null,
            mail: outcome.mail ?? null,
            guidance: name === "oma_send" ? receipt.state === "failed"
              ? "The original operation was accepted and failed. Published attachments or materialized recipients are not undone; inspect its exact receipt records before a distinct later decision."
              : receipt.state === "pending" || receipt.state === "unknown"
                ? "The original operation is accepted; attachment publication and mailbox delivery are not confirmed complete. Preserve this invocation and read its receipt record. Do not send a replacement."
                : receipt.result?.kind === "agent.continue" ? "The original continuation note was accepted. This does not acknowledge mail or release Worker capacity."
                  : "Mail success confirms its required attachment publication and mailbox materialization, not recipient action or current ref availability. Read receipt records for any omitted attachment details." : name === "oma_spawn" ? "Creation acceptance, provisioning, enabled capacity and actual execution are distinct. Read the original receipt and separately timed peers record for the frozen starting commit, source dependency, child state and initial brief. Neither success nor an enabled Worker proves task completion. Do not create another name to bypass pending publication, provisioning or activation." : null,
            error: receipt.error ?? null,
          };
          return textResult(invocationPresentation(client, result, { key, acceptance: "accepted", execution: receipt.state, operation: receipt.operation }), { ...result, ...invocationDetails(origin, name, key, "accepted"),
            operation: receipt.operation, execution: receipt.state, omaError: receipt.state === "failed" });
        } catch (error) {
          // Keep already observed canonical facts even if later formatting fails.
          // A receipt carried for a different original key cannot replace them.
          const matchingError = error instanceof ClientError && (key === null || error.request === undefined || error.request === key);
          const resolution = completed?.disposition === "existing" ? completed.resolution : observed?.link.resolution;
          const previous = completed !== undefined && completed.disposition !== "existing" ? completed.receipt : observed?.receipt ?? undefined;
          const rejection = previous !== undefined ? undefined : observed?.link.rejection ?? (matchingError && error instanceof PreacceptRejectionError ? error.rejection : undefined);
          const decoded = matchingError && error.request !== undefined ? decodeReceipt(error.receipt, { expectedKind: collaborationMutationMethod(name, args) }) : null;
          const carried: Receipt | undefined = decoded?.ok && (previous === undefined || decoded.value.operation === previous.operation) ? decoded.value : undefined;
          const known = resolution === undefined && rejection === undefined ? previous ?? carried : undefined;
          const acceptance = resolution !== undefined || rejection !== undefined ? "not-submitted" : known === undefined ? "unknown" : "accepted";
          if (key === null && matchingError && error.request !== undefined) key = error.request;
          const result = {
            disposition: resolution !== undefined ? "existing" : rejection !== undefined ? "rejected" : null, acceptance, execution: resolution !== undefined || rejection !== undefined ? "not-applicable" : known?.state ?? null,
            invocation: { ...origin, key }, operation: known?.operation ?? null, existing: resolution ?? null,
            rejection: rejection ?? null,
            // A child receipt remains distinct even if review submission or result
            // linkage failed after the candidate was successfully published.
            observedAt: new Date().toISOString(), records, receipt: known ?? null,
            publication: completed?.disposition !== "existing" ? completed?.publication ?? observed?.link.publication ??
              (error instanceof SubmissionPublicationError ? error.publication : null) : null,
            mail: completed?.disposition !== "existing" ? completed?.mail ?? observed?.link.mail ?? null : null,
            error: { reason: rejection !== undefined ? rejection.reason : resolution !== undefined ? "NEEDS_OPERATOR" : known === undefined ? "ACCEPTANCE_UNKNOWN" :
              known.state === "pending" || known.state === "unknown" ? "ORIGINAL_PENDING" : "NEEDS_OPERATOR", message: error instanceof Error ? error.message : String(error) },
            guidance: rejection !== undefined ? invocationRejectionGuidance(rejection.reason) : resolution !== undefined
              ? "The protected original invocation resolved without a new operation, revision or attempt. Its referenced receipt is not acceptance of this invocation. A presentation failure does not reopen it."
              : known === undefined
                ? error instanceof SubmissionPublicationError && error.publication.receipt?.state === "succeeded"
                  ? "Publication succeeded; review acceptance is not established. Continuation requires an authorized activation using this original invocation and frozen review input. Never replace it with current HEAD or delete the published OID."
                  : "Preserve this original invocation. Do not use a new key, wording, proposal or Worker name to bypass uncertainty."
                : "The original operation was accepted. Preserve its receipt and invocation; a linkage or presentation failure does not cancel its effects.",
          };
          return textResult(invocationPresentation(client, result, { key, acceptance, execution: result.execution, operation: known?.operation ?? null, referencedOperation: resolution?.receipt.operation ?? null }), { ...result, ...invocationDetails(origin, name, key, acceptance), omaError: true });
        }
      },
    });
  }
  pi.on("tool_result", event => {
    if (!names.includes(event.toolName) || event.details === null || typeof event.details !== "object" ||
        !("omaError" in event.details)) return;
    if (event.details.omaError === true) return { isError: true };
  });
  if (role === "resident") return async () => {
    const observation = await client.query("agent.wait", { observe: true });
    if (typeof observation.accepted !== "boolean") throw new Error("Invalid current-run yield observation");
    return observation.accepted;
  };
}
