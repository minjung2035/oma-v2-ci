import type { SearchOptions, SearchResponse } from "./perplexity.js";
export declare function isBochaAvailable(): boolean;
export declare function searchWithBocha(query: string, options?: SearchOptions): Promise<SearchResponse>;
