import type { ExtractedContent, ExtractOptions } from "./extract.js";
import type { SearchOptions, SearchResponse } from "./perplexity.js";
export interface FirecrawlSsrfOptions {
    allowRanges: string[];
    trustEnvProxy: boolean;
}
export interface FirecrawlExtractOptions extends Pick<ExtractOptions, "timeoutMs" | "lookup"> {
    ssrf?: FirecrawlSsrfOptions;
}
interface FirecrawlSearchOptions extends SearchOptions, Pick<ExtractOptions, "timeoutMs" | "lookup"> {
    includeContent?: boolean;
    ssrf?: FirecrawlSsrfOptions;
}
export declare function clearFirecrawlConfigCache(): void;
export declare function isFirecrawlAvailable(): boolean;
export declare function searchWithFirecrawl(query: string, options?: FirecrawlSearchOptions): Promise<SearchResponse>;
export declare function extractWithFirecrawl(url: string, signal?: AbortSignal, options?: FirecrawlExtractOptions): Promise<ExtractedContent | null>;
export {};
