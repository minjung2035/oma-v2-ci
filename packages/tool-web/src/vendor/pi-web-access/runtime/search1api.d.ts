import type { ExtractedContent, ExtractOptions } from "./extract.js";
import type { SearchOptions, SearchResponse } from "./perplexity.js";
interface Search1APISearchOptions extends SearchOptions {
    includeContent?: boolean;
}
export declare function isSearch1APIAvailable(): boolean;
export declare function searchWithSearch1API(query: string, options?: Search1APISearchOptions): Promise<SearchResponse>;
export declare function extractWithSearch1API(url: string, signal?: AbortSignal, options?: ExtractOptions): Promise<ExtractedContent | null>;
export {};
