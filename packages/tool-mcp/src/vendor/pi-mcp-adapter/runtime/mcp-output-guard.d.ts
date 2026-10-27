import { type TruncationResult } from "@earendil-works/pi-coding-agent";
import type { ContentBlock, McpSettings } from "./types.js";
export declare const DEFAULT_MCP_OUTPUT_MAX_BYTES: number;
export declare const DEFAULT_MCP_OUTPUT_MAX_LINES = 2000;
export declare const DEFAULT_MCP_DETAILS_MAX_BYTES: number;
export interface McpOutputGuardDetails {
    truncated: true;
    originalBytes: number;
    returnedBytes: number;
    originalLines: number;
    returnedLines: number;
    /** Host truncation classification and preview counts for the composed text before the MCP notice is added. */
    truncatedBy: TruncationResult["truncatedBy"];
    totalLines: number;
    totalBytes: number;
    outputLines: number;
    outputBytes: number;
    lastLinePartial: boolean;
    firstLineExceedsLimit: boolean;
    maxLines: number;
    maxBytes: number;
    /** Number of image content blocks returned untouched alongside the truncated text. */
    imageBlocksPassedThrough?: number;
    fullOutputPath?: string;
    writeError?: string;
}
export interface McpResultSummary {
    omitted: true;
    reason: string;
    isError: boolean;
    contentBlocks: number;
    contentSummary: Array<Record<string, unknown>>;
    structuredContent?: Record<string, unknown>;
    meta?: Record<string, unknown>;
    extraFields?: Array<Record<string, unknown>>;
    rawResultBytes: number;
    fullResultPath?: string;
    resultWriteError?: string;
}
export interface McpOutputGuardOptions {
    enabled?: boolean;
    prefix?: string;
    suffix?: string;
    /** Optional guidance appended when it fits the output limits. */
    footer?: string;
    emptyTextFallback?: string;
    maxBytes?: number;
    maxLines?: number;
    detailsMaxBytes?: number;
    /**
     * Raw MCP result to expose as details.mcpResult. Kept raw when its JSON
     * fits detailsMaxBytes (or when the guard is disabled); otherwise replaced
     * with a compact summary and spilled to a temp file. Omit for call sites
     * whose details never carried the raw result (e.g. direct tools).
     */
    rawMcpResult?: unknown;
}
export interface GuardedMcpOutput {
    content: ContentBlock[];
    outputGuard?: McpOutputGuardDetails;
    mcpResult?: unknown;
}
export declare function resolveMcpOutputGuardOptions(settings?: McpSettings): Pick<McpOutputGuardOptions, "enabled" | "maxBytes" | "maxLines" | "detailsMaxBytes">;
/**
 * Models retype large results into the next call's arguments unless told otherwise at the moment
 * they see the result; the same wording in tool descriptions did not change that.
 */
export declare function scriptPipeHint(scriptTool: boolean | undefined, content: ContentBlock[]): {
    footer?: string;
};
/** Spread helper for tool-result details: includes mcpResult/outputGuard only when present. */
export declare function guardedMcpDetails(guarded: GuardedMcpOutput): Record<string, unknown>;
/**
 * Bound model-facing MCP output. Text output is capped at maxBytes/maxLines and
 * spilled to a temp file when oversized. Image blocks pass through untouched —
 * they are delivered to the provider as native image content, not text context.
 */
export declare function guardMcpOutput(content: ContentBlock[], options?: McpOutputGuardOptions): Promise<GuardedMcpOutput>;
