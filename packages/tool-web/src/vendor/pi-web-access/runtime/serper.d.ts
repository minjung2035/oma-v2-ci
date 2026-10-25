import type { SearchOptions, SearchResponse } from "./perplexity.js";
export declare function isSerperAvailable(): boolean;
export declare function searchWithSerper(query: string, options?: SearchOptions): Promise<SearchResponse>;
