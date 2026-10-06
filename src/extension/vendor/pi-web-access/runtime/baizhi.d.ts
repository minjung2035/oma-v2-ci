import type { SearchOptions, SearchResponse } from "./perplexity.js";
export declare function isBaizhiAvailable(): boolean;
export declare function searchWithBaizhi(query: string, options?: SearchOptions): Promise<SearchResponse>;
