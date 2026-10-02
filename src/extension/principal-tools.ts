/** DR27/PR-004: review and explicit safety control, not orchestration.
 * Mutations use the same CLI, actor, request key and immutable receipts as
 * every other caller. No shell or caller-selected program is exposed. In
 * mail-v1 the Principal's review surface is exactly diff and vote: a request
 * it can see, paged exact patches, and a verdict that names the approval mail
 * it answers. Workers own open/review/cancel through their own tools. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { REQUEST_PARAMETER_HELP, actorNameOf, refused, requestKeyOf, textResult } from "./shared.js";
import { registerReviewTools } from "./review-tools.js";

export const PRINCIPAL_TOOL_NAMES: readonly string[] = Object.freeze([
  "oma_society", "oma_agent_lifecycle", "oma_merge", "oma_challenge",
]);
export interface PrincipalToolContext {
  readonly run: (args: string[], signal?: AbortSignal, cwd?: string) => Promise<string>;
  readonly workspace: string;
  readonly society: string | undefined;
}
const request = Type.Optional(Type.String({ description: REQUEST_PARAMETER_HELP }));
export function registerPrincipalTools(pi: ExtensionAPI, context: PrincipalToolContext): void {
  const { run, workspace, society } = context;
  pi.registerTool({
    name: "oma_society", label: "Open or close society execution",
    description: "Close all Worker execution when the work is done, or reopen it. Close preserves mail, sessions and per-agent stop state; only a succeeded close confirms Workers ended. Open lets stopped-eligible Workers resume on pending mail; Principal-stopped ones stay stopped.",
    parameters: Type.Object({ action: Type.Union([Type.Literal("open"), Type.Literal("close")]), request }),
    async execute(id, params, signal, _update, engine) {
      const action = params.action === "open" || params.action === "close" ? params.action : refused("society action", params.action);
      const key = requestKeyOf(params.request, { id, tool: "oma_society", params, context: engine });
      return textResult(await run(["society", action, "--request", key], signal), { request: key });
    },
  });
  pi.registerTool({
    name: "oma_agent_lifecycle", label: "Force-stop or release an OMA Resident",
    description: "Emergency-stop a Resident, or release one the Principal stopped. Not a task scheduler -- Workers organize ordinary work themselves, and other Workers cannot undo a Principal stop.",
    parameters: Type.Object({ name: Type.String(), action: Type.Union([Type.Literal("start"), Type.Literal("stop")]), request }),
    async execute(id, params, signal, _update, engine) {
      const name = actorNameOf(params.name, society, "agent name");
      const action = params.action === "start" || params.action === "stop" ? params.action : refused("action", params.action);
      const key = requestKeyOf(params.request, { id, tool: "oma_agent_lifecycle", params, context: engine });
      return textResult(await run(["agent", action, "--request", key, "--", name], signal), { request: key });
    },
  });
  registerReviewTools(pi, { principal: true, run: (args, signal) => run(args, signal), temporaryRoot: workspace });
}
