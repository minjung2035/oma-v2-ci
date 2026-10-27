import http from "node:http";
import type { ProviderAvailability } from "./gemini-search.js";
import type { SummaryMeta } from "./summary-review.js";
export interface CuratorServerOptions {
    queries: string[];
    /** First index available to searches added while initial results are still streaming. */
    initialResultIndexCapacity?: number;
    sessionToken: string;
    timeout: number;
    availableProviders: ProviderAvailability;
    defaultProvider: string;
    searchProvider: string;
    summaryModels: Array<{
        value: string;
        label: string;
    }>;
    defaultSummaryModel: string | null;
}
export interface CuratorSearchEntry {
    answer: string;
    results: Array<{
        title: string;
        url: string;
        domain: string;
        snippet?: string;
    }>;
    provider: string;
    error?: string;
}
export interface IndexedCuratorSearchEntry extends CuratorSearchEntry {
    queryIndex: number;
    query: string;
}
export interface CuratorServerCallbacks {
    onSubmit: (payload: {
        selectedQueryIndices: number[];
        summary?: string;
        summaryMeta?: SummaryMeta;
        rawResults?: boolean;
        autoApproveRemainingSearches?: boolean;
    }) => void;
    onCancel: (reason: "user" | "timeout" | "stale") => void;
    onProviderChange: (provider: string) => void;
    onAddSearch: (query: string, provider?: string) => Promise<CuratorSearchEntry[]>;
    onAddSearchResults: (entries: IndexedCuratorSearchEntry[]) => void;
    onSummarize: (selectedQueryIndices: number[], signal: AbortSignal, model?: string, feedback?: string) => Promise<{
        summary: string;
        meta: SummaryMeta;
    }>;
    onRewriteQuery: (query: string, signal: AbortSignal) => Promise<string>;
}
export interface CuratorServerHandle {
    server: http.Server;
    url: string;
    close: () => void;
    pushResult: (queryIndex: number, data: CuratorSearchEntry & {
        query?: string;
        slotIndex?: number;
    }) => void;
    pushError: (queryIndex: number, error: string, provider?: string, meta?: {
        query?: string;
        slotIndex?: number;
    }) => void;
    searchesDone: () => void;
    /** Reports browser connection state so a cancelled search can surface WHY it
     * went stale (e.g. the browser never connected). */
    getConnectionState: () => {
        browserConnected: boolean;
        lastHeartbeatAgeMs: number;
    };
}
export declare function startCuratorServer(options: CuratorServerOptions, callbacks: CuratorServerCallbacks): Promise<CuratorServerHandle>;
