import type { SearchOptions, SearchResponse } from "./perplexity.js";
export declare function isSerpBaseAvailable(): boolean;
export declare function searchWithSerpBase(query: string, options?: SearchOptions): Promise<SearchResponse>;
