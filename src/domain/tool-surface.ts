/** TSP-001..004: model-facing tool surface projection, validated host-side.
 *
 * A role may project the tools its extensions register as DIRECT (visible),
 * DISABLED (never callable) or GROUPED (revealed only after the model opens the
 * owning group). Grouping is a DAG whose members are explicit tool or subgroup
 * references.
 *
 * This module is pure and owns validation only. It never loads an extension,
 * never registers a tool and never executes one. The flattened result is what
 * the trusted core extension applies inside Pi, so every cycle, duplicate and
 * unknown reference fails here rather than inside the sandbox.
 */
import { StoreError } from "./errors.js";

export type DefaultSurfaceMode = "DIRECT" | "DISABLED";
export type GroupMemberRef = { readonly tool: string } | { readonly group: string };

export interface GroupSpec {
  readonly name: string;
  readonly description: string;
  readonly members: readonly GroupMemberRef[];
}

export interface ToolSurfaceConfig {
  readonly defaultMode: DefaultSurfaceMode;
  readonly direct: readonly string[];
  readonly disabled: readonly string[];
  readonly groups: readonly GroupSpec[];
  readonly roots: readonly string[];
}

/** One group's immediate children, already resolved to plain names. Subgroup
 * and tool members are indistinguishable here on purpose: revealing a child is
 * the same operation either way.
 */
export interface PlannedGroup {
  readonly name: string;
  readonly description: string;
  readonly children: readonly string[];
}

export interface ToolSurfacePlan {
  readonly version: 1;
  readonly defaultMode: DefaultSurfaceMode;
  readonly direct: readonly string[];
  readonly disabled: readonly string[];
  readonly grouped: readonly string[];
  readonly groups: readonly PlannedGroup[];
  readonly roots: readonly string[];
}

/** Bounded like every other OMA input surface (CFG-003 style). A projection is
 * navigation metadata, not a place to encode a workflow.
 */
export const SURFACE_LIMITS = Object.freeze({
  groups: 32,
  membersPerGroup: 16,
  depth: 4,
  names: 512,
  descriptionBytes: 512,
});

const NAME = /^[a-z][a-z0-9_-]{0,63}$/;

function invalid(message: string): never {
  throw new StoreError("INVALID_REQUEST", `tool surface: ${message}`);
}

function assertName(value: unknown, what: string): string {
  if (typeof value !== "string" || !NAME.test(value)) invalid(`${what} must match ${String(NAME)}`);
  return value as string;
}

function assertUnique(values: readonly string[], what: string): void {
  if (new Set(values).size !== values.length) invalid(`${what} contains a duplicate`);
}

/** Depth-first cycle detection over the declared subgroup edges. A group that
 * can reach itself would let one reveal loop forever.
 */
function assertAcyclic(edges: ReadonlyMap<string, readonly string[]>): number {
  const state = new Map<string, "open" | "done">();
  let deepest = 0;
  const walk = (name: string, depth: number): void => {
    if (depth > SURFACE_LIMITS.depth) invalid(`group nesting exceeds depth ${SURFACE_LIMITS.depth}`);
    const seen = state.get(name);
    if (seen === "open") invalid(`group "${name}" is part of a cycle`);
    if (seen === "done") return;
    state.set(name, "open");
    deepest = Math.max(deepest, depth);
    for (const child of edges.get(name) ?? []) walk(child, depth + 1);
    state.set(name, "done");
  };
  for (const name of edges.keys()) walk(name, 1);
  return deepest;
}

/** Validates the declared projection and flattens it for the sandbox.
 *
 * The tool names a role's extensions will actually register are unknown here,
 * so this function validates structure and references between declared names
 * only. Applying the modes to the live tool set is the extension's set
 * arithmetic, not a second policy decision.
 */
