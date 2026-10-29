/** Host-owned model surface: stable core and an explicitly selectable catalog.
 * Exposure is not authority. This module never registers or executes a tool. */
import { StoreError } from "./errors.js";

export type DefaultSurfaceMode = "DISABLED";
export interface ToolSurfaceConfig {
  readonly defaultMode: DefaultSurfaceMode;
  readonly direct: readonly string[];
  readonly optional: readonly string[];
  readonly disabled: readonly string[];
}
export interface ToolSurfacePlan extends ToolSurfaceConfig { readonly version: 2 }
export const SURFACE_LIMITS = Object.freeze({ names: 512 });
export const MCP_PROXY_TOOL_NAME = "mcp";
export const ASK_USER_QUESTION_TOOL_NAME = "ask_user_question";
export const TOOLSET_NAME = "toolset";
const NAME = /^[a-z][a-z0-9_-]{0,63}$/;

export function planToolSurface(config: ToolSurfaceConfig): ToolSurfacePlan {
  if (config === null || typeof config !== "object" || Array.isArray(config) ||
      Object.keys(config).some(key => !["defaultMode", "direct", "optional", "disabled"].includes(key)) ||
      config.defaultMode !== "DISABLED")
    throw new StoreError("INVALID_REQUEST", "tool surface requires a closed core/optional configuration");
  const seen = new Set<string>();
  for (const field of ["direct", "optional", "disabled"] as const) {
    if (!Array.isArray(config[field])) throw new StoreError("INVALID_REQUEST", `tool surface ${field} requires a list`);
    for (const name of config[field]) {
      if (typeof name !== "string" || !NAME.test(name) || seen.has(name))
        throw new StoreError("INVALID_REQUEST", `tool surface has an invalid, duplicate or conflicting ${field} name`);
      seen.add(name);
    }
  }
  if (seen.size > SURFACE_LIMITS.names) throw new StoreError("INVALID_REQUEST", "tool surface metadata exceeds its name bound");
  if (config.optional.includes(TOOLSET_NAME) || config.disabled.includes(TOOLSET_NAME))
    throw new StoreError("INVALID_REQUEST", "toolset cannot be optional or disabled");
  return Object.freeze({ version: 2, defaultMode: config.defaultMode, direct: Object.freeze([...config.direct]),
    optional: Object.freeze([...config.optional]), disabled: Object.freeze([...config.disabled]) });
}

const WORKER_CORE = Object.freeze([
  "read", "write", "replace", "bash", "grep", "find", "ls", TOOLSET_NAME,
  "oma_agent_create", "oma_agent_wait", "oma_mail_read", "oma_mail_send", "oma_mail_ack", "oma_status",
  "oma_merge_open", "oma_challenge_open", "oma_review_status", "oma_review_diff", "oma_review_respond",
]);
const WORKER_OPTIONAL = Object.freeze([
  "oma_agent_control", "oma_agent_continue", "oma_logs", "oma_operation_status", "oma_mail_reply",
  "oma_topic_subscription", "oma_context_publish", "oma_candidate_publish", "oma_mail_approval_notice",
  "oma_review_list", "oma_review_cancel", "insert", "replace_within", "lsp_diagnostics", "lsp_fix", "lsp_status",
  "web_search", "source_check", "fetch_content", "get_search_content", MCP_PROXY_TOOL_NAME,
]);
const PRINCIPAL_CORE = Object.freeze([
  "read", "grep", "find", "ls", ASK_USER_QUESTION_TOOL_NAME, TOOLSET_NAME,
  "oma_mail_read", "oma_mail_send", "oma_goal_publish", "oma_society", "oma_agent_control", "oma_review_diff", "oma_review_respond",
]);
const PRINCIPAL_OPTIONAL = Object.freeze([
  "oma_mail_reply", "oma_operation_status", "lsp_status", "web_search", "source_check", "fetch_content", "get_search_content", MCP_PROXY_TOOL_NAME,
]);

export function residentToolSurfaceConfig(): ToolSurfaceConfig {
  return { defaultMode: "DISABLED", direct: WORKER_CORE, optional: WORKER_OPTIONAL, disabled: [] };
}
export function principalToolSurfaceConfig(): ToolSurfaceConfig {
  return { defaultMode: "DISABLED", direct: PRINCIPAL_CORE, optional: PRINCIPAL_OPTIONAL, disabled: [] };
}
export function encodedResidentToolSurface(): string {
  return encodeToolSurfacePlan(planToolSurface(residentToolSurfaceConfig()));
}
export function encodedPrincipalToolSurface(): string {
  return encodeToolSurfacePlan(planToolSurface(principalToolSurfaceConfig()));
}
export function encodeToolSurfacePlan(plan: ToolSurfacePlan): string {
  return JSON.stringify({ version: plan.version, defaultMode: plan.defaultMode, direct: plan.direct,
    optional: plan.optional, disabled: plan.disabled });
}
