import type { ExtensionAPI, ExtensionContext, ToolInfo } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { planToolSurface, TOOLSET_NAME, type ToolSurfaceConfig, type ToolSurfacePlan } from "@oma/domain/tool-surface";
import { registerTypedTool, stringEnum, textResult } from "./shared.js";

export type SurfacePlan = ToolSurfacePlan;
export type SurfaceParse = { readonly state: "absent" } | { readonly state: "plan"; readonly plan: SurfacePlan }
  | { readonly state: "malformed"; readonly reason: string };
export function parseSurfacePlan(raw: string | undefined): SurfaceParse {
  if (raw === undefined) return { state: "absent" };
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    const { version, ...config } = value as Record<string, unknown>;
    if (version !== 2) throw new Error("unsupported surface version; restart with the current deployment");
    // planToolSurface validates the complete closed input before returning a plan.
    return { state: "plan", plan: planToolSurface(config as unknown as ToolSurfaceConfig) };
  } catch (error) { return { state: "malformed", reason: error instanceof Error ? error.message : String(error) }; }
}

export function initialActiveTools(plan: SurfacePlan): string[] {
  return [...new Set([...plan.direct, TOOLSET_NAME])].sort();
}

export interface SurfaceFence {
  readonly permitted?: ((name: string) => boolean) | undefined;
  readonly own?: ((name: string) => boolean) | undefined;
  readonly fatal?: ((message: string) => never) | undefined;
}
function defaultFatal(message: string): never {
  try { process.stderr.write(`${message}\n`); } catch { /* best-effort diagnostic */ }
  process.exit(1);
}

const COMMITTED_SELECTION = "oma-toolset";

/** Only a safe-boundary snapshot is committed. A successful tool result still
 * describes a pending choice when the process stops before turn_end. Pi's
 * branch-local session entries survive resume/fork without another store. */
function restoredSelection(context: ExtensionContext): string[] {
  const branch = context.sessionManager.getBranch();
  for (let index = branch.length - 1; index >= 0; index--) {
    const entry = branch[index]!;
    if (entry.type !== "custom" || entry.customType !== COMMITTED_SELECTION) continue;
    const data = entry.data as { version?: unknown; select?: unknown } | undefined;
    if (data?.version !== 1 || !Array.isArray(data.select) || data.select.some(name => typeof name !== "string"))
      throw new Error("committed toolset selection is malformed");
    return data.select as string[];
  }
  return [];
}

/** The only owner of core/optional visibility. A selection never dispatches
 * another tool and never changes broker or filesystem authority. */
