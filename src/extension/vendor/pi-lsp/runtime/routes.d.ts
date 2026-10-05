import type { LspServerAdapter } from "./types.js";
export type LspAction = "diagnostics" | "fix";
export interface DiagnosticRoute {
    adapter: LspServerAdapter;
    reason: string;
    files: string[];
}
export interface SingleFileRoute {
    adapter: LspServerAdapter;
    reason: string;
}
export interface DiagnosticRouteParams {
    root?: string;
    paths?: string[];
    limit?: number;
    server?: string | string[];
}
export interface SingleFileRouteParams {
    root?: string;
    path: string;
    server?: string;
}
export declare const SUPPORTED_SERVER_DESCRIPTION = "Supported LSP servers are defined by pi-lsp config and selected by file extension.";
export declare function selectDiagnosticRoutes(adapters: LspServerAdapter[], params: DiagnosticRouteParams, defaultLimit: number): {
    root: string;
    routes: {
        adapter: LspServerAdapter;
        reason: string;
        files: string[];
    }[];
    skipped: DiagnosticRoute[];
};
export declare function selectFixRoute(adapters: LspServerAdapter[], params: SingleFileRouteParams): {
    root: string;
    route: {
        adapter: LspServerAdapter;
        reason: string;
    };
};
