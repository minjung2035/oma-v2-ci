import type { SearchOptions, SearchResponse } from "./perplexity.js";
export declare function isSearXNGAvailable(): boolean;
export declare function searchWithSearXNG(query: string, options?: SearchOptions): Promise<SearchResponse>;
