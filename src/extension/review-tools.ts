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
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { REQUEST_PARAMETER_HELP, refused, requestKeyOf, textResult } from "./shared.js";
import { validMessageId } from "./batch-view.js";

export type ReviewKind = "merge" | "challenge";
/** Mirrors the CLI's request-name grammar (merge-/challenge- + 8 lowercase
 * hex); a test binds it to domain/identifiers.ts. */
const NAME_RE: Readonly<Record<ReviewKind, RegExp>> = {
  merge: /^merge-[0-9a-f]{8}$/,
  challenge: /^challenge-[0-9a-f]{8}$/,
};

type Runner = (args: string[], signal?: AbortSignal) => Promise<string>;
export interface ReviewToolContext {
  readonly run: Runner;
  /** Where the call's 0600 evidence files live while the CLI reads them. */
  readonly temporaryRoot: string;
  /** Principal registration carries only diff and vote. */
  readonly principal: boolean;
}

const request = Type.Optional(Type.String({ description: REQUEST_PARAMETER_HELP }));
const nameField = Type.Optional(Type.String({ description: "the request's generated name (merge-/challenge- + 8 hex)" }));
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
    ? { merge: Type.Optional(Type.String({ description: "the applied merge-<8 hex> request this challenge reverts" })) } : {}),
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
  const { run, temporaryRoot, principal } = context;
  const actions: readonly string[] = principal ? PRINCIPAL_ACTIONS : WORKER_ACTIONS;
  for (const kind of ["merge", "challenge"] as const) {
    const tool = `oma_${kind}`;
    pi.registerTool({
      name: tool,
      label: kind === "merge" ? "Merge review requests" : "Challenge an applied merge",
      description: principal
        ? kind === "merge"
          ? "Decide the HIGH merge requests whose approval mail reaches you. diff pages the exact base→candidate patch of a request you can see; vote names that approval mail's id with approve or reject and its reason. You do not open, review or cancel requests, assign reviewers, or poll; LOW and MEDIUM completions arrive as notice mail by themselves."
          : "Decide a challenge's approval when its mail reaches you. diff pages the exact patch; view chooses the revert (default) or the merge it reverts; vote names the approval id from the mail. Only recorded votes count."
        : kind === "merge"
          ? "Work a merge request through review mail. open names a tier and freezes the candidate and base; review adds discussion; vote approves or rejects with a body (only recorded votes count; you cannot approve your own request); status reads it; cancel ends it; diff pages the exact base→candidate patch. A LOW merge applies without further review; a MEDIUM or HIGH one then needs peer and, for HIGH, Principal approval."
          : "Challenge a merge that already applied: open prepares a revert (or takes your own candidate+base), then reviews and votes like a merge request until it applies. diff's view chooses the revert (default) or the original merge's patch.",
      promptSnippet: kind === "merge"
        ? "Open a merge request and review others' through oma_merge."
        : "Revert an applied merge with oma_challenge open.",
      parameters: principal ? principalSchema(kind) : workSchema(kind),
      async execute(id, raw, signal, _update, engine) {
        const params = raw as Record<string, unknown>;
        const action = params.action as ReviewAction;
        if (!actions.includes(action)) refused(`${kind} action`, action);
        only(kind, action, params);
        const key = requestKeyOf(params.request, { id, tool, params, context: engine });
        const withFile = async (content: string, args: string[]) => {
          const temporary = mkdtempSync(join(temporaryRoot, "oma-tool-"));
          try {
            const file = join(temporary, "body.md");
            writeFileSync(file, content, { mode: 0o600 });
            // --file is an option: it must precede the `--` that ends options.
            const at = args.indexOf("--");
            const argv = at < 0 ? [...args, "--file", file]
              : [...args.slice(0, at), "--file", file, ...args.slice(at)];
            return textResult(await run(argv, signal), { request: key });
          } finally { rmSync(temporary, { recursive: true, force: true }); }
        };
        switch (action) {
          case "open": {
            const title = textField(params, "title", "title");
            const reason = textField(params, "reason", "reason");
            if (kind === "challenge") {
              const merge = (typeof params.merge === "string" && NAME_RE.merge.test(params.merge))
                ? params.merge : refused("target merge request name", params.merge);
              const tier = params.tier === "LOW" || params.tier === "HIGH" ? params.tier : refused("challenge tier", params.tier);
              const pair = params.candidate === undefined && params.base === undefined ? []
                : params.candidate !== undefined && params.base !== undefined
                  ? ["--candidate", String(params.candidate), "--base", String(params.base)]
                  : refused("candidate and base go together", params);
              return withFile(reason, ["challenge", "open", "--merge", merge, "--tier", tier, "--title", title, ...pair, "--request", key]);
            }
            const tier = params.tier === "LOW" || params.tier === "MEDIUM" || params.tier === "HIGH"
              ? params.tier : refused("merge tier", params.tier);
            const candidate = params.candidate !== undefined ? ["--candidate", String(params.candidate)] : [];
            const base = params.base !== undefined ? ["--base", String(params.base)] : [];
            return withFile(reason, ["merge", "open", "--tier", tier, "--title", title, ...candidate, ...base, "--request", key]);
          }
          case "diff": {
            const name = nameOf(kind, params);
            const view = params.view !== undefined
              ? ["--view", params.view === "revert" || params.view === "original" ? params.view : refused("view", params.view)] : [];
            const path = params.path !== undefined ? ["--path", String(params.path)] : [];
            const cursor = params.cursor !== undefined ? ["--cursor", String(params.cursor)] : [];
            return textResult(await run([kind, "diff", ...view, ...path, ...cursor, "--", name], signal));
          }
          case "review": {
            const name = nameOf(kind, params);
            return withFile(textField(params, "review body", "body"), [kind, "review", "--request", key, "--", name]);
          }
          case "vote": {
            const name = nameOf(kind, params);
            const verdict = params.verdict === "approve" || params.verdict === "reject"
              ? params.verdict : refused("verdict", params.verdict);
            const approval = principal
              ? (typeof params.approval === "string" && validMessageId(params.approval)
                  ? params.approval : refused("approval message id", params.approval))
              : params.approval === undefined ? undefined : refused("approval is only the Principal's field", params.approval);
            return withFile(textField(params, "vote body", "body"),
              [kind, "vote", "--verdict", verdict, "--request", key,
                ...(approval === undefined ? [] : ["--approval", approval]), "--", name]);
          }
          case "status": {
            const name = params.name === undefined ? [] : ["--", nameOf(kind, params)];
            return textResult(await run([kind, "status", ...name], signal));
          }
          case "cancel": {
            const name = nameOf(kind, params);
            return withFile(textField(params, "cancel reason", "reason"), [kind, "cancel", "--request", key, "--", name]);
          }
          default: return refused(`${kind} action`, action);
        }
      },
    });
  }
}
