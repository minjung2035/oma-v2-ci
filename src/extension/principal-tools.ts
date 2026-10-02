/** DR27/PR-004: review and explicit safety control, not orchestration.
 * Mutations use the same CLI, actor, request key and immutable receipts as
 * every other caller. No shell or caller-selected program is exposed. */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { REQUEST_PARAMETER_HELP, actorNameOf, refused, requestKeyOf, textResult } from "./shared.js";

export const PRINCIPAL_TOOL_NAMES: readonly string[] = Object.freeze([
  "oma_society", "oma_git", "oma_agent_lifecycle", "oma_review_decide", "oma_challenge_finding", "oma_challenge_scope", "oma_attestation_revoke",
]);
export interface PrincipalToolContext {
  readonly run: (args: string[], signal?: AbortSignal, cwd?: string) => Promise<string>;
  readonly workspace: string;
  readonly society: string | undefined;
}
const exact = { candidate: Type.String(), base: Type.String(), policyRevision: Type.String() };
const request = Type.Optional(Type.String({ description: REQUEST_PARAMETER_HELP }));
const evidence = Type.String({ minLength: 1 });
function identity(params: { candidate: string; base: string; policyRevision: string }): string[] {
  return ["--base", params.base, "--target", "main", "--policy-revision", params.policyRevision];
}
export function registerPrincipalTools(pi: ExtensionAPI, context: PrincipalToolContext): void {
  const { run, workspace, society } = context;
  const record = async (args: string[], text: string, key: string, signal?: AbortSignal) => {
    const temporary = mkdtempSync(join(workspace, "oma-tool-"));
    try {
      const file = join(temporary, "evidence.txt"); writeFileSync(file, text, { mode: 0o600 });
      return textResult(await run([...args, "--file", file, "--request", key], signal), { request: key });
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  };
  pi.registerTool({
    name: "oma_society", label: "Open or close society execution",
    description: "Close all Worker execution after the work is complete, or reopen it for more work. Closing preserves mail, sessions and each Worker's individual stop state. Resume restores this setting; open explicitly to continue. Only a succeeded close confirms Worker termination. Opening lets enabled Workers with pending mail resume automatically; force-stopped Workers stay stopped.",
    parameters: Type.Object({ action: Type.Union([Type.Literal("open"), Type.Literal("close")]), request }),
    async execute(id, params, signal, _update, engine) {
      const action = params.action === "open" || params.action === "close" ? params.action : refused("society action", params.action);
      const key = requestKeyOf(params.request, { id, tool: "oma_society", params, context: engine });
      return textResult(await run(["society", action, "--request", key], signal), { request: key });
    },
  });
  pi.registerTool({
    name: "oma_git", label: "Read project code",
    description: "Read canonical main or published candidate history without changing code. show reads one file; diff compares exact revisions; log, ls-tree and literal grep inspect history and files. Results name the resolved commit.",
    parameters: Type.Object({ action: Type.Union([Type.Literal("show"), Type.Literal("diff"), Type.Literal("log"), Type.Literal("ls-tree"), Type.Literal("grep")]),
      revision: Type.Optional(Type.String({ description: "main (default) or a full published commit id" })),
      base: Type.Optional(Type.String({ description: "Required for diff: main or a full published commit id" })),
      path: Type.Optional(Type.String()), pattern: Type.Optional(Type.String()) }),
    async execute(_id, params, signal) {
      const args = ["code", params.action];
      for (const name of ["revision", "base", "path", "pattern"] as const)
        if (params[name] !== undefined) args.push(`--${name}`, params[name]);
      return textResult(await run(args, signal));
    },
  });
  pi.registerTool({
    name: "oma_agent_lifecycle", label: "Force-stop or release an OMA Resident",
    description: "Emergency stop of a Resident, or explicit release/start after a Principal stop. Not a task scheduler: Workers manage ordinary collaboration themselves. Other Workers cannot undo a Principal stop.",
    parameters: Type.Object({ name: Type.String(), action: Type.Union([Type.Literal("start"), Type.Literal("stop")]), request }),
    async execute(id, params, signal, _update, engine) {
      const name = actorNameOf(params.name, society, "agent name");
      const action = params.action === "start" || params.action === "stop" ? params.action : refused("action", params.action);
      const key = requestKeyOf(params.request, { id, tool: "oma_agent_lifecycle", params, context: engine });
      return textResult(await run(["agent", action, "--request", key, "--", name], signal), { request: key });
    },
  });
  pi.registerTool({
    name: "oma_review_decide", label: "Record an exact code review decision",
    description: "Record ACCEPT, REQUEST_REVISION or REJECT for an exact published candidate/base/policy. A decision is not a merge; HIGH acceptance needs host delegation and all other integration conditions.",
    parameters: Type.Object({ ...exact, verdict: Type.Union([Type.Literal("ACCEPT"), Type.Literal("REQUEST_REVISION"), Type.Literal("REJECT")]), evidence, request }),
    async execute(id, params, signal, _update, engine) {
      const key = requestKeyOf(params.request, { id, tool: "oma_review_decide", params, context: engine });
      return record(["approve", params.candidate, ...identity(params), "--decision", params.verdict], params.evidence, key, signal);
    },
  });
  pi.registerTool({
    name: "oma_challenge_finding", label: "Judge an integration challenge",
    description: "Judge a challenge against an actual successful integration. A valid finding sets a persistent MEDIUM/HIGH floor with an explicit semantic scope, not a path heuristic.",
    parameters: Type.Object({ challenge: Type.String(), valid: Type.Boolean(), floor: Type.Optional(Type.Union([Type.Literal("MEDIUM"), Type.Literal("HIGH")])),
      scope: Type.Optional(Type.String()), evidence, request }),
    async execute(id, params, signal, _update, engine) {
      if (params.valid ? (!params.floor || !params.scope) : (params.floor !== undefined || params.scope !== undefined)) refused("finding floor/scope", params);
      const key = requestKeyOf(params.request, { id, tool: "oma_challenge_finding", params, context: engine });
      return record(["challenge", params.challenge, "--valid", String(params.valid),
        ...(params.valid ? ["--floor", params.floor!, "--scope", params.scope!] : [])], params.evidence, key, signal);
    },
  });
  pi.registerTool({
    name: "oma_challenge_scope", label: "Assess exact candidate scope",
    description: "Decide whether a valid finding's semantic scope applies to this exact candidate. Changed identities require their own assessment; neither ancestry nor renaming decides it.",
    parameters: Type.Object({ ...exact, finding: Type.String(), applies: Type.Boolean(), evidence, request }),
    async execute(id, params, signal, _update, engine) {
      const key = requestKeyOf(params.request, { id, tool: "oma_challenge_scope", params, context: engine });
      return record(["challenge", params.finding, "--candidate", params.candidate, ...identity(params), "--applies", String(params.applies)], params.evidence, key, signal);
    },
  });
  pi.registerTool({
    name: "oma_attestation_revoke", label: "Revoke your own attestation",
    description: "Explicitly revoke one of your own recorded decisions, findings or scope assessments. Revoking the latest decision does not resurrect an older ACCEPT.",
    parameters: Type.Object({ attestation: Type.String(), evidence, request }),
    async execute(id, params, signal, _update, engine) {
      const key = requestKeyOf(params.request, { id, tool: "oma_attestation_revoke", params, context: engine });
      return record(["revoke", params.attestation], params.evidence, key, signal);
    },
  });
}
