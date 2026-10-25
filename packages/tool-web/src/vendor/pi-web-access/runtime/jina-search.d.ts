import type { SearchOptions, SearchResponse } from "./perplexity.js";
interface JinaSearchOptions extends SearchOptions {
    includeContent?: boolean;
}
export declare function isJinaSearchAvailable(): boolean;
export declare function searchWithJina(query: string, options?: JinaSearchOptions): Promise<SearchResponse>;
export {};
