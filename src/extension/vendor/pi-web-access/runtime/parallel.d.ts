import type { ExtractedContent, ExtractOptions } from "./extract.js";
import type { SearchOptions, SearchResponse } from "./perplexity.js";
interface ParallelSearchOptions extends SearchOptions {
    includeContent?: boolean;
}
export declare function clearParallelConfigCache(): void;
export declare function resolveParallelApiKey(signal?: AbortSignal): Promise<string | null>;
export declare function hasParallelApiKey(): boolean;
export declare function isParallelAvailable(): boolean;
export declare function searchWithParallel(query: string, options?: ParallelSearchOptions): Promise<SearchResponse>;
export declare function extractWithParallel(url: string, signal?: AbortSignal, options?: ExtractOptions): Promise<ExtractedContent | null>;
export {};
