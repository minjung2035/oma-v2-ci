/** mail-v1 review tools (spec §2/§4): `oma_merge` and `oma_challenge` run the
 * model-facing review CLI with a fixed argv under a stable request key. The
 * Worker's schema carries the whole vocabulary; the Principal's only diff and
 * vote -- and its vote must name the approval mail it answers.
 *
 * INV09/PR-004 as in mail-tools: every value is checked against the grammar of
 * its slot before the CLI starts; an option's value follows its option, and a
 * name goes after `--` so nothing a caller supplies can become an option. The
 * extension mirrors the CLI's request-name grammar here (PI-001 forbids the
 * runtime import); a test binds the two (INV04). */
import type { Client, ReviewInput } from "@oma/client";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { REQUEST_PARAMETER_HELP, refused, requestKeyOf, textResult } from "@oma/tool-runtime/shared";
import { isValidMessageId as validMessageId } from "@oma/domain/identifiers";

export type ReviewKind = "merge" | "challenge";
/** Mirrors the CLI's request-name grammar (merge-/challenge- + the request's
 * operation UUID in full; the short 8-hex shape stays readable for facts
 * accepted before the full-UUID mint); a test binds it to
 * domain/identifiers.ts. */
const UUID_TAIL = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const NAME_RE: Readonly<Record<ReviewKind, RegExp>> = {
  merge: new RegExp(`^merge-(?:[0-9a-f]{8}|${UUID_TAIL})$`),
  challenge: new RegExp(`^challenge-(?:[0-9a-f]{8}|${UUID_TAIL})$`),
};

export interface ReviewToolContext {
  readonly client: Client;
  /** Principal registration carries only diff and vote. */
  readonly principal: boolean;
}

const request = Type.Optional(Type.String({ description: REQUEST_PARAMETER_HELP }));
const nameField = Type.Optional(Type.String({ description: "the request's generated name (merge-/challenge- + the request's full UUID)" }));
const string = Type.String();
const verdictType = Type.Union([Type.Literal("approve"), Type.Literal("reject")]);
const cursorType = Type.Optional(Type.Integer({ minimum: 0 }));
const viewType = (kind: ReviewKind) => kind === "challenge"
  ? { view: Type.Optional(Type.Union([Type.Literal("revert"), Type.Literal("original")])) } : {};

/** Which parameters an action takes. Anything else is refused before the CLI
 * starts -- a field the action does not own is a model error, never a
 * silently ignored one. */
const ALLOWED: Readonly<Record<string, ReadonlySet<string>>> = {
  open: new Set(["action", "tier", "title", "reason", "candidate", "base", "request"]),
  diff: new Set(["action", "name", "view", "path", "cursor"]),
  review: new Set(["action", "name", "body", "request"]),
  vote: new Set(["action", "name", "verdict", "body", "approval", "request"]),
  status: new Set(["action", "name"]),
  cancel: new Set(["action", "name", "reason", "request"]),
};
const WORKER_ACTIONS = ["open", "diff", "review", "vote", "status", "cancel"] as const;
const PRINCIPAL_ACTIONS = ["diff", "vote"] as const;
type ReviewAction = (typeof WORKER_ACTIONS)[number];

function only(kind: ReviewKind, action: ReviewAction, params: Record<string, unknown>): void {
  const allowed = kind === "challenge" && action === "open" ? new Set([...ALLOWED.open!, "merge"]) : ALLOWED[action]!;
  for (const key of Object.keys(params))
    if (params[key] !== undefined && !allowed.has(key)) refused(`field for ${action}`, key);
}

function nameOf(kind: ReviewKind, params: Record<string, unknown>): string {
  return (typeof params.name === "string" && NAME_RE[kind].test(params.name))
    ? params.name : refused(`${kind} request name`, params.name);
}

const textField = (params: Record<string, unknown>, what: string, key: string): string =>
  typeof params[key] === "string" && (params[key] as string).length > 0 ? (params[key] as string) : refused(what, params[key]);

const workSchema = (kind: ReviewKind) => Type.Object({
  action: Type.Union([Type.Literal("open"), Type.Literal("diff"), Type.Literal("review"),
    Type.Literal("vote"), Type.Literal("status"), Type.Literal("cancel")]),
  name: nameField,
  ...(kind === "challenge"
    ? { merge: Type.Optional(Type.String({ description: "the applied merge-<UUID> request this challenge reverts" })) } : {}),
  tier: Type.Optional(kind === "merge"
    ? Type.Union([Type.Literal("LOW"), Type.Literal("MEDIUM"), Type.Literal("HIGH")])
    : Type.Union([Type.Literal("LOW"), Type.Literal("HIGH")])),
  title: Type.Optional(string), reason: Type.Optional(string), body: Type.Optional(string),
  verdict: Type.Optional(verdictType),
  candidate: Type.Optional(string), base: Type.Optional(string),
  path: Type.Optional(string), cursor: cursorType, ...viewType(kind), request,
});
const principalSchema = (kind: ReviewKind) => Type.Object({
  action: Type.Union([Type.Literal("diff"), Type.Literal("vote")]),
  name: nameField,
  verdict: Type.Optional(verdictType), body: Type.Optional(string),
  approval: Type.Optional(Type.String({ description: "the approval message id the vote answers; required" })),
  path: Type.Optional(string), cursor: cursorType, ...viewType(kind), request,
});

