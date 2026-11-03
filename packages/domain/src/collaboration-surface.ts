/** collaboration-v1 exposure contract. Visibility is never effect authority. */
import { StoreError } from "./errors.js";

export type CollaborationRole = "resident" | "principal";
export type CollaborationGroup = "lsp_tools" | "web_tools";
export interface CollaborationSurfacePlan {
  readonly version: 3;
  readonly surface: "collaboration-v1";
  readonly role: CollaborationRole;
  readonly direct: readonly string[];
  readonly groups: Readonly<Record<CollaborationGroup, readonly string[]>>;
}
const WORKER_ACTIONS = ["oma_send", "oma_spawn", "oma_merge", "oma_challenge", "oma_review", "oma_wait", "oma_follow"] as const;
const PRINCIPAL_ACTIONS = ["oma_send", "oma_review", "oma_goal", "oma_society"] as const;
const ENTRIES = ["mcp", "lsp_tools", "web_tools"] as const;
const WEB = Object.freeze(["web_search", "source_check", "fetch_content", "get_search_content"]);
export function collaborationSurface(role: CollaborationRole): CollaborationSurfacePlan {
  if (role !== "resident" && role !== "principal") throw new StoreError("INVALID_REQUEST", "invalid collaboration role");
  return Object.freeze({ version: 3, surface: "collaboration-v1", role,
    direct: Object.freeze(role === "resident"
      ? [...WORKER_ACTIONS, "read", "write", "replace", "insert", "replace_within", "grep", "find", "ls", "bash", ...ENTRIES]
      : [...PRINCIPAL_ACTIONS, "read", "grep", "find", "ls", "ask_user_question", ...ENTRIES]),
    groups: Object.freeze({ lsp_tools: Object.freeze(role === "resident" ? ["lsp_diagnostics", "lsp_fix", "lsp_status"] : ["lsp_status"]), web_tools: WEB }) });
}
export function collaborationOmaNames(role: CollaborationRole): readonly string[] {
  return collaborationSurface(role).direct.filter(name => name.startsWith("oma_"));
}
function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function sameNames(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) && value.length === expected.length && new Set(value).size === value.length &&
    expected.every(name => value.includes(name));
}
/** A new surface is explicit, closed, role-bound and never a reinterpretation of v2. */
export function decodeCollaborationSurface(value: unknown): CollaborationSurfacePlan {
  const fail = (): never => { throw new StoreError("INVALID_REQUEST", "invalid collaboration-v1 tool surface"); };
  if (!exactKeys(value, ["version", "surface", "role", "direct", "groups"]) || value.version !== 3 ||
      value.surface !== "collaboration-v1" || (value.role !== "resident" && value.role !== "principal")) return fail();
  const expected = collaborationSurface(value.role);
  if (!sameNames(value.direct, expected.direct) || !exactKeys(value.groups, ["lsp_tools", "web_tools"]) ||
      !sameNames(value.groups.lsp_tools, expected.groups.lsp_tools) || !sameNames(value.groups.web_tools, expected.groups.web_tools)) return fail();
  return expected;
}

/** Parse only the supported execution contract. Historical bytes are never
 * migrated, decoded as an executable old plan, or promoted by omission. */
export type SurfaceParse = { readonly state: "absent" }
  | { readonly state: "plan"; readonly plan: CollaborationSurfacePlan }
  | { readonly state: "malformed"; readonly reason: string };
export function parseSurfacePlan(raw: string | undefined): SurfaceParse {
  if (raw === undefined) return { state: "absent" };
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("tool surface is not an object");
    if (!("version" in value) || value.version !== 3)
      throw new Error("unsupported tool surface version; preserve original history and use its release for diagnosis or drain; no new execution");
    return { state: "plan", plan: decodeCollaborationSurface(value) };
  } catch (error) {
    return { state: "malformed", reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Must precede opening an SDK session: its constructor can append metadata to
 * existing history before any extension's session_start hook is called. This
 * check grants no execution authority; the authenticated effect owners still do. */
export function requireCollaborationSurface(raw: string | undefined, role: CollaborationRole | undefined): CollaborationSurfacePlan {
  const parsed = parseSurfacePlan(raw);
  if (parsed.state !== "plan") throw new StoreError("UNSUPPORTED_PROFILE", parsed.state === "absent"
    ? "OMA tool surface requires an explicit collaboration plan; no automatic activation"
    : `OMA tool surface is unsupported or malformed: ${parsed.reason}`);
  if (parsed.plan.role !== role) throw new StoreError("UNSUPPORTED_PROFILE", "OMA tool surface belongs to another authenticated role");
  return parsed.plan;
}
