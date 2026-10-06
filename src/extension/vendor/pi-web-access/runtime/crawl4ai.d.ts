import type { ExtractedContent, ExtractOptions } from "./extract.js";
import { type SsrfConfig } from "./ssrf-protection.js";
export interface Crawl4aiExtractOptions extends Pick<ExtractOptions, "timeoutMs" | "lookup"> {
    ssrf?: SsrfConfig;
}
export declare function clearCrawl4aiConfigCache(): void;
export declare function isCrawl4aiAvailable(): boolean;
export declare function extractWithCrawl4ai(url: string, signal?: AbortSignal, options?: Crawl4aiExtractOptions): Promise<ExtractedContent | null>;
