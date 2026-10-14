import type { ExtractedContent, ExtractOptions } from "./extract.js";
import type { SearchOptions, SearchResponse } from "./perplexity.js";
interface ParallelMcpSearchOptions extends SearchOptions {
    includeContent?: boolean;
}
export declare function isParallelMcpAvailable(): boolean;
export declare function searchWithParallelMcp(query: string, options?: ParallelMcpSearchOptions): Promise<SearchResponse>;
export declare function extractWithParallelMcp(url: string, signal?: AbortSignal, options?: ExtractOptions): Promise<ExtractedContent | null>;
export {};
