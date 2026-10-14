import type { AgentToolResult, AgentToolUpdateCallback, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { McpExtensionState } from "./state.js";
import type { DirectToolSpec } from "./types.js";
export { DIRECT_TOOLS_ADVISORY_THRESHOLD, buildProxyDescription, getLargeDirectToolsAdvisory, getMissingConfiguredDirectToolServers, prepareDirectToolArguments, resolveDirectTools, } from "./direct-tool-surface.js";
type DirectToolExecute = (toolCallId: string, params: Record<string, unknown>, signal: AbortSignal | undefined, onUpdate: AgentToolUpdateCallback<Record<string, unknown>> | undefined, ctx: ExtensionContext) => Promise<AgentToolResult<Record<string, unknown>>>;
export declare function createDirectToolExecutor(getState: () => McpExtensionState | null, getInitPromise: () => Promise<McpExtensionState> | null, spec: DirectToolSpec, structured?: boolean): DirectToolExecute;
