import type { SearchOptions, SearchResponse } from "./perplexity.js";
export declare function isSerpApiAvailable(): boolean;
export declare function searchWithSerpApi(query: string, options?: SearchOptions): Promise<SearchResponse>;
