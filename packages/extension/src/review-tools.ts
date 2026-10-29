/** Review contracts share inputs, never authority or quorum calculations. */
import type { Client } from "@oma/client";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { REQUEST_PARAMETER_HELP, refused, requestKeyOf, textResult, registerTypedTool, stringEnum } from "@oma/tool-runtime/shared";
import { isReviewRequestName, isValidMessageId } from "@oma/domain/identifiers";

const request = Type.Optional(Type.String({ description: REQUEST_PARAMETER_HELP }));
const name = Type.String({ description: "Exact request name: merge-<full UUID> or challenge-<full UUID>." });
const text = Type.String({ minLength: 1, pattern: "\\S" });
const revision = Type.String({ minLength: 1 });
const requiredName = (value: string): string => isReviewRequestName(value) ? value : refused("review request name", value);

export function registerReviewTools(pi: ExtensionAPI, context: { client: Client; principal: boolean }): void {
  const { client, principal } = context;
  registerTypedTool(pi, {
    name: "oma_review_diff", label: "Read exact review diff",
    description: "Read the exact committed patch for a merge or challenge, with candidate/base identity, hash and byte pagination. proposal (default) is the request's frozen patch; original on a challenge is its target merge's patch. Keep name, view and path fixed while passing next as cursor until null. One page or a path-filtered patch is not the whole change.",
    parameters: Type.Object({
      name, view: Type.Optional({ ...stringEnum(["proposal", "original"]), description: "proposal reads this request's patch; original reads the target merge for a challenge. Defaults to proposal." }),
      path: Type.Optional(Type.String({ description: "Optional repository path restricting the displayed diff, not the review's scope." })),
      cursor: Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER, description: "Byte cursor from the previous page's next field; omit to start at zero." })),
    }),
    async execute(_id, params, signal) {
      requiredName(params.name);
      return textResult(await client.reviewDiff(params, signal));
    },
  });
  registerTypedTool(pi, {
    name: "oma_review_respond", label: "Comment or cast an independent vote",
    description: principal
      ? "Approve or reject a HIGH or capacity-fallback review using its current broker-issued approval mail. Supply name, action, reasoned body and that mail's approval id. The decision applies to the frozen request identity; stale or ordinary mail is not approval authority. A Principal reject permanently closes this request; it is not a request for revisions."
      : "Comment on a merge or challenge, or record an independent approve/reject vote after examining its exact change and relevant evidence. comment is discussion only. Supply name, action and a reasoned body; contributors cannot vote on their own work. LOW merges have no pre-review comments or votes: raise a challenge only after application.",
    promptSnippet: principal ? "Decide a review using its current broker-issued approval mail id." : "Record binding review votes with approve/reject; comments and mail are discussion, not votes.",
    parameters: Type.Object({
      name, action: { ...stringEnum(principal ? ["approve", "reject"] as const : ["comment", "approve", "reject"] as const), description: principal ? "Binding Principal decision for the current broker-issued approval request." : "comment adds discussion; approve or reject records your independent vote." },
      body: { ...text, description: "Inline rationale with relevant evidence, findings or unresolved risks for this exact request." },
      ...(principal ? { approval: Type.String({ description: "Message id of the current broker-issued approval request, not an ordinary candidate notice." }) } : {}), request,
    }),
    async execute(id, params, signal, _update, engine) {
      requiredName(params.name);
      const approval = "approval" in params ? params.approval : undefined;
      if (principal && !isValidMessageId(approval)) refused("approval message id", approval);
      const key = requestKeyOf(params.request, { id, tool: "oma_review_respond", params, context: engine });
      return textResult(await client.respondReview({ name: params.name, action: params.action, body: params.body,
        ...(typeof approval === "string" ? { approval } : {}) }, key, signal), { request: key });
    },
  });
  if (principal) return;
  registerTypedTool(pi, {
    name: "oma_merge_open", label: "Open a merge request",
    description: "Open a merge for an exact committed candidate, publishing it automatically if needed. candidate defaults to HEAD and base to the recorded upstream base; uncommitted edits are excluded. LOW applies without pre-review; MEDIUM normally needs one independent approval; HIGH needs the configured peer floor, then Principal approval. If maxWorkers cannot fit the normal quorum after excluding authors, the broker requires the peer approvals that can fit, then Principal approval. Temporary unavailability or rejection never enables fallback. An opening receipt is not proof of integration: inspect oma_review_status.",
    parameters: Type.Object({
      tier: { ...stringEnum(["LOW", "MEDIUM", "HIGH"]), description: "Risk tier under project policy; determines peer and Principal approval requirements." },
      title: { ...text, description: "Short description of the committed change." },
      reason: { ...text, description: "Inline purpose, tier rationale, scope and verification evidence, including remaining integration risks." },
      candidate: Type.Optional({ ...revision, description: "Exact committed candidate OID or local revision; defaults to HEAD and is frozen for this request." }),
      base: Type.Optional({ ...revision, description: "Base commit OID or local revision; defaults to the recorded upstream base. Required explicitly if no base is recorded." }), request,
    }),
    async execute(id, params, signal, _update, engine) {
      const key = requestKeyOf(params.request, { id, tool: "oma_merge_open", params, context: engine });
      return textResult(await client.openMerge(params, key, signal), { request: key });
    },
  });
  registerTypedTool(pi, {
    name: "oma_challenge_open", label: "Challenge an applied merge",
    description: "Open a post-application challenge to an applied merge, explaining the defect and evidence. Omit replacement for a broker-prepared revert on canonical main; otherwise supply both replacement candidate and base commits, with automatic publication. All challenges normally require the configured peer floor; HIGH also requires Principal approval. When maxWorkers cannot fit that quorum after excluding authors, the broker requires the peers that can fit, then Principal approval, including for LOW. A HIGH merge cannot be challenged as LOW. Opening is not application: inspect oma_review_status.",
    parameters: Type.Object({
      merge: { ...name, description: "Exact merge-<full UUID> name of an already applied merge." },
      tier: { ...stringEnum(["LOW", "HIGH"]), description: "Challenge risk tier; use HIGH when required by policy or when challenging a HIGH merge." },
      title: { ...text, description: "Short description of the defect and proposed correction." },
      reason: { ...text, description: "Inline defect evidence, impact, tier rationale and why a revert or replacement is appropriate." },
      replacement: Type.Optional(Type.Object({
        candidate: { ...text, description: "Committed replacement candidate OID or local revision; uncommitted edits are excluded." },
        base: { ...text, description: "Base commit OID or local revision for the replacement patch." },
      }, { additionalProperties: false, description: "Optional replacement patch identity; both commits are required. Omit to request a revert." })), request,
    }),
    async execute(id, params, signal, _update, engine) {
      if (!requiredName(params.merge).startsWith("merge-")) refused("target merge", params.merge);
      const key = requestKeyOf(params.request, { id, tool: "oma_challenge_open", params, context: engine });
      return textResult(await client.openChallenge(params, key, signal), { request: key });
    },
  });
  registerTypedTool(pi, {
    name: "oma_review_status", label: "Read review state and eligible peers",
    description: "Read a request's ledger state, approval requirements, reviewer candidates/exclusions and integration outcome. Prefer available eligible peers with relevant context and avoid redundant review. remainingApprovals=0 does not prove application or Principal approval. Pass reviewers.next as reviewerAfter to read further reviewer pages.",
    parameters: Type.Object({
      name, reviewerAfter: Type.Optional(Type.String({ description: "Cursor from reviewers.next; omit for the first reviewer page." })),
    }),
    async execute(_id, params, signal) {
      requiredName(params.name);
      return textResult(await client.queryText("review.status", params, signal));
    },
  });
  registerTypedTool(pi, {
    name: "oma_review_list", label: "List review requests",
    description: "List merge or challenge requests, newest first. Supply kind and pass next as after until null when more history is needed. A page is not the full history; use oma_review_status for one request's outcome.",
    parameters: Type.Object({
      kind: { ...stringEnum(["merge", "challenge"]), description: "Request kind to list." },
      after: Type.Optional({ ...name, description: "Previous page's next request name; must match kind. Omit for the first page." }),
    }),
    async execute(_id, params, signal) {
      if (params.after !== undefined && !requiredName(params.after).startsWith(`${params.kind}-`)) refused("list cursor kind", params.after);
      return textResult(await client.queryText("review.status", params, signal));
    },
  });
  registerTypedTool(pi, {
    name: "oma_review_cancel", label: "Cancel your review request",
    description: "Cancel your own review request with an inline reason. Only the requester may cancel, and an applied merge cannot be cancelled; use a post-application challenge for a defect in an applied merge.",
    parameters: Type.Object({ name, reason: { ...text, description: "Why this request is being withdrawn." }, request }),
    async execute(id, params, signal, _update, engine) {
      requiredName(params.name);
      const key = requestKeyOf(params.request, { id, tool: "oma_review_cancel", params, context: engine });
      return textResult(await client.cancelReview(params.name, params.reason, key, signal), { request: key });
    },
  });
}
