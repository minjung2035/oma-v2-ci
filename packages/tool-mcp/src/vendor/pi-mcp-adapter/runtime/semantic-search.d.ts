import type { JevEvaluateInput, JevEvaluationEnvelope } from "./jev-contracts.js";
import { type RankedToolMatch } from "./search-ranking.js";
import type { McpExtensionState } from "./state.js";
export type SemanticSearchEvaluator = (state: McpExtensionState, input: JevEvaluateInput, options: {
    purpose: "semantic-search";
    signal?: AbortSignal;
    observedSources?: readonly string[];
}) => Promise<JevEvaluationEnvelope>;
export type SemanticSearchBackend = {
    requested: "semantic";
    used: "semantic";
    degraded: false;
    model: string;
    usage: {
        inputTokens: number;
        outputTokens: number;
    };
    abstained: boolean;
} | {
    requested: "semantic";
    used: "lexical";
    degraded: true;
    reason: "timeout" | "rate_limited" | "service_unavailable";
};
export type SemanticSearchResult = {
    ok: true;
    matches: RankedToolMatch[];
    backend: SemanticSearchBackend;
} | {
    ok: false;
    error: {
        code: string;
        message: string;
    };
};
export declare function semanticSearch(state: McpExtensionState, query: string, server?: string, signal?: AbortSignal, evaluator?: SemanticSearchEvaluator, observedSources?: readonly string[]): Promise<SemanticSearchResult>;
