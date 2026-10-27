import type { SearchOptions, SearchResponse } from "./perplexity.js";
interface TavilySearchOptions extends SearchOptions {
    includeContent?: boolean;
}
export declare function isTavilyAvailable(): boolean;
export declare function searchWithTavily(query: string, options?: TavilySearchOptions): Promise<SearchResponse>;
export {};
