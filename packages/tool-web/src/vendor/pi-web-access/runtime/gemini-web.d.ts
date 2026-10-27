import { type BrowserCookieDiagnosticDetails, type CookieMap } from "./chrome-cookies.js";
export declare const DEFAULT_GEMINI_WEB_MODEL = "gemini-3.1-pro";
export declare function setGeminiFetchOverrideForTests(fetchImpl: typeof fetch | null): void;
export declare const GEMINI_MAX_HEADER_SIZE: number;
export declare function createGeminiFetch(undiciImpl: typeof import("undici")): typeof fetch;
export declare function resolveGeminiFetch(): Promise<typeof fetch>;
export interface GeminiWebOptions {
    youtubeUrl?: string;
    model?: string;
    files?: string[];
    signal?: AbortSignal;
    timeoutMs?: number;
}
export declare function isGeminiWebAvailable(chromeProfile?: string): Promise<CookieMap | null>;
export declare function getGeminiWebAvailabilityDiagnostic(): string | null;
export declare function getGeminiWebAvailabilityDiagnosticDetails(): BrowserCookieDiagnosticDetails | null;
export declare function getActiveGoogleEmail(cookies: CookieMap): Promise<string | null>;
export declare function queryWithCookies(prompt: string, cookieMap: CookieMap, options?: GeminiWebOptions): Promise<string>;
