import type { ExtractedContent, ExtractOptions } from "./extract.js";
import type { SearchOptions, SearchResponse } from "./perplexity.js";
import { type SsrfConfig } from "./ssrf-protection.js";
interface KagiSearchOptions extends SearchOptions {
    includeContent?: boolean;
}
export interface KagiExtractOptions extends Pick<ExtractOptions, "timeoutMs" | "lookup"> {
    ssrf?: SsrfConfig;
}
export declare function isKagiAvailable(): boolean;
export declare function searchWithKagi(query: string, options?: KagiSearchOptions): Promise<SearchResponse>;
export declare function isKagiExtractAvailable(): boolean;
export declare function extractWithKagi(url: string, signal?: AbortSignal, options?: KagiExtractOptions): Promise<ExtractedContent | null>;
export {};