export function registerToolSurface(pi: ExtensionAPI, owned: readonly string[], fence: SurfaceFence = {}): void {
  const { permitted = () => true, own = name => owned.includes(name) || name === TOOLSET_NAME, fatal = defaultFatal } = fence;
  const parsed = parseSurfacePlan(process.env.OMA_TOOL_SURFACE);
  if (parsed.state === "absent") {
    pi.on("session_start", () => { pi.setActiveTools(pi.getActiveTools().filter(permitted)); });
    return;
  }
  let refusal: string | null = "OMA tool surface has not been validated";
  pi.on("tool_call", event => refusal !== null ? { block: true, reason: refusal }
    : !permitted(event.toolName) || !expectedActive().includes(event.toolName) ||
      ((owned.includes(event.toolName) || event.toolName === TOOLSET_NAME) && !own(event.toolName))
      ? { block: true, reason: "tool is outside the admitted turn loadout" } : undefined);
  const refuse = (message: string): never => {
    refusal = message;
    try { pi.setActiveTools([]); } catch { /* effect hook remains closed */ }
    return fatal(message);
  };
  if (parsed.state === "malformed") {
    pi.on("session_start", () => { refuse(`OMA tool surface is malformed: ${parsed.reason}`); });
    return;
  }
  const plan = parsed.plan;
  let core: string[] = [], optional: string[] = [], selected: string[] = [];
  let pending: { id: string; select: string[] }[] = [];
  let catalogSignature = "", selectorParameters: unknown;
  let definitions = new Map<string, ToolInfo>();
  const validateSelection = (names: readonly string[]): void => {
    if (new Set(names).size !== names.length || names.some(name => !optional.includes(name)))
      throw new Error("toolset.select must contain distinct optional names from the current catalog; core tools cannot be selected or disabled");
  };
  const expectedActive = () => [...core, ...selected].sort();
  const assertExact = (): void => {
    const actual = pi.getActiveTools(), expected = expectedActive();
    if (actual.length !== expected.length || expected.some(name => !actual.includes(name) || !permitted(name)))
      throw new Error("the engine's callable tools differ from the admitted selection");
    for (const name of [...owned, TOOLSET_NAME])
      if (!own(name)) throw new Error(`OMA-owned tool ${name} is missing or shadowed`);
    const tools = pi.getAllTools();
    for (const name of expected) {
      const tool = tools.find(candidate => candidate.name === name), admitted = definitions.get(name);
      if (!tool || !admitted || tool.parameters !== admitted.parameters || tool.description !== admitted.description ||
          tool.sourceInfo?.source !== admitted.sourceInfo?.source || tool.sourceInfo?.path !== admitted.sourceInfo?.path)
        throw new Error(`tool ${name} changed outside the safe surface boundary`);
    }
  };
  const apply = (): void => {
    pi.setActiveTools(expectedActive());
    assertExact();
    refusal = null;
  };
  const project = (): void => {
    const tools = pi.getAllTools();
    const existing = tools.find(tool => tool.name === TOOLSET_NAME);
    if (existing && (existing.parameters !== selectorParameters || !own(TOOLSET_NAME)))
      throw new Error("toolset conflicts with another registration");
    const names = tools.map(tool => tool.name);
    for (const name of [...plan.direct, ...plan.optional]) {
      if (name === TOOLSET_NAME) continue;
      if (!names.includes(name) || !permitted(name)) throw new Error(`tool surface cannot admit ${name}`);
    }
    for (const name of owned)
      if (!names.includes(name) || !own(name)) throw new Error(`OMA-owned tool ${name} is missing or shadowed`);
    core = initialActiveTools(plan);
    // Verified user extensions are optional, never silently auto-activated.
    optional = [...new Set([...plan.optional, ...tools.filter(tool =>
      !core.includes(tool.name) && !plan.disabled.includes(tool.name) &&
      tool.sourceInfo?.source !== "builtin" && !own(tool.name) && permitted(tool.name)).map(tool => tool.name)])].sort();
    const catalog = optional.map(name => {
      const tool = tools.find(tool => tool.name === name)!;
      return `${name}: ${tool.description.split(/\n|(?<=\.)\s/, 1)[0]}`;
    }).join("\n");
    const signature = JSON.stringify([optional, catalog]);
    if (signature !== catalogSignature) {
      const parameters = Type.Object({ select: Type.Array(stringEnum(optional), { uniqueItems: true,
        description: "Exact, complete list of optional tool names to expose at the next safe turn boundary; replaces the previous selection. [] keeps only core tools." }) }, { additionalProperties: false });
      registerTypedTool(pi, {
        name: TOOLSET_NAME, label: "Select optional tools",
        description: `Select the complete optional tool set for the next turn boundary, after results are persisted. This replaces rather than appends to the previous selection; core tools remain available. Returns the selected names, removed names, next active count and application boundary. Selection neither calls a tool nor grants authority. Call selected tools directly after the boundary. Selectable catalog:\n${catalog}`,
        promptSnippet: "Replace the optional tool selection by exact catalog names; core tools remain available.",
        executionMode: "sequential", parameters,
        async execute(id, params) {
          if (refusal !== null) throw new Error(refusal);
          validateSelection(params.select);
          assertExact();
          const select = [...params.select].sort();
          pending.push({ id, select });
          const result = { select, removed: selected.filter(name => !select.includes(name)),
            nextActiveCount: core.length + select.length, appliesAt: "turn_end-after-results-persisted" };
          return textResult(JSON.stringify(result), result);
        },
      });
      selectorParameters = pi.getAllTools().find(tool => tool.name === TOOLSET_NAME)?.parameters;
      if (!selectorParameters) throw new Error("toolset registration did not reach the live registry");
      catalogSignature = signature;
    }
    validateSelection(selected);
    definitions = new Map(pi.getAllTools().map(tool => [tool.name, tool]));
  };
  const start = (context: ExtensionContext): void => {
    try {
      pending = [];
      selected = restoredSelection(context);
      project();
      apply();
    } catch (error) { refuse(`OMA tool surface: ${error instanceof Error ? error.message : String(error)}`); }
  };
  pi.on("session_start", (_event, context) => { start(context); });
  pi.on("session_tree", (_event, context) => { start(context); });
  pi.on("before_agent_start", () => {
    try { pending = []; project(); apply(); }
    catch (error) { refuse(`OMA tool surface: ${error instanceof Error ? error.message : String(error)}`); }
  });
  pi.on("turn_end", event => {
    try {
      if (pending.length > 0 && event.toolResultEntryIds.length !== event.toolResults.length)
        throw new Error("toolset cannot commit before all tool results are persisted");
      const committed = pending.filter(choice => event.toolResults.some(result =>
        result.toolCallId === choice.id && result.toolName === TOOLSET_NAME && !result.isError)).at(-1);
      pending = [];
      if (committed) selected = committed.select;
      project(); apply();
      if (committed) return { entries: [...event.entries, { type: "custom" as const,
        customType: COMMITTED_SELECTION, data: { version: 1, select: selected } }] };
    } catch (error) { refuse(`OMA tool surface: ${error instanceof Error ? error.message : String(error)}`); }
  });
  // A late registration between safe boundaries must not leak into a request.
  pi.on("before_provider_request", () => {
    try { assertExact(); }
    catch (error) { refuse(`OMA tool surface: ${error instanceof Error ? error.message : String(error)}`); }
  });
}
