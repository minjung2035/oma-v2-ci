import type { LspServerAdapter, StatusContext } from "./types.js";
export declare const DEFAULT_FILE_LIMIT = 50;
export declare function runDiagnostics(adapter: LspServerAdapter, params: {
    root?: string;
    paths?: string[];
    limit?: number;
    files?: string[];
}, timeoutMs: number, signal: AbortSignal | undefined, ctx: StatusContext, statusKey: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
    details: unknown;
}>;
export declare function runFix(adapter: LspServerAdapter, params: {
    root?: string;
    path: string;
    kind?: string;
    write?: boolean;
}, timeoutMs: number, signal: AbortSignal | undefined, ctx: StatusContext, statusKey: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
    details: unknown;
}>;
export declare function clearStatus(ctx: StatusContext, statusKey: string): void;
export declare function textResult(text: string, details: unknown): {
    content: {
        type: "text";
        text: string;
    }[];
    details: unknown;
};
