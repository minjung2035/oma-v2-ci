import { type Lookup } from "./ssrf-protection.js";
import { type AuthFetchProfile } from "./auth-fetch.js";
export { loadSsrfConfig } from "./ssrf-protection.js";
export declare function loadSsrfAllowRanges(): string[];
/** Names of the search/fetch tools the caller has actually registered, so
 * failure guidance never points at tools that do not exist in the session. */
export interface RegisteredToolNames {
    webSearch?: string;
    fetchContent?: string;
}
export interface VideoFrame {
    data: string;
    mimeType: string;
    timestamp: string;
}
export type FrameData = {
    data: string;
    mimeType: string;
};
export type FrameResult = FrameData | {
    error: string;
};
export interface ExtractedContent {
    url: string;
    title: string;
    content: string;
    error: string | null;
    thumbnail?: {
        data: string;
        mimeType: string;
    };
    frames?: VideoFrame[];
    duration?: number;
    mimeType?: string;
    status?: number;
}
export interface ExtractOptions {
    timeoutMs?: number;
    forceClone?: boolean;
    prompt?: string;
    timestamp?: string;
    frames?: number;
    model?: string;
    mode?: "readable" | "raw" | "answer";
    answerModel?: string;
    authFetchProfile?: AuthFetchProfile;
    toolNames?: RegisteredToolNames;
    /** Optional HTTP(S) or SOCKS proxy URL; routed through the curl-backed transport. */
    proxy?: string;
    /** Custom DNS resolver used for SSRF validation. Primarily a test seam. */
    lookup?: Lookup;
}
/** Resolve the direct HTTP/Jina fetch budget, with a per-call override taking precedence. */
export declare function resolveFetchTimeoutMs(options?: Pick<ExtractOptions, "timeoutMs">): number;
export declare function extractContent(url: string, signal?: AbortSignal, options?: ExtractOptions): Promise<ExtractedContent>;
export declare function readPDFResponseBuffer(response: Response, maxSizeMB: number): Promise<ArrayBuffer>;
export declare function extractHeadingTitle(text: string): string | null;
export declare function fetchAllContent(urls: string[], signal?: AbortSignal, options?: ExtractOptions): Promise<ExtractedContent[]>;
