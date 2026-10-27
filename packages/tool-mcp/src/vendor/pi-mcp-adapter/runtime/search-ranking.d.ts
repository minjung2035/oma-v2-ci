import type { McpExtensionState } from "./state.js";
import type { ServerEntry, ToolMetadata, ToolPrefix } from "./types.js";
export interface RankedToolMatch {
    server: string;
    tool: ToolMetadata;
    score: number;
}
/**
 * Resolve the configured searchKeywords entries that apply to a tool.
 * Keys match by original name, prefixed name, or glob — the same candidate
 * set includeTools/excludeTools use — and all matching entries are unioned.
 */
export declare function resolveSearchKeywords(definition: ServerEntry | undefined, toolOriginalName: string, serverName: string, globalPrefix: ToolPrefix): string[];
export declare function normalizeSearchText(value: string): string;
export declare function tokenize(value: string): string[];
export declare function scoreToolMatch(tool: ToolMetadata, server: string, query: string, keywords?: string[]): number | null;
export declare function rankToolMatches(state: McpExtensionState, query: string, server?: string, includeKeywords?: boolean): RankedToolMatch[];
export declare function paginate<T>(items: T[], offset: number, limit: number): {
    items: T[];
    total: number;
    hasMore: boolean;
    nextOffset: number | null;
};
export declare function rankSuggestions(state: McpExtensionState, name: string, limit: number, server?: string): string[];
