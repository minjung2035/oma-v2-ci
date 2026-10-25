import type { SearchOptions, SearchResponse } from "./perplexity.js";
export declare function isZaiAvailable(): boolean;
export declare function searchWithZai(query: string, options?: SearchOptions): Promise<SearchResponse>;
