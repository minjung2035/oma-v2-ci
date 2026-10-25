import type { McpExtensionState } from "./state.js";
export declare const FAILURE_BACKOFF_MS: number;
export declare function getFailureAgeSeconds(state: McpExtensionState, serverName: string): number | null;
export declare function getFailureMessage(state: McpExtensionState, serverName: string): string | null;
/** "failed 12s ago: <reason>" for agent-facing text, or null outside the backoff window. */
export declare function describeFailure(state: McpExtensionState, serverName: string): string | null;
export declare function isServerInActiveFailureBackoff(state: McpExtensionState, serverName: string): boolean;
