import type { SearchOptions, SearchResponse } from "./perplexity.js";
export declare function isBraveAvailable(): boolean;
export declare function searchWithBrave(query: string, options?: SearchOptions): Promise<SearchResponse>;
