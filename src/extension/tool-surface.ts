import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { textResult } from "./shared.js";

/** TSP-005..008: apply the host-validated tool surface projection.
 *
 * The plan's structure is validated at config load. The live registry can only
 * be checked after extensions load: group names must not replace real tools,
 * and selectors must resolve. This code never loads an extension,
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

/** What the caller knows about a tool's provenance. `permitted` authorizes a
 * call; `own` says the effective registration is one OMA itself made -- the
 * protection OMA's tools get when a shadow would otherwise run under their
 * name. `fatal` ends the engine when the surface cannot be validated: Pi
 * reports a session_start exception and keeps running, so the only startup
 * failure that actually stops the session is the process's own. */
export interface SurfaceFence {
  readonly permitted?: ((name: string) => boolean) | undefined;
  readonly own?: ((name: string) => boolean) | undefined;
  readonly fatal?: ((message: string) => never) | undefined;
}

/** The default way a refused surface stops the engine: say why, then exit. */
function defaultFatal(message: string): never {
  try { process.stderr.write(`${message}\n`); } catch { /* the reason is best-effort */ }
  process.exit(1);
}

export function registerToolSurface(pi: ExtensionAPI, always: readonly string[], fence: SurfaceFence = {}): void {
  const { permitted, own = (name: string) => always.includes(name), fatal = defaultFatal } = fence;
  const parsed = parseSurfacePlan(process.env.OMA_TOOL_SURFACE);
  if (parsed.state === "absent") {
    if (permitted) pi.on("session_start", () => pi.setActiveTools(pi.getActiveTools().filter(permitted)));
    return;
  }
  let refusal: string | null = "OMA tool surface has not been validated";
  // Pi reports session_start exceptions but continues running. The effect
  // boundary must stay closed even if applying the fallback itself fails, and
  // `own` -- not the name list -- decides what may run through the gap.
  pi.on("tool_call", event => refusal !== null && !own(event.toolName)
    ? { block: true, reason: refusal } : undefined);
  // TSP-007: the projection is a containment decision, so a host that refuses
  // the change leaves the surface in an unproven state. Failing loudly is the
  // only outcome that cannot silently expose a tool meant to be disabled.
  const apply = (names: readonly string[], phase: string): void => {
    try {
      const allowed = permitted ? names.filter(permitted) : names;
      pi.setActiveTools([...allowed]);
      const actual = new Set(pi.getActiveTools());
      if (actual.size !== new Set(allowed).size || allowed.some(name => !actual.has(name)))
        throw new Error("the engine did not apply the exact active tool set");
    } catch (error) {
      refusal = `OMA tool surface ${phase} could not be applied: ${error instanceof Error ? error.message : String(error)}`;
      throw new Error(refusal);
    }
  };
  /** Every startup validation failure ends here: the refusal stays registered
   * for the calls already possible, OMA's own tools are kept active as a last
   * closed state, and the engine exits -- a malformed or impossible surface is
   * a session that must not start, not one that quietly degrades. */
  const refuse = (message: string): never => {
    refusal = message;
    try { apply(always, "fallback"); } catch { /* the gate above still closes */ }
    return fatal(message);
  };
  if (parsed.state === "malformed") {
    // Fail closed, but not during load: the engine rejects action methods while
    // extensions are still loading, and throwing here would stop the trusted
    // extension from loading at all. The surface is judged at session start,
    // before the model can call anything.
    pi.on("session_start", () => { refuse(`OMA tool surface is malformed: ${parsed.reason}`); });
    return;
  }
  const plan = parsed.plan;
  const registeredGroups = new Map<string, unknown>();
  const registerGroups = (): void => { for (const group of plan.groups) {
    if (registeredGroups.has(group.name)) continue;
    const parameters = Type.Object({});
    pi.registerTool({
      name: group.name,
      label: group.name,
      description: `${group.description} Opening this group enables its tools for the next turn.`,
      promptSnippet: "Open a tool group to reveal the tools it contains.",
      parameters,
      executionMode: "sequential",
      async execute() {
        if (refusal !== null) throw new Error(refusal);
        // An unreadable active set must not be treated as empty: that would
        // deactivate every tool the session already had.
        let active: readonly string[];
        try { active = [...pi.getActiveTools()]; }
        catch (error) {
          throw new Error(`OMA tool surface could not read the active tools: ${error instanceof Error ? error.message : String(error)}`);
        }
        const { next, revealed } = expandedActiveTools(active, permitted ? group.children.filter(permitted) : group.children);
        apply(next, `group "${group.name}"`);
        const text = revealed.length === 0
          ? `${group.name}: already enabled (${group.children.join(", ")})`
          : `${group.name}: enabled ${revealed.length} (${revealed.join(", ")})`;
        return textResult(text, { group: group.name, revealed });
      },
    });
    registeredGroups.set(group.name, parameters);
  } };
  const project = (): void => {
    refusal = "OMA tool surface has not been validated";
    let tools: ReturnType<ExtensionAPI["getAllTools"]>;
    try {
      try { tools = pi.getAllTools(); }
      catch (error) {
        throw new Error(`OMA tool surface could not read the registered tools: ${error instanceof Error ? error.message : String(error)}`);
      }
      const registered = new Set(tools.map(tool => tool.name));
      // An OMA name held by something else is not an OMA tool: a shadow that
      // waited for this moment would run with the trust the name implies.
      for (const name of always)
        if (registered.has(name) && !own(name))
          throw new Error(`OMA-owned tool "${name}" is shadowed by another registration`);
      for (const group of plan.groups) {
        const existing = tools.find(tool => tool.name === group.name);
        if (always.includes(group.name) || (existing && (!registeredGroups.has(group.name) || existing.parameters !== registeredGroups.get(group.name))))
          throw new Error(`OMA tool surface group "${group.name}" conflicts with a registered tool`);
      }
      for (const name of [...plan.direct, ...plan.disabled, ...plan.grouped])
        if (!registered.has(name)) throw new Error(`OMA tool surface references unknown tool "${name}"`);
      registerGroups();
      apply(initialActiveTools(plan, [...registered], always), "projection");
      refusal = null;
    } catch (error) {
      refuse(error instanceof Error ? error.message : String(error));
    }
  };
  // Pi allows post-bind registration. Validate before registering groups so
  // neither a built-in nor another extension's handler can be overwritten.
  pi.on("session_start", () => { project(); });
}
