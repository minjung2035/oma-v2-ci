import type { SearchOptions, SearchResponse } from "./perplexity.js";
export declare function isYouAvailable(): boolean;
export declare function searchWithYou(query: string, options?: SearchOptions): Promise<SearchResponse>;
