import type { AgentToolResult, ExtensionAPI, ToolInfo } from "@earendil-works/pi-coding-agent";
import type { McpExtensionState } from "./state.js";
import { type McpConfig } from "./types.js";
import { type MetadataCache } from "./metadata-cache.js";
import { type McpToolRenderOptions } from "./tool-result-renderer.js";
export { namespaceProxyName } from "./mcp-references.js";
import { type DirectToolSelectorOverride } from "./mcp-references.js";
/**
 * Namespace-proxy tool registration for proxy-only MCP servers.
 *
 * For each configured proxy-only server (no `directTools: true` and not a
 * runtime server forced direct), register exactly one tool named
 * `mcp__<server>` (matching the harness `_shared/mcp-tools` resolver's
 * `namespaceProxyName`). Its execute accepts `{tool, args}` and forwards
 * through the adapter's existing `executeCall`, so it inherits the same
 * auto-auth, session recovery, output guard, and approval rules as the
 * single `mcp` proxy tool — without polluting the prompt with one entry
 * per tool.
 *
 * This unblocks `mcp:<server>` references from `tool-groups` and
 * `slow-mode` against proxy-only servers without flipping `directTools: true`.
 */
export interface NamespaceProxySpec {
    serverName: string;
    toolName: string;
    description: string;
}
/**
 * Lazily-required reference to the agent state — passed as a closure so the
 * namespace proxy tool's execute can call `executeCall` once `state` exists.
 * `getInitPromise` lets the executor await the first initialization round
 * the same way `createDirectToolExecutor` does.
 */
export type GetState = () => McpExtensionState | null;
export type GetInitPromise = () => Promise<McpExtensionState> | null;
export type GetPiTools = () => ToolInfo[];
export type EnsureNamespaceRuntime = (ctx: unknown) => Promise<McpExtensionState | null>;
export type ExecuteNamespaceCall = (state: McpExtensionState, toolName: string, args: Record<string, unknown>, serverName: string, getPiTools: GetPiTools, signal: AbortSignal | undefined, origin: "proxy", internalDelivery: undefined, toolCallId: string) => Promise<AgentToolResult<Record<string, unknown>>>;
export interface SyncNamespaceProxyToolsInput {
    config: McpConfig | null;
    cache: MetadataCache | null;
    envOverride: DirectToolSelectorOverride | null;
    existingDirectNames: Set<string>;
    activeDirectNames?: ReadonlySet<string>;
    existingNamespaceNames: Set<string>;
    unavailableServers?: ReadonlySet<string>;
    fallbackDeactivatedNames?: Set<string>;
    pi: ExtensionAPI;
    getState: GetState;
    getInitPromise: GetInitPromise;
    ensureRuntime?: EnsureNamespaceRuntime;
    executeCall?: ExecuteNamespaceCall;
    getPiTools: GetPiTools;
    renderOptions?: McpToolRenderOptions;
    renderShell?: "self" | "default";
    renderResult?: unknown;
    guardReentrant?: () => void;
    onToolRegistered?: (name: string) => void;
}
export interface SyncNamespaceProxyToolsResult {
    specs: NamespaceProxySpec[];
    added: string[];
    updated: string[];
    deactivated: string[];
}
/**
 * Idempotent sync of namespace-proxy tool registrations.
 */
export declare function syncNamespaceProxyTools(input: SyncNamespaceProxyToolsInput): SyncNamespaceProxyToolsResult;
