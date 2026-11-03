/** Cumulative collaboration-v1 exposure. Pi owns result/session persistence. */
import type { ExtensionAPI, ExtensionContext, ToolInfo } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { CollaborationSurfacePlan, CollaborationGroup } from "@oma/domain/collaboration-surface";
import { registerTypedTool, textResult } from "./shared.js";
import { canonicalJson } from "@oma/domain/canonical-json";

const EVENT = "oma-collaboration-exposure";
const GROUPS = ["lsp_tools", "web_tools"] as const;
function metadata(tool: ToolInfo): string {
  return canonicalJson(JSON.parse(JSON.stringify({ parameters: tool.parameters, description: tool.description,
    exposure: tool.exposure ?? "direct", source: tool.sourceInfo?.source, path: tool.sourceInfo?.path })));
}
export interface CollaborationFence {
  readonly permitted: (name: string) => boolean;
  readonly own: (name: string) => boolean;
  readonly fatal: (message: string) => never;
}
function restored(context: ExtensionContext, plan: CollaborationSurfacePlan): string[] {
  const allowed = new Set(GROUPS.flatMap(group => [...plan.groups[group]]));
  for (const entry of [...context.sessionManager.getBranch()].reverse()) {
    if (entry.type !== "custom" || entry.customType !== EVENT) continue;
    const value = entry.data as Record<string, unknown> | undefined;
    if (!value || Object.keys(value).sort().join() !== "active,role,surface,version" || value.version !== 1 ||
        value.surface !== plan.surface || value.role !== plan.role || !Array.isArray(value.active) ||
        new Set(value.active).size !== value.active.length || value.active.some(name => typeof name !== "string" || !allowed.has(name)))
      throw new Error("committed collaboration exposure is malformed or belongs to another role");
    const active = value.active as string[];
    if (GROUPS.some(group => plan.groups[group].some(name => active.includes(name)) &&
        plan.groups[group].some(name => !active.includes(name))))
      throw new Error("committed collaboration exposure has an incomplete group");
    return active;
  }
  return [];
}
export function registerCollaborationGroups(pi: ExtensionAPI, plan: CollaborationSurfacePlan,
  owned: readonly string[], fence: CollaborationFence): void {
  let active: string[] = [], extensions: string[] = [], pending: { id: string; group: CollaborationGroup }[] = [];
  let definitions = new Map<string, string>();
  let refusal: string | null = "collaboration exposure has not been validated";
  const expected = () => [...new Set([...plan.direct, ...active, ...extensions])].sort();
  const refuse = (error: unknown): never => {
    refusal = `OMA collaboration surface: ${error instanceof Error ? error.message : String(error)}`;
    try { pi.setActiveTools([]); } catch { /* the effect hook remains closed */ }
    return fence.fatal(refusal);
  };
  const assertExact = () => {
    const names = pi.getActiveTools(), wanted = expected();
    if (names.length !== wanted.length || wanted.some(name => !names.includes(name) || !fence.permitted(name)))
      throw new Error("callable tools differ from committed collaboration exposure");
    for (const name of [...owned, ...GROUPS]) if (!fence.own(name)) throw new Error(`owned tool ${name} is absent or shadowed`);
    for (const name of wanted) {
      const actual = pi.getAllTools().find(tool => tool.name === name), admitted = definitions.get(name);
      if (!actual || !admitted || metadata(actual) !== admitted || (actual.exposure ?? "direct") !== "direct")
        throw new Error(`tool ${name} changed outside a safe exposure boundary`);
    }
  };
  const project = () => {
    const tools = pi.getAllTools();
    for (const name of [...plan.direct, ...GROUPS.flatMap(group => [...plan.groups[group]])])
      if (!tools.some(tool => tool.name === name && (tool.exposure ?? "direct") === "direct") || !fence.permitted(name)) throw new Error(`cannot admit ${name}`);
    // A security revoke is not ordinary group selection. Do not retain a tool
    // because an old event exposed it under an earlier provenance policy.
    active = active.filter(name => fence.permitted(name));
    // User extensions retain the SDK's direct exposure under the existing
    // provenance owner. They are separate from OMA's fixed role catalog and
    // cumulative groups, and are never restored from an exposure event.
    const members = new Set([...plan.direct, ...GROUPS.flatMap(group => [...plan.groups[group]])]);
    extensions = tools.filter(tool => !members.has(tool.name) && !fence.own(tool.name) &&
      tool.sourceInfo?.source !== "builtin" && typeof tool.sourceInfo?.path === "string" &&
      (tool.exposure ?? "direct") === "direct" && fence.permitted(tool.name))
      .map(tool => tool.name);
    const wanted = new Set(expected());
    definitions = new Map(tools.filter(tool => wanted.has(tool.name)).map(tool => [tool.name, metadata(tool)]));
    pi.setActiveTools(expected()); assertExact(); refusal = null;
  };
  for (const group of GROUPS) {
    const lsp = group === "lsp_tools";
    registerTypedTool(pi, {
      name: group, label: lsp ? "Expose LSP tools" : "Expose web tools",
      description: lsp
        ? "Expose the LSP tools permitted for your role for the next model call, after this result is persisted. This adds to the current tools and does not remove web tools. The entry tool does not run diagnostics, apply edits, or grant authority. Call the exposed tools directly when needed."
        : "Expose web research tools for the next model call, after this result is persisted. This adds to the current tools and does not remove LSP tools. The entry tool does not search or fetch anything. Call the exposed tools directly when needed.",
      promptSnippet: lsp ? "Expose permitted LSP tools cumulatively for the next model call." : "Expose web tools cumulatively for the next model call.",
      promptGuidelines: [], executionMode: "sequential", parameters: Type.Object({}, { additionalProperties: false }),
      async execute(id) {
        if (refusal !== null) throw new Error(refusal);
        assertExact();
        const members = [...plan.groups[group]];
        if (members.length === 0 || members.some(name => !fence.permitted(name))) throw new Error("this tool group is unavailable for your role");
        const pendingNames = new Set([...active, ...pending.flatMap(choice => [...plan.groups[choice.group]])]);
        const added = members.filter(name => !pendingNames.has(name));
        pending.push({ id, group });
        const details = { permitted: members, added, alreadyActive: members.filter(name => active.includes(name)),
          resultingCount: new Set([...plan.direct, ...extensions, ...pendingNames, ...members]).size,
          effective: "next-model-call-after-result-persistence" };
        return textResult(JSON.stringify(details), details);
      },
    });
  }
  pi.on("tool_call", event => {
    if (refusal !== null) return { block: true, reason: refusal };
    if (!expected().includes(event.toolName) || !fence.permitted(event.toolName) ||
        ((owned.includes(event.toolName) || GROUPS.includes(event.toolName as CollaborationGroup)) && !fence.own(event.toolName)))
      return { block: true, reason: "tool is outside the committed collaboration exposure" };
    return undefined;
  });
  const start = (context: ExtensionContext) => {
    try { pending = []; active = restored(context, plan); project(); } catch (error) { refuse(error); }
  };
  pi.on("session_start", (_event, context) => { start(context); });
  pi.on("session_tree", (_event, context) => { start(context); });
  pi.on("before_agent_start", (_event, context) => { start(context); });
  pi.on("turn_end", (event, context) => {
    try {
      if (pending.length > 0) {
        const persisted = new Map(context.sessionManager.getBranch().map(entry => [entry.id, entry]));
        if (event.toolResultEntryIds.length !== event.toolResults.length ||
            new Set(event.toolResultEntryIds).size !== event.toolResultEntryIds.length ||
            event.toolResults.some((result, index) => {
              const entry = persisted.get(event.toolResultEntryIds[index]!);
              return entry?.type !== "message" || entry.message.role !== "toolResult" ||
                entry.message.toolCallId !== result.toolCallId || entry.message.toolName !== result.toolName ||
                entry.message.isError !== result.isError;
            })) throw new Error("group exposure requires matching persisted tool results on this branch");
      }
      const successful = pending.filter(choice => event.toolResults.some(result => result.toolCallId === choice.id &&
        result.toolName === choice.group && !result.isError));
      pending = [];
      if (successful.length === 0) { assertExact(); return; }
      active = [...new Set([...active, ...successful.flatMap(choice => [...plan.groups[choice.group]])])].sort();
      project();
      // Pi appends these entries before continuing to another provider request.
      // A fork/resume reads only the committed branch, never pending memory.
      return { entries: [...event.entries, { type: "custom" as const, customType: EVENT,
        data: { version: 1, surface: plan.surface, role: plan.role, active } }] };
    } catch (error) { refuse(error); }
  });
  pi.on("before_provider_request", (_event, context) => {
    try {
      // A later boundary handler can reject or replace proposed entries. Memory
      // is not persistence: do not send the changed loadout without its event.
      const committed = restored(context, plan).sort();
      if (committed.length !== active.length || committed.some((name, index) => name !== active[index]))
        throw new Error("group exposure was not committed to the active session branch");
      assertExact();
    } catch (error) { refuse(error); }
  });
}
