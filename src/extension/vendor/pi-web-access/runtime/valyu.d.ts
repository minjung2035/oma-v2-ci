import type { SearchOptions, SearchResponse } from "./perplexity.js";
export declare function isValyuAvailable(): boolean;
export declare function searchWithValyu(query: string, options?: SearchOptions & {
    includeContent?: boolean;
}): Promise<SearchResponse>;
