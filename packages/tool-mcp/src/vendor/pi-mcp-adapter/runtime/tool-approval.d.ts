import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { McpExtensionState } from "./state.js";
import { type McpConfig, type McpToolApprovalDecision, type McpToolApprovalOrigin, type ToolMetadata } from "./types.js";
export type ToolCallApprovalResult = {
    ok: true;
} | {
    ok: false;
    reason: "denied" | "approval_required_headless";
};
export declare function isToolCallApprovalRequired(config: McpConfig, serverName: string, toolMeta: Pick<ToolMetadata, "originalName" | "annotations" | "resourceUri">, toolMetadata?: ReadonlyMap<string, readonly ToolMetadata[]>): boolean;
/**
 * Returns "abstain" when no handler claims the request. A handler that throws
 * or returns an unknown value counts as "deny". Rethrows only when `signal` aborted.
 */
export declare function requestBrokerApproval(events: ExtensionAPI["events"] | undefined, serverName: string, toolMeta: Pick<ToolMetadata, "name" | "originalName">, args: Record<string, unknown> | undefined, origin: McpToolApprovalOrigin, signal?: AbortSignal): Promise<McpToolApprovalDecision>;
export declare function ensureToolCallApproved(state: McpExtensionState, serverName: string, toolMeta: ToolMetadata, args: Record<string, unknown> | undefined, signal?: AbortSignal, origin?: McpToolApprovalOrigin, approvalMetadata?: ReadonlyMap<string, readonly ToolMetadata[]>): Promise<ToolCallApprovalResult>;
