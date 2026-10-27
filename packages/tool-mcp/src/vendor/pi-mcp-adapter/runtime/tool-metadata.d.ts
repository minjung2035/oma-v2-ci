import type { McpExtensionState } from "./state.js";
import type { ToolMetadata, McpTool, McpResource, ServerEntry, ToolPrefix } from "./types.js";
export declare function buildToolMetadata(tools: McpTool[], resources: McpResource[], definition: ServerEntry, serverName: string, prefix: ToolPrefix, configuredServers?: Record<string, ServerEntry>, knownMetadata?: Map<string, ToolMetadata[]>, includeMissingConfiguredCandidates?: boolean): {
    metadata: ToolMetadata[];
    failedTools: string[];
};
export declare function getToolNames(state: McpExtensionState, serverName: string): string[];
export declare function totalToolCount(state: McpExtensionState): number;
export declare function findToolByName(metadata: ToolMetadata[] | undefined, toolName: string): ToolMetadata | undefined;
/** Whether the schema formatter has field descriptions worth showing beside a compact shape. */
export declare function hasSchemaDescriptions(schema: unknown, includeRoot?: boolean): boolean;
export declare function formatSchema(schema: unknown, indent?: string): string;
