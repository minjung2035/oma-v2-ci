import type { McpContent, ContentBlock } from "./types.js";
type McpResourceContent = {
    uri: string;
    text?: string | undefined;
    blob?: string | undefined;
    mimeType?: string | undefined;
    [key: string]: unknown;
};
export declare function cleanupMaterializedBinaryResources(scope?: object): void;
/**
 * Transform MCP content types to Pi content blocks.
 */
export declare function transformMcpResourceContents(contents: McpResourceContent[], scope?: object): ContentBlock[];
export declare function transformMcpContent(content: McpContent[], scope?: object): ContentBlock[];
/**
 * Resolve a tool result's content blocks, appending structuredContent when it
 * coexists with ordinary content and falling back to it when content is empty.
 */
export declare function resolveMcpResultContent(result: Record<string, unknown>, scope?: object): ContentBlock[];
export {};
