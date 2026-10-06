import type { SearchOptions, SearchResponse } from "./perplexity.js";
interface SearchinfinitySearchOptions extends SearchOptions {
    includeContent?: boolean;
}
export declare function isSearchinfinityAvailable(): boolean;
export declare function searchWithSearchinfinity(query: string, options?: SearchinfinitySearchOptions): Promise<SearchResponse>;
export {};
