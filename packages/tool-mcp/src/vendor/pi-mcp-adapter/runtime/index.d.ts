import { type AgentToolResult, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type McpAdapterOptions, type ServerEntry } from "./types.js";
export type { McpAdapterOptions } from "./types.js";
export type { ServerEntry } from "./types.js";
export { namespaceProxyName, parseMcpReference, resolveMcpToolReferences, type McpReferenceResolution, type ParsedMcpReference, } from "./mcp-references.js";
export { MCP_STATUS_EVENT, MCP_STATUS_SNAPSHOT_VERSION, MCP_TOOL_APPROVAL_REQUEST_EVENT, type McpServerRuntimeStatus, type McpServerStatusSnapshot, type McpStatusSnapshot, type McpToolApprovalDecision, type McpToolApprovalHandler, type McpToolApprovalOrigin, type McpToolApprovalRequest, } from "./types.js";
export interface McpServerRegistration {
    dispose(): Promise<void>;
}
export declare const MCP_RUNTIME_REGISTER_EVENT: "pi-mcp-adapter:runtime-register:v1";
export declare const MCP_RUNTIME_REGISTER_VERSION: 1;
export declare const MCP_RUNTIME_SNAPSHOT_EVENT: "pi-mcp-adapter:runtime-snapshot:v1";
export declare const MCP_RUNTIME_SNAPSHOT_VERSION: 1;
export type McpRuntimeRegistrationResult = {
    ok: true;
    registration: McpServerRegistration;
} | {
    ok: false;
    error: Error;
};
export interface McpRuntimeRegistrationRequest {
    version: typeof MCP_RUNTIME_REGISTER_VERSION;
    name: string;
    definition: ServerEntry;
    result?: McpRuntimeRegistrationResult;
}
export interface McpRuntimeServerSnapshot {
    readonly name: string;
    readonly definition: ServerEntry;
    readonly runtime: true;
    readonly persisted: false;
}
export type McpRuntimeSnapshotResult = {
    ok: true;
    snapshot: McpRuntimeServerSnapshot;
} | {
    ok: false;
    error: Error;
};
export interface McpRuntimeSnapshotRequest {
    version: typeof MCP_RUNTIME_SNAPSHOT_VERSION;
    name: string;
    result?: McpRuntimeSnapshotResult;
}
export declare const MCP_RUNTIME_TOOL_CALL_EVENT: "pi-mcp-adapter:runtime-tool-call:v1";
export declare const MCP_RUNTIME_TOOL_CALL_VERSION: 1;
export type McpRuntimeToolCallResult = {
    ok: true;
    result: AgentToolResult<Record<string, unknown>>;
} | {
    ok: false;
    error: Error;
};
/** The adapter sets `result` to a promise during `emit()`; await it. */
export interface McpRuntimeToolCallRequest {
    version: typeof MCP_RUNTIME_TOOL_CALL_VERSION;
    /** Tool name as accepted by `mcp({ tool })`. */
    tool: string;
    args?: Record<string, unknown>;
    server?: string;
    result?: Promise<McpRuntimeToolCallResult>;
}
export declare function createMcpAdapter(options?: McpAdapterOptions): (pi: ExtensionAPI) => void;
/**
 * Register an MCP server with the adapter installed for this Pi instance.
 * Registrations are session/runtime scoped and never persisted. Duplicate
 * names fail closed. Registered servers are proxy-tool-only; their tools
 * become visible at the next tool sync. To change a definition, dispose the
 * registration and register again.
 */
export declare function registerMcpServer(options: {
    pi: ExtensionAPI;
    name: string;
    definition: ServerEntry;
}): McpServerRegistration;
/**
 * Return a detached, non-persisted snapshot of one runtime-registered MCP
 * server. Configured servers and runtime registrations shadowed by config are
 * never exported through this API.
 */
export declare function getRuntimeMcpServerSnapshot(options: {
    pi: ExtensionAPI;
    name: string;
}): McpRuntimeServerSnapshot;
declare const _default: (pi: ExtensionAPI) => void;
export default _default;
