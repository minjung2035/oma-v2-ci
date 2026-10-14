import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { McpExtensionState } from "./state.js";
import { type McpAdapterOptions } from "./types.js";
import { type McpOAuthRuntime } from "./mcp-auth-flow.js";
import { type McpRuntimeOwner } from "./runtime-owner.js";
export { getFailureAgeSeconds, getFailureMessage } from "./failure-backoff.js";
export declare function clearFailure(state: McpExtensionState, serverName: string, restoredReason?: string): boolean;
export declare function recordFailure(state: McpExtensionState, serverName: string, message: string): void;
export declare function isTuiMode(ctx: Pick<ExtensionContext, "hasUI" | "mode">): boolean;
type McpInitializationOptions = McpAdapterOptions & {
    oauthRuntime?: McpOAuthRuntime;
    statusEvents?: McpExtensionState["statusEvents"];
    onProjectTrustResolved?: () => void;
    /** Load-time runs have no Pi context, so project trust is unknown; session_start decides later. */
    excludeProjectServers?: boolean;
};
export declare function initializeMcp(pi: ExtensionAPI, ctx: ExtensionContext, owner?: McpRuntimeOwner, options?: McpInitializationOptions): Promise<McpExtensionState>;
export declare function markKeepAliveAfterConnect(state: McpExtensionState, serverName: string): void;
export declare function updateServerMetadata(state: McpExtensionState, serverName: string): void;
export declare function updateMetadataCache(state: McpExtensionState, serverName: string): void;
export declare function notifyToolMetadataUpdated(state: McpExtensionState, serverName: string, reason: string): void;
export declare function flushMetadataCache(state: McpExtensionState): void;
export declare function updateStatusBar(state: McpExtensionState): void;
export declare function lazyConnect(state: McpExtensionState, serverName: string, signal?: AbortSignal): Promise<boolean>;
