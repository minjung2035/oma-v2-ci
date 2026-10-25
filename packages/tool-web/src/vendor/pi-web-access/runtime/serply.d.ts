import type { SearchOptions, SearchResponse } from "./perplexity.js";
export declare function isSerplyAvailable(): boolean;
export declare function searchWithSerply(query: string, options?: SearchOptions): Promise<SearchResponse>;
