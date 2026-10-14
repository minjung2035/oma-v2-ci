import type { ExtractedContent, ExtractOptions } from "./extract.js";
import type { SearchOptions, SearchResponse } from "./perplexity.js";
interface QueritSearchOptions extends SearchOptions {
    includeContent?: boolean;
}
export declare function isQueritAvailable(): boolean;
export declare function searchWithQuerit(query: string, options?: QueritSearchOptions): Promise<SearchResponse>;
export declare function extractWithQuerit(url: string, signal?: AbortSignal, options?: ExtractOptions): Promise<ExtractedContent | null>;
export {};
