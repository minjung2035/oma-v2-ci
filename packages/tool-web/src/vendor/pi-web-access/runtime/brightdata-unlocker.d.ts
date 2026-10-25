import type { ExtractedContent, ExtractOptions } from "./extract.js";
export interface BrightDataSsrfOptions {
    allowRanges: string[];
    trustEnvProxy: boolean;
}
export interface BrightDataExtractOptions extends Pick<ExtractOptions, "timeoutMs" | "lookup"> {
    ssrf?: BrightDataSsrfOptions;
}
export declare function clearBrightDataUnlockerConfigCache(): void;
export declare function isBrightDataUnlockerAvailable(): boolean;
export declare function extractWithBrightDataUnlocker(url: string, signal?: AbortSignal, options?: BrightDataExtractOptions): Promise<ExtractedContent | null>;
