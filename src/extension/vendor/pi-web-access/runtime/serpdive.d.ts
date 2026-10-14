import type { SearchOptions, SearchResponse } from "./perplexity.js";
interface SerpdiveSearchOptions extends SearchOptions {
    includeContent?: boolean;
}
export declare function isSerpdiveAvailable(): boolean;
export declare function searchWithSerpdive(query: string, options?: SerpdiveSearchOptions): Promise<SearchResponse>;
export {};
