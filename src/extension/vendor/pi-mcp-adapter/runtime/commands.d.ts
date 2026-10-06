import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { McpExtensionState } from "./state.js";
import { type McpAuthResult, type McpConfig } from "./types.js";
import { type SharedConfigTarget } from "./config.js";
import { type McpOAuthRuntime } from "./mcp-auth-flow.js";
export declare function editSharedConfig(ctx: ExtensionContext, target: SharedConfigTarget): Promise<boolean>;
export declare function setupJevSemanticSearch(state: McpExtensionState, ctx: ExtensionContext, configOverridePath?: string): Promise<boolean>;
export declare function showStatus(state: McpExtensionState, ctx: ExtensionContext): Promise<void>;
export declare function showPrompts(state: McpExtensionState, ctx: ExtensionContext): Promise<void>;
export declare function showTools(state: McpExtensionState, ctx: ExtensionContext): Promise<void>;
export declare function reconnectServer(state: McpExtensionState, ctx: ExtensionContext, name: string): Promise<boolean>;
export declare function reconnectServers(state: McpExtensionState, ctx: ExtensionContext, targetServer?: string): Promise<void>;
export declare function authenticateServer(serverName: string, config: McpConfig, ctx: ExtensionContext, signal?: AbortSignal, runtime?: McpOAuthRuntime): Promise<McpAuthResult>;
export declare function logoutServer(serverName: string, state: McpExtensionState, ctx: ExtensionContext): Promise<{
    ok: boolean;
    message: string;
}>;
export declare function manageBearerToken(action: "set" | "remove" | "status", serverName: string, state: McpExtensionState, ctx: ExtensionContext): Promise<{
    ok: boolean;
    message: string;
}>;
export interface PanelFlowResult {
    configChanged: boolean;
}
export declare function openMcpSetup(state: McpExtensionState, pi: ExtensionAPI, ctx: ExtensionContext, configOverridePath?: string, mode?: "empty" | "setup", options?: {
    includeHostConfigs?: boolean;
}): Promise<PanelFlowResult>;
export declare function openMcpPanel(state: McpExtensionState, pi: ExtensionAPI, ctx: ExtensionContext, configOverridePath?: string, onDirectToolsConfigChanged?: (changes: Map<string, true | string[] | false>) => void | Promise<void>): Promise<PanelFlowResult>;
export declare function openMcpAuthPanel(state: McpExtensionState, pi: ExtensionAPI, ctx: ExtensionContext, configOverridePath?: string): Promise<PanelFlowResult>;
