import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ConsentManager } from "./consent-manager.js";
import type { McpLifecycleManager } from "./lifecycle.js";
import type { McpServerManager } from "./server-manager.js";
import type { AuthStorageOptions } from "./mcp-auth.js";
import type { ServerDefinition, ToolMetadata, PromptMetadata, ServerCacheEntry, McpConfig, UiSessionMessages, UiStreamSummary, McpStatusEventBus, UiServerHandle, ProjectServerBlock } from "./types.js";
import type { UiResourceHandler } from "./ui-resource-handler.js";
import type { McpRuntimeOwner } from "./runtime-owner.js";
import type { McpOAuthRuntime } from "./mcp-auth-flow.js";
import type { SessionApprovalWriter } from "./session-approvals.js";
import type { ObservedOutput } from "./output-shape.js";
export interface CompletedUiSession {
    serverName: string;
    toolName: string;
    completedAt: Date;
    reason: string;
    messages: UiSessionMessages;
    stream?: UiStreamSummary;
}
export type SendMessageFn = (message: {
    customType: string;
    content: Array<{
        type: "text";
        text: string;
    }>;
    display?: string;
    details?: unknown;
}, options?: {
    triggerTurn?: boolean;
}) => void;
export interface McpExtensionState {
    owner: McpRuntimeOwner;
    manager: McpServerManager;
    lifecycle: McpLifecycleManager;
    toolMetadata: Map<string, ToolMetadata[]>;
    sessionMetadata?: Map<string, ServerCacheEntry>;
    /** Number of tools currently registered directly with Pi, by server. */
    directToolCounts: Map<string, number>;
    /** Resource counts retained separately because tool metadata includes resource tools. */
    resourceCounts: Map<string, number>;
    promptMetadata: Map<string, PromptMetadata[]>;
    /** Servers whose prompt inventory came from successful live discovery. */
    promptMetadataLive: Set<string>;
    serverInstructions: Map<string, string>;
    config: McpConfig;
    programmaticConfig?: boolean;
    /** Session-scoped notices for legacy mcp.json files the adapter ignores. */
    migrationNotices?: string[];
    /** Install validations must not publish durable cache entries before config persistence. */
    provisionalInstalls?: Set<string>;
    oauthRuntime: McpOAuthRuntime;
    authStorageOptions: AuthStorageOptions;
    failureTracker: Map<string, number>;
    failureMessages: Map<string, string>;
    /** Session-only approvals keyed by server, tool definition, and arguments. */
    approvedToolCalls: Map<string, true>;
    /** Session-only output shapes learned from successful calls to tools without an outputSchema, by tool name.
     * Keyed by the server's config entry so a replaced or reconfigured server starts over. Never persisted. */
    observedOutputs?: WeakMap<ServerDefinition, Map<string, ObservedOutput>>;
    /** Configured project servers disabled by trust or approval policy for this session. */
    blockedProjectServers?: Map<string, ProjectServerBlock>;
    /** mcpScript is registered. Fixed when Pi loads the adapter, so a session's own config cannot change it. */
    scriptTool?: boolean;
    /** Runtime-only server grants. Never persisted or restored from session entries. */
    approvedServers?: Map<string, {
        definition: ServerDefinition;
        hash: string;
    }>;
    /** Optional active-session sink for approval decisions. */
    persistSessionApproval?: SessionApprovalWriter;
    /** Session manager used to reject stale session-tree contexts. */
    sessionManager?: ExtensionContext["sessionManager"];
    /** Shared event bus used by permission extensions to broker MCP approvals. */
    approvalEvents?: ExtensionAPI["events"];
    uiResourceHandler: UiResourceHandler;
    consentManager: ConsentManager;
    uiServer: UiServerHandle | null;
    completedUiSessions: CompletedUiSession[];
    openBrowser: (url: string) => Promise<void>;
    ui?: ExtensionContext["ui"];
    sendMessage?: SendMessageFn;
    onToolMetadataUpdated?: (serverName: string, reason: string) => void | Promise<void>;
    statusEvents?: McpStatusEventBus;
}
