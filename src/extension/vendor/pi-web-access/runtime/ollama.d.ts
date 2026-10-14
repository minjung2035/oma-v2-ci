import type { ExtractedContent, ExtractOptions } from "./extract.js";
import type { SearchOptions, SearchResponse } from "./perplexity.js";
import { type SsrfConfig } from "./ssrf-protection.js";
interface OllamaSearchOptions extends SearchOptions {
    includeContent?: boolean;
}
export interface OllamaExtractOptions extends Pick<ExtractOptions, "timeoutMs" | "lookup"> {
    ssrf?: SsrfConfig;
}
export declare function isOllamaAvailable(): boolean;
export declare function searchWithOllama(query: string, options?: OllamaSearchOptions): Promise<SearchResponse>;
export declare function isOllamaFetchAvailable(): boolean;
export declare function extractWithOllama(url: string, signal?: AbortSignal, options?: OllamaExtractOptions): Promise<ExtractedContent | null>;
export {};
