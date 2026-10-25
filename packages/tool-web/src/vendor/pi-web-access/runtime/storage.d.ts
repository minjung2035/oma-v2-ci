import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ExtractedContent } from "./extract.js";
import type { SearchResult } from "./perplexity.js";
declare const FETCH_CACHE_VERSION = 1;
interface FetchCacheLimits {
    maxEntries: number;
    maxBytes: number;
}
export interface QueryResultData {
    query: string;
    answer: string;
    results: SearchResult[];
    error: string | null;
    provider?: string;
    providers?: string[];
}
interface FetchCacheRef {
    version: typeof FETCH_CACHE_VERSION;
    key: string;
    storedAt: number;
}
interface StoredFetchUrlMetadata {
    url: string;
    title: string;
    error: string | null;
    contentLength: number;
    mimeType?: string;
    status?: number;
    duration?: number;
}
export interface StoredSearchData {
    id: string;
    type: "search" | "fetch" | "research";
    timestamp: number;
    queries?: QueryResultData[];
    urls?: ExtractedContent[];
    artifact?: unknown;
    fetchCache?: FetchCacheRef;
    urlMetadata?: StoredFetchUrlMetadata[];
    fetchCacheError?: string;
}
export declare function generateId(): string;
export declare function getFetchCacheDir(): string;
export declare function pruneExpiredFetchCache(now?: number, requestedLimits?: Partial<FetchCacheLimits>): void;
export declare function storeResult(id: string, data: StoredSearchData): void;
export declare function storeFetchedContentResult(id: string, data: StoredSearchData & {
    type: "fetch";
    urls: ExtractedContent[];
}): StoredSearchData;
export declare function getResult(id: string): StoredSearchData | null;
export declare function getAllResults(): StoredSearchData[];
export declare function deleteResult(id: string): boolean;
export declare function clearResults(): void;
export declare function restoreFromSession(ctx: ExtensionContext): void;
export {};
