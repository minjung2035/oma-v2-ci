import type { CodeAction, LspDiagnostic, LspServerAdapter, ServerCommand } from "./types.js";
export declare function resolveSpawnCommand(command: ServerCommand, platform?: NodeJS.Platform, comSpec?: string | undefined): ServerCommand;
export declare class LspClient {
    #private;
    constructor(adapter: LspServerAdapter, command: ServerCommand, cwd: string, timeoutMs: number);
    start(): Promise<void>;
    initialize(root: string): Promise<void>;
    didOpen(uri: string, text: string, languageId: string): void;
    didClose(uri: string): boolean;
    diagnostics(uri: string): Promise<LspDiagnostic[]>;
    codeActions(uri: string, text: string, diagnostics: LspDiagnostic[], kind: string): Promise<CodeAction[]>;
    resolveActions(actions: CodeAction[]): Promise<CodeAction[]>;
    shutdown(): Promise<void>;
    close(): void;
    private request;
    private notify;
}
