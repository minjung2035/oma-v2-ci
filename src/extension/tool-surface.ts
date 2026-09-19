import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { textResult } from "./shared.js";

/** TSP-005..008: apply the host-validated tool surface projection.
 *
 * The plan arrives already validated: cycles, duplicates, unknown references
 * and limits were rejected at config load. Inside the sandbox this code only
 * does set arithmetic over Pi's own tool registry. It never loads an extension,
 * never wraps a tool and never executes another extension's handler — opening a
 * group activates the real tools so Pi's own pipeline runs them.
 */
export interface SurfacePlanGroup {
  readonly name: string;
  readonly description: string;
  readonly children: readonly string[];
}
export interface SurfacePlan {
  readonly defaultMode: "DIRECT" | "DISABLED";
  readonly direct: readonly string[];
  readonly disabled: readonly string[];
  readonly grouped: readonly string[];
  readonly groups: readonly SurfacePlanGroup[];
  readonly roots: readonly string[];
}
export type SurfaceParse =
  | { readonly state: "absent" }
  | { readonly state: "plan"; readonly plan: SurfacePlan }
  | { readonly state: "malformed"; readonly reason: string };

function stringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  for (const entry of value) if (typeof entry !== "string" || entry.length === 0) return null;
  return value as readonly string[];
}

export function parseSurfacePlan(raw: string | undefined): SurfaceParse {
  if (raw === undefined || raw.trim().length === 0) return { state: "absent" };
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return { state: "malformed", reason: "not JSON" }; }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return { state: "malformed", reason: "not an object" };
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return { state: "malformed", reason: "unsupported version" };
  const mode = record.defaultMode;
  if (mode !== "DIRECT" && mode !== "DISABLED") return { state: "malformed", reason: "bad defaultMode" };
  const direct = stringArray(record.direct);
  const disabled = stringArray(record.disabled);
  const grouped = stringArray(record.grouped);
  const roots = stringArray(record.roots);
  if (!direct || !disabled || !grouped || !roots) return { state: "malformed", reason: "bad name list" };
  if (!Array.isArray(record.groups)) return { state: "malformed", reason: "bad groups" };
  const groups: SurfacePlanGroup[] = [];
  for (const entry of record.groups) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry))
      return { state: "malformed", reason: "bad group" };
    const group = entry as Record<string, unknown>;
    const children = stringArray(group.children);
    if (typeof group.name !== "string" || typeof group.description !== "string" || !children)
      return { state: "malformed", reason: "bad group" };
    groups.push({ name: group.name, description: group.description, children });
  }
  return { state: "plan", plan: { defaultMode: mode, direct, disabled, grouped, groups, roots } };
}

/** DIRECT tools plus the entry-point groups. A tool the plan never mentions
 * follows defaultMode. Names OMA itself registers are always kept so a
 * projection cannot strand the agent without its mail tools.
 */
export function initialActiveTools(
  plan: SurfacePlan,
  registered: readonly string[],
  always: readonly string[],
): string[] {
  const disabled = new Set(plan.disabled);
  const grouped = new Set(plan.grouped);
  const direct = new Set(plan.direct);
  const groupNames = new Set(plan.groups.map((group) => group.name));
  const active = new Set<string>(always);
  for (const name of registered) {
    if (always.includes(name) || groupNames.has(name)) continue;
    if (disabled.has(name) || grouped.has(name)) continue;
    if (direct.has(name) || plan.defaultMode === "DIRECT") active.add(name);
  }
  for (const root of plan.roots) if (groupNames.has(root)) active.add(root);
  return [...active].sort();
}

/** Additive by construction: revealing a group never deactivates a tool another
 * extension activated, and repeating the call is a no-op.
 */
export function expandedActiveTools(
  current: readonly string[],
  children: readonly string[],
): { readonly next: string[]; readonly revealed: string[] } {
  const active = new Set(current);
  const revealed: string[] = [];
  for (const child of children) if (!active.has(child)) { active.add(child); revealed.push(child); }
  return { next: [...active].sort(), revealed };
}

export function registerToolSurface(pi: ExtensionAPI, always: readonly string[]): void {
  const parsed = parseSurfacePlan(process.env.OMA_TOOL_SURFACE);
  if (parsed.state === "absent") return;
  // TSP-007: the projection is a containment decision, so a host that refuses
  // the change leaves the surface in an unproven state. Failing loudly is the
  // only outcome that cannot silently expose a tool meant to be disabled.
  const apply = (names: readonly string[], phase: string): void => {
    try { pi.setActiveTools([...names]); }
    catch (error) {
      throw new Error(`OMA tool surface ${phase} could not be applied: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  if (parsed.state === "malformed") {
    // Fail closed, but not during load: the engine rejects action methods while
    // extensions are still loading, and throwing here would stop the trusted
    // extension from loading at all. The surface is narrowed at session start,
    // before the model can call anything.
    pi.on("session_start", () => { apply(always, `fallback (${parsed.reason})`); });
    return;
  }
  const plan = parsed.plan;
  for (const group of plan.groups) {
    pi.registerTool({
      name: group.name,
      label: group.name,
      description: `${group.description} Opening this group enables its tools for the next turn.`,
      promptSnippet: "Open a tool group to reveal the tools it contains.",
      parameters: Type.Object({}),
      executionMode: "sequential",
      async execute() {
        // An unreadable active set must not be treated as empty: that would
        // deactivate every tool the session already had.
        let active: readonly string[];
        try { active = [...pi.getActiveTools()]; }
        catch (error) {
          throw new Error(`OMA tool surface could not read the active tools: ${error instanceof Error ? error.message : String(error)}`);
        }
        const { next, revealed } = expandedActiveTools(active, group.children);
        apply(next, `group "${group.name}"`);
        const text = revealed.length === 0
          ? `${group.name}: already enabled (${group.children.join(", ")})`
          : `${group.name}: enabled ${revealed.length} (${revealed.join(", ")})`;
        return textResult(text, { group: group.name, revealed });
      },
    });
  }
  const project = (): void => {
    let registered: string[];
    try { registered = pi.getAllTools().map((tool) => tool.name); }
    catch (error) {
      throw new Error(`OMA tool surface could not read the registered tools: ${error instanceof Error ? error.message : String(error)}`);
    }
    apply(initialActiveTools(plan, registered, always), "projection");
  };
  // Registering tools is allowed while loading; reading or setting the active
  // set is not. The projection therefore happens only at session start, which
  // still precedes any model turn.
  pi.on("session_start", () => { project(); });
}
