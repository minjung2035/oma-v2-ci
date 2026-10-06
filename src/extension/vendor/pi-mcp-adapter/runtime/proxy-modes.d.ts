import type { AgentToolResult, ToolInfo } from "@earendil-works/pi-coding-agent";
import type { McpExtensionState } from "./state.js";
import type { ToolMetadata } from "./types.js";
import { type RankedToolMatch } from "./search-ranking.js";
import { type SemanticSearchBackend, type SemanticSearchEvaluator } from "./semantic-search.js";
type ProxyToolResult = AgentToolResult<Record<string, unknown>>;
export declare function executeUiMessages(state: McpExtensionState): ProxyToolResult;
export declare function executeStatus(state: McpExtensionState): ProxyToolResult;
export declare function executeAuthStart(state: McpExtensionState, serverName: string, signal?: AbortSignal): Promise<ProxyToolResult>;
export declare function executeAuthComplete(state: McpExtensionState, serverName: string, input: string, signal?: AbortSignal): Promise<ProxyToolResult>;
export declare function resolveDescribeTarget(state: McpExtensionState, toolName: string, serverOverride?: string): {
    server: string;
    tool: ToolMetadata;
} | {
    error: ProxyToolResult;
};
export declare function executeDescribe(state: McpExtensionState, toolName: string, serverOverride?: string): ProxyToolResult;
export interface ToolSearchInput {
    query: string;
    regex?: boolean | undefined;
    server?: string | undefined;
    searchMode?: unknown;
    signal?: AbortSignal | undefined;
    semanticEvaluator?: SemanticSearchEvaluator | undefined;
    observedSources?: readonly string[];
}
/** Ranked matches, unpaginated; each surface pages and renders them its own way. */
export type ToolSearchOutcome = {
    matches: RankedToolMatch[];
    backend?: SemanticSearchBackend;
} | {
    error: ProxyToolResult;
};
export declare function findTools(state: McpExtensionState, input: ToolSearchInput): ToolSearchOutcome | Promise<ToolSearchOutcome>;
export declare function executeSearch(state: McpExtensionState, query: string, regex?: boolean, server?: string, includeSchemas?: boolean, limit?: number, offset?: number, searchMode?: "lexical" | "semantic", signal?: AbortSignal, semanticEvaluator?: SemanticSearchEvaluator): ProxyToolResult | Promise<ProxyToolResult>;
export declare function executeList(state: McpExtensionState, server: string): ProxyToolResult;
export declare function executeInstructions(state: McpExtensionState, server: string): ProxyToolResult;
export declare function executeConnect(state: McpExtensionState, serverName: string, signal?: AbortSignal): Promise<ProxyToolResult>;
/** Whether executeCall without a server resolves this exact displayed tool name to serverName (its first, exact-name lookup). */
export declare function unscopedCallReachesServer(state: McpExtensionState, toolName: string, serverName: string): boolean;
export declare function executeCall(state: McpExtensionState, toolName: string, args?: Record<string, unknown>, serverOverride?: string, getPiTools?: () => ToolInfo[], signal?: AbortSignal, origin?: "proxy" | "script", internalDelivery?: {
    onSuccess: (data: unknown) => void;
}, toolCallId?: string): Promise<ProxyToolResult>;
export {};
