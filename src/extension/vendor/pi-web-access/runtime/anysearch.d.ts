import type { SearchOptions, SearchResponse } from "./perplexity.js";
interface AnySearchSearchOptions extends SearchOptions {
    includeContent?: boolean;
}
export declare function isAnySearchAvailable(): boolean;
export declare function searchWithAnySearch(query: string, options?: AnySearchSearchOptions): Promise<SearchResponse>;
export {};
