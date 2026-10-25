import type { McpExtensionState } from "./state.js";
import { type McpStatusEventBus, type McpStatusSnapshot } from "./types.js";
/** Build a sanitized snapshot without connecting or querying any MCP server. */
export declare function createMcpStatusSnapshot(state: McpExtensionState): McpStatusSnapshot;
export declare function publishMcpStatusSnapshot(state: McpExtensionState, snapshot?: McpStatusSnapshot): void;
export declare function publishMcpStatusShutdown(events: McpStatusEventBus | undefined): void;
export type { McpServerStatusSnapshot, McpStatusSnapshot } from "./types.js";
export { MCP_STATUS_EVENT, MCP_STATUS_SNAPSHOT_VERSION } from "./types.js";
