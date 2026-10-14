import type { ExtractedContent, ExtractOptions } from "./extract.js";
import type { SearchOptions, SearchResponse } from "./perplexity.js";
interface TinyFishSearchOptions extends SearchOptions {
    includeContent?: boolean;
}
export declare function clearTinyFishConfigCache(): void;
export declare function isTinyFishAvailable(): boolean;
export declare function searchWithTinyFish(query: string, options?: TinyFishSearchOptions): Promise<SearchResponse>;
export declare function extractWithTinyFish(url: string, signal?: AbortSignal, options?: ExtractOptions): Promise<ExtractedContent | null>;
export {};