export function planToolSurface(config: ToolSurfaceConfig): ToolSurfacePlan {
  if (config.defaultMode !== "DIRECT" && config.defaultMode !== "DISABLED")
    invalid("defaultMode must be DIRECT or DISABLED");
  if (config.groups.length > SURFACE_LIMITS.groups)
    invalid(`at most ${SURFACE_LIMITS.groups} groups`);

  const direct = config.direct.map(name => assertName(name, "direct entry"));
  const disabled = config.disabled.map(name => assertName(name, "disabled entry"));
  assertUnique(direct, "direct");
  assertUnique(disabled, "disabled");
  for (const name of direct)
    if (disabled.includes(name)) invalid(`"${name}" is both direct and disabled`);

  const groupNames: string[] = [];
  for (const group of config.groups) {
    const name = assertName(group.name, "group name");
    if (typeof group.description !== "string" || group.description.length === 0)
      invalid(`group "${name}" needs a description`);
    if (Buffer.byteLength(group.description, "utf8") > SURFACE_LIMITS.descriptionBytes)
      invalid(`group "${name}" description exceeds ${SURFACE_LIMITS.descriptionBytes} bytes`);
    groupNames.push(name);
  }
  assertUnique(groupNames, "group names");
  const groupSet = new Set(groupNames);
  for (const name of [...direct, ...disabled])
    if (groupSet.has(name)) invalid(`"${name}" is both a group and a tool selector`);

  const edges = new Map<string, readonly string[]>();
  const children = new Map<string, readonly string[]>();
  const owner = new Map<string, string>();
  const grouped: string[] = [];
  for (const group of config.groups) {
    if (group.members.length > SURFACE_LIMITS.membersPerGroup)
      invalid(`group "${group.name}" exceeds ${SURFACE_LIMITS.membersPerGroup} members`);
    const names: string[] = [];
    const subgroups: string[] = [];
    for (const member of group.members) {
      if ("group" in member) {
        const child = assertName(member.group, "group member");
        if (child === group.name) invalid(`group "${group.name}" references itself`);
        if (!groupSet.has(child)) invalid(`group "${group.name}" references unknown group "${child}"`);
        subgroups.push(child);
        names.push(child);
        continue;
      }
      const tool = assertName(member.tool, "tool member");
      if (groupSet.has(tool)) invalid(`"${tool}" is a group name and cannot be a tool member`);
      if (disabled.includes(tool)) invalid(`disabled tool "${tool}" cannot be a group member`);
      const claimed = owner.get(tool);
      if (claimed !== undefined) invalid(`tool "${tool}" is claimed by groups "${claimed}" and "${group.name}"`);
      owner.set(tool, group.name);
      grouped.push(tool);
      names.push(tool);
    }
    assertUnique(names, `group "${group.name}" members`);
    edges.set(group.name, subgroups);
    children.set(group.name, names);
  }
  for (const tool of grouped)
    if (direct.includes(tool)) invalid(`tool "${tool}" is both direct and grouped`);

  const depth = assertAcyclic(edges);

  const referenced = new Set<string>();
  for (const subgroups of edges.values()) for (const child of subgroups) referenced.add(child);
  const declaredRoots = config.roots.map(name => assertName(name, "root"));
  assertUnique(declaredRoots, "roots");
  for (const root of declaredRoots)
    if (!groupSet.has(root)) invalid(`unknown root group "${root}"`);
  // With no explicit roots the entry points are the groups nothing nests.
  const roots = declaredRoots.length > 0 ? declaredRoots : groupNames.filter(name => !referenced.has(name));

  const total = direct.length + disabled.length + grouped.length + groupNames.length;
  if (total > SURFACE_LIMITS.names) invalid(`at most ${SURFACE_LIMITS.names} declared names`);

  return Object.freeze({
    version: 1 as const,
    defaultMode: config.defaultMode,
    direct: Object.freeze([...direct]),
    disabled: Object.freeze([...disabled]),
    grouped: Object.freeze([...grouped]),
    groups: Object.freeze(config.groups.map(group => Object.freeze({
      name: group.name,
      description: group.description,
      children: Object.freeze([...(children.get(group.name) ?? [])]),
    }))),
    roots: Object.freeze([...roots]),
  });
}

/** The plan travels to the sandbox as canonical JSON. Key order is fixed so the
 * same projection always produces the same bytes.
 */
export function encodeToolSurfacePlan(plan: ToolSurfacePlan): string {
  return JSON.stringify({
    version: plan.version,
    defaultMode: plan.defaultMode,
    direct: plan.direct,
    disabled: plan.disabled,
    grouped: plan.grouped,
    groups: plan.groups.map(group => ({ name: group.name, description: group.description, children: group.children })),
    roots: plan.roots,
  });
}

export { depthOf };

function depthOf(plan: ToolSurfacePlan): number {
  const edges = new Map<string, readonly string[]>();
  const names = new Set(plan.groups.map(group => group.name));
  for (const group of plan.groups)
    edges.set(group.name, group.children.filter(child => names.has(child)));
  return assertAcyclic(edges);
}
