import type { SearchOptions, SearchResponse } from "./perplexity.js";
export declare function isXcrawlAvailable(): boolean;
export declare function searchWithXCrawl(query: string, options?: SearchOptions): Promise<SearchResponse>;
