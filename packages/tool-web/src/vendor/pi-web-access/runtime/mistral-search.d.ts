import type { SearchOptions, SearchResponse } from "./perplexity.js";
export declare function isMistralAvailable(): boolean;
export declare function searchWithMistral(query: string, options?: SearchOptions): Promise<SearchResponse>;
