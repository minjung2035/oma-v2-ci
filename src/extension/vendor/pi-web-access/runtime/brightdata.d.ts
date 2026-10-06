import type { SearchOptions, SearchResponse } from "./perplexity.js";
interface BrightDataSearchOptions extends SearchOptions {
    includeContent?: boolean;
}
export declare function isBrightDataAvailable(): boolean;
export declare function searchWithBrightData(query: string, options?: BrightDataSearchOptions): Promise<SearchResponse>;
export {};
