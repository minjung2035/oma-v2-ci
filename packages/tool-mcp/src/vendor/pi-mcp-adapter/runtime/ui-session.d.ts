import { type CallToolResult } from "@modelcontextprotocol/client";
import type { McpExtensionState } from "./state.js";
import { type UiStreamMode } from "./types.js";
import type { SessionRecoveryDeps } from "./session-recovery.js";
export interface UiSessionRequest {
    serverName: string;
    toolName: string;
    toolArgs: Record<string, unknown>;
    uiResourceUri: string;
    streamMode?: UiStreamMode;
    signal?: AbortSignal;
    onNeedsAuth?: SessionRecoveryDeps["onNeedsAuth"];
}
export type UiSessionViewer = "browser" | "glimpse" | "orca" | "suppressed";
export interface UiSessionRuntime {
    serverName: string;
    toolName: string;
    reused: boolean;
    streamId?: string;
    streamToken?: string;
    streamMode?: UiStreamMode;
    requestMeta?: Record<string, unknown>;
    url: string;
    viewer: UiSessionViewer;
    windowOpen: boolean;
    isActive: () => boolean;
    sendToolResult: (result: CallToolResult) => void;
    sendResultPatch: (result: CallToolResult) => void;
    sendToolCancelled: (reason: string) => void;
    close: (reason?: string) => void;
}
export interface UiSessionResultSummary {
    message: string;
    uiOpen: boolean;
    uiViewer?: UiSessionViewer;
    uiUrl?: string;
}
export declare function summarizeUiSessionResult(uiSession: UiSessionRuntime | null): UiSessionResultSummary;
export declare function maybeStartUiSession(state: McpExtensionState, request: UiSessionRequest): Promise<UiSessionRuntime | null>;
