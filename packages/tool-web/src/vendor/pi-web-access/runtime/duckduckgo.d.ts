import type { SearchOptions, SearchResponse } from "./perplexity.js";
export declare function isDuckDuckGoAvailable(): boolean;
export declare function searchWithDuckDuckGo(query: string, options?: SearchOptions): Promise<SearchResponse>;
