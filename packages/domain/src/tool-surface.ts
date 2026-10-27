/** TSP-001..004: model-facing tool surface projection, validated host-side.
 *
 * A projection — OMA's own runtime policy, never an authored role field
 * (D23) — marks the tools a role's extensions register as DIRECT (visible),
 * DISABLED (never callable) or GROUPED (revealed only after the model opens
 * the owning group). Grouping is a DAG whose members are explicit tool or
 * subgroup references.
 *
 * This module is pure and owns validation only. It never loads an extension,
 * never registers a tool and never executes one. The flattened result is what
 * the trusted core extension applies inside Pi, so every cycle, duplicate and
 * unknown group reference fails here. Only the extension's completed registry
 * can judge live tool references and collisions; that check belongs there.
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
/** P0V-31, P0-2: two facts about the group graph, kept apart. Whether a group
 * is on the path being walked answers "is there a cycle"; how many levels of
 * groups hang from a finished group answers "how deep". Using the first for
 * the second skipped a group already walked from a shallower root, so whether
 * a too-deep nesting was refused depended on the order groups were declared. */
function assertAcyclic(edges: ReadonlyMap<string, readonly string[]>): number {
  const state = new Map<string, "open" | "done">();
  const height = new Map<string, number>();
  const measure = (name: string): number => {
    const seen = state.get(name);
    if (seen === "open") invalid(`group "${name}" is part of a cycle`);
    if (seen === "done") return height.get(name)!;
    state.set(name, "open");
    let below = 0;
    for (const child of edges.get(name) ?? []) below = Math.max(below, measure(child));
    const levels = below + 1;
    if (levels > SURFACE_LIMITS.depth) invalid(`group nesting exceeds depth ${SURFACE_LIMITS.depth}`);
    state.set(name, "done");
    height.set(name, levels);
    return levels;
  };
  let deepest = 0;
  for (const name of edges.keys()) deepest = Math.max(deepest, measure(name));
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

/** The one bundled-extension group both roles expose: language-server
 * intelligence hidden until the model opens the group. Mirrors
 * `LSP_TOOL_NAMES` in src/extension/lsp-tools.ts -- PI-001 keeps the
 * extension from importing this module, so a test binds the two lists. */
const CODE_INTEL_GROUP_NAME = "code_intel";
const CODE_INTEL_TOOLS: readonly string[] = ["lsp_diagnostics", "lsp_fix", "lsp_status"];
/** BL3: the bundled hashline editor's mutation surface — anchored replace
 * and insert, grouped until the model opens it. Mirrors
 * `HASHLINE_EDIT_TOOL_NAMES` in src/extension/hashline-tools.ts; PI-001
 * keeps the extension from importing this module, so a test binds the two
 * lists. The anchored `read` the bundle also registers stays DIRECT under
 * the same name as the contained read it replaces. */
const FILE_EDIT_GROUP_NAME = "file_edit";
const FILE_EDIT_TOOLS: readonly string[] = ["replace", "replace_within", "insert"];
/** BL4: the bundled pi-web-access extension's research surface — web
 * search, source checking, remote content fetch and stored-content
 * retrieval, grouped until the model opens it. Mirrors
 * `WEB_RESEARCH_TOOL_NAMES` in src/extension/web-tools.ts; PI-001 keeps
 * the extension from importing this module, so a test binds the two
 * lists the same way the code_intel list binds LSP_TOOL_NAMES. */
const WEB_RESEARCH_GROUP_NAME = "web_research";
const WEB_RESEARCH_TOOLS: readonly string[] = ["web_search", "source_check", "fetch_content", "get_search_content"];
/** BL5: the bundled pi-mcp-adapter's surface — upstream's own `mcp` proxy
 * tool, DIRECT for both roles. No OMA grouping wraps it: the proxy tool
 * is already the lazy boundary upstream designed (the model searches and
 * calls server tools through its params). Mirrors `MCP_TOOL_NAMES` in
 * src/extension/mcp-tools.ts; PI-001 keeps the extension from importing
 * this module, so a test binds the two lists the same way the code_intel
 * list binds LSP_TOOL_NAMES. */
export const MCP_PROXY_TOOL_NAME = "mcp";
// BL2: the bundled human-input tool — mirrors ASK_USER_QUESTION_TOOL_NAME
// in packages/protocol/src/ask-user-question.ts. PI-001 keeps the extension
// from importing this module, so a test binds the two spellings, the same
// way the code_intel list binds LSP_TOOL_NAMES.
export const ASK_USER_QUESTION_TOOL_NAME = "ask_user_question";

function codeIntelGroup(): GroupSpec {
  return {
    name: CODE_INTEL_GROUP_NAME,
    description: "Language-server intelligence: workspace diagnostics, code-action fixes (preview by default) and server status.",
    members: CODE_INTEL_TOOLS.map(tool => ({ tool })),
  };
}

function fileEditGroup(): GroupSpec {
  return {
    name: FILE_EDIT_GROUP_NAME,
    description: "Hashline-anchored file edits: anchor-stable replace, range-scoped replace_within and anchored insert. Stale anchors refuse before writing.",
    members: FILE_EDIT_TOOLS.map(tool => ({ tool })),
  };
}

function webResearchGroup(): GroupSpec {
  return {
    name: WEB_RESEARCH_GROUP_NAME,
    description: "Web research: search the web, check a source's reachability and metadata, fetch remote page content, and page through stored results by responseId.",
    members: WEB_RESEARCH_TOOLS.map(tool => ({ tool })),
  };
}

/** The OMA tool names a Resident's engine registers -- mirrors
 * `omaToolNames(false)` in src/extension/mail-tools.ts -- plus the Pi
 * builtins a confined engine carries (no --exclude-tools on the confined
 * argv). Naming them in `direct` makes their absence a startup refusal
 * rather than a silent hole in the surface. */
const RESIDENT_DIRECT_TOOLS: readonly string[] = [
  "read", "write", "edit", "bash", "grep", "find", "ls",
  "oma_mail_read", "oma_mail_send", "oma_mail_ack", "oma_status", "oma_merge", "oma_challenge",
  MCP_PROXY_TOOL_NAME,
];

/** The Principal's engine: the host argv excludes bash, powershell, write
 * and edit, and its registrations are the mail pair plus the principal
 * tools -- mirrors `omaToolNames(true)`. `lsp_fix` is on the surface
 * because its default is preview; the workspace guard refuses a
 * `write: true` call for the read-only role before execute runs.
 * `ask_user_question` is DIRECT here and only here: the tool exists where a
 * human sits at the terminal (Principal, and Personal by its own `-e`
 * extension), and stays absent from Resident/Worker plans entirely. */
const PRINCIPAL_DIRECT_TOOLS: readonly string[] = [
  "read", "grep", "find", "ls",
  "oma_mail_read", "oma_mail_send", "oma_society", "oma_agent_lifecycle", "oma_merge", "oma_challenge",
  ASK_USER_QUESTION_TOOL_NAME,
  MCP_PROXY_TOOL_NAME,
];

/** D23/TSP-005 role surfaces, declared host-side. Each names every tool
 * its role is meant to have, so the extension's projection refuses
 * startup if the deployment's registry and this declaration ever drift
 * apart -- a plan is a statement of what exists, and a name that does not
 * resolve ends the session instead of degrading it. defaultMode is
 * DIRECT: nothing already exposed changes its visibility; what these
 * plans add is the code_intel group boundary and the refusal-on-drift
 * contract. */
export function residentToolSurfaceConfig(): ToolSurfaceConfig {
  return {
    defaultMode: "DIRECT",
    direct: RESIDENT_DIRECT_TOOLS,
    disabled: [],
    groups: [codeIntelGroup(), fileEditGroup(), webResearchGroup()],
    roots: [CODE_INTEL_GROUP_NAME, FILE_EDIT_GROUP_NAME, WEB_RESEARCH_GROUP_NAME],
  };
}

export function principalToolSurfaceConfig(): ToolSurfaceConfig {
  return {
    defaultMode: "DIRECT",
    direct: PRINCIPAL_DIRECT_TOOLS,
    disabled: [],
    groups: [codeIntelGroup(), webResearchGroup()],
    roots: [CODE_INTEL_GROUP_NAME, WEB_RESEARCH_GROUP_NAME],
  };
}

/** The encoded plan a Resident's explicit launch environment carries (as hex, beside
 * the profile and resources hex) -- produced once, validated by
 * planToolSurface, identical bytes for every Resident of a deployment. */
export function encodedResidentToolSurface(): string {
  return encodeToolSurfacePlan(planToolSurface(residentToolSurfaceConfig()));
}

/** The encoded plan the Principal's host session is spawned with. */
export function encodedPrincipalToolSurface(): string {
  return encodeToolSurfacePlan(planToolSurface(principalToolSurfaceConfig()));
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
