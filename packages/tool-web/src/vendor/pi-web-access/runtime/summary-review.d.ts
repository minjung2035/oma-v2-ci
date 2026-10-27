import type { complete } from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { QueryResultData } from "./storage.js";
type CompleteFunction = typeof complete;
export declare const SUMMARY_GENERATION_DEADLINE_MS = 30000;
export interface SummaryMeta {
    model: string | null;
    durationMs: number;
    tokenEstimate: number;
    fallbackUsed: boolean;
    fallbackReason?: string;
    phase?: "summary-model" | "deterministic-fallback";
    edited?: boolean;
}
export type SummaryGenerationContext = Pick<ExtensionContext, "model" | "modelRegistry" | "sessionManager" | "scopedModels">;
export declare function buildSummaryPrompt(results: QueryResultData[], feedback?: string, instructions?: string): string;
export declare function buildDeterministicSummary(results: QueryResultData[]): {
    summary: string;
    meta: SummaryMeta;
};
export declare function generateSummaryDraft(results: QueryResultData[], ctx: SummaryGenerationContext, signal?: AbortSignal, modelOverride?: string, feedback?: string, completeFn?: CompleteFunction, deadlineMs?: number, instructions?: string): Promise<{
    summary: string;
    meta: SummaryMeta;
}>;
export {};
