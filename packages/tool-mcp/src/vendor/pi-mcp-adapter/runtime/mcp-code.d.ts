import type { ToolInfo } from "@earendil-works/pi-coding-agent";
import type { JevErrorCode, JevEvaluateInput, JevEvaluationEnvelope } from "./jev-contracts.js";
import type { SemanticSearchEvaluator } from "./semantic-search.js";
import type { McpExtensionState } from "./state.js";
import type { ContentBlock } from "./types.js";
export declare const DEFAULT_MCP_SCRIPT_TIMEOUT_MS = 30000;
export type McpScriptJevEvaluator = (state: McpExtensionState, input: JevEvaluateInput, options: {
    purpose: "script";
    signal?: AbortSignal;
    observedSources?: readonly string[];
}) => Promise<JevEvaluationEnvelope>;
export declare function runMcpScript(state: McpExtensionState, code: string, timeoutMs?: number, getPiTools?: () => ToolInfo[], signal?: AbortSignal, jevEvaluator?: McpScriptJevEvaluator, semanticEvaluator?: SemanticSearchEvaluator): Promise<{
    content: ContentBlock[];
    details: {
        calls?: ({
            operation: "call";
            path: string;
            ok: true;
            durationMs: number;
        } | {
            operation: "call";
            path: string;
            ok: false;
            error: string;
            durationMs: number;
        } | {
            operation: "search";
            query: string;
            ok: true;
            durationMs: number;
        } | {
            operation: "search";
            query: string;
            ok: false;
            error: string;
            durationMs: number;
        } | {
            operation: "describe";
            path: string;
            ok: true;
            durationMs: number;
        } | {
            operation: "describe";
            path: string;
            ok: false;
            error: string;
            durationMs: number;
        } | {
            operation: "evaluate";
            ok: true;
            model: string;
            inputTokens: number;
            outputTokens: number;
            durationMs: number;
        } | {
            operation: "evaluate";
            ok: false;
            error: JevErrorCode | "incomplete";
            durationMs: number;
        })[] | undefined;
        timeoutMs: number;
        error?: "aborted" | "timeout" | "script_error" | undefined;
        message?: string | undefined;
        mode: string;
    };
}>;