/** The whole pair of tools: one execute, argv assembled per action. */
export function registerReviewTools(pi: ExtensionAPI, context: ReviewToolContext): void {
  const { client, principal } = context;
  const actions: readonly string[] = principal ? PRINCIPAL_ACTIONS : WORKER_ACTIONS;
  for (const kind of ["merge", "challenge"] as const) {
    const tool = `oma_${kind}`;
    pi.registerTool({
      name: tool,
      label: kind === "merge" ? "Merge review requests" : "Challenge an applied merge",
      description: principal
        ? kind === "merge"
          ? "Decide the HIGH merge request an approval mail named. diff pages its exact base→candidate patch; vote is approve or reject with approval set to that mail's id. Open, review and cancel belong to Workers; LOW and MEDIUM arrive as result notices."
          : "Decide a challenge's approval when its mail reaches you. diff pages the patch -- view selects the revert (default) or the merge it undoes; vote names the approval id. Only recorded votes count."
        : kind === "merge"
          ? "Drive a merge request through peer review. open freezes candidate and base under a tier; review adds discussion; vote records the binding verdict -- recorded votes only, never your own request; status reads the ledger; cancel withdraws an unapplied request; diff pages the exact base→candidate patch. Tiers: LOW applies alone, MEDIUM needs one peer approve, HIGH needs two then the Principal."
          : "Revert a merge that already applied, through the same review path as a merge request. open prepares the revert (or takes your own candidate+base); diff's view selects the revert (default) or the original patch.",
      // One line of the system prompt per tool. The Principal's registration
      // carries diff and vote alone, so its snippet names those -- never the
      // Worker verbs open/review/cancel it cannot call.
      promptSnippet: principal
        ? kind === "merge"
          ? "diff and vote a HIGH merge's approval"
          : "diff and vote a challenge's approval"
        : kind === "merge"
          ? "open and review merge requests"
          : "revert an applied merge",
      parameters: principal ? principalSchema(kind) : workSchema(kind),
      async execute(id, raw, signal, _update, engine) {
        const params = raw as Record<string, unknown>;
        const action = params.action as ReviewAction;
        if (!actions.includes(action)) refused(`${kind} action`, action);
        only(kind, action, params);
        const key = requestKeyOf(params.request, { id, tool, params, context: engine });
        const input: ReviewInput = { action };
        if (action !== "open" && (action !== "status" || params.name !== undefined)) input.name = nameOf(kind, params);
        if (action === "open") {
          input.title = textField(params, "title", "title");
          input.reason = textField(params, "reason", "reason");
          input.tier = params.tier === "LOW" || params.tier === "HIGH" || (kind === "merge" && params.tier === "MEDIUM")
            ? params.tier as string : refused(`${kind} tier`, params.tier);
          if (kind === "challenge") {
            input.merge = typeof params.merge === "string" && NAME_RE.merge.test(params.merge)
              ? params.merge : refused("target merge request name", params.merge);
            if ((params.candidate === undefined) !== (params.base === undefined)) refused("candidate and base go together", params);
          }
          if (params.candidate !== undefined) input.candidate = String(params.candidate);
          if (params.base !== undefined) input.base = String(params.base);
        }
        if (action === "review" || action === "vote") input.body = textField(params, `${action} body`, "body");
        if (action === "cancel") input.reason = textField(params, "cancel reason", "reason");
        if (action === "vote") {
          input.verdict = params.verdict === "approve" || params.verdict === "reject" ? params.verdict : refused("verdict", params.verdict);
          if (principal) input.approval = typeof params.approval === "string" && validMessageId(params.approval)
            ? params.approval : refused("approval message id", params.approval);
          else if (params.approval !== undefined) refused("approval is only the Principal's field", params.approval);
        }
        if (action === "diff") {
          if (params.view !== undefined) input.view = params.view === "revert" || params.view === "original" ? params.view : refused("view", params.view);
          if (params.path !== undefined) input.path = String(params.path);
          if (params.cursor !== undefined) {
            if (!/^[0-9]+$/.test(String(params.cursor)) || !Number.isSafeInteger(Number(params.cursor))) throw new Error("invalid cursor");
            input.cursor = Number(params.cursor);
          }
        }
        return textResult(await client.review(kind, input, key, signal), action === "status" || action === "diff" ? {} : { request: key });
      },
    });
  }
}
