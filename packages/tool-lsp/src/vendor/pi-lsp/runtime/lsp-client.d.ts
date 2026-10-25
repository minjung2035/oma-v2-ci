import type { CodeAction, LspDiagnostic, LspServerAdapter, ServerCommand } from "./types.js";
export declare function resolveSpawnCommand(command: ServerCommand, platform?: NodeJS.Platform, comSpec?: string | undefined): ServerCommand;
/** OMA divergence: the marker constructors and predicates the spliced
 * runtime exports -- a flagged diagnostic is a real LSP diagnostic. */
export declare function omaMarkerDiagnostic(text: string, code?: string, severity?: number): LspDiagnostic;
export declare function omaIsMarker(diagnostic: LspDiagnostic): boolean;
export declare class LspClient {
    #private;
    constructor(adapter: LspServerAdapter, command: ServerCommand, cwd: string, timeoutMs: number);
    start(): Promise<void>;
    initialize(root: string): Promise<void>;
    /** OMA divergence: false means the write buffered -- await didDrain(). */
    didOpen(uri: string, text: string, languageId: string): boolean;
    /** OMA divergence: settles a backpressured write -- resolves on
     * 'drain', rejects on stdin error/close or the request budget. */
    didDrain(): Promise<void>;
    didClose(uri: string): boolean;
    diagnostics(uri: string): Promise<LspDiagnostic[]>;
    codeActions(uri: string, text: string, diagnostics: LspDiagnostic[], kind: string): Promise<CodeAction[]>;
    resolveActions(actions: CodeAction[]): Promise<CodeAction[]>;
    shutdown(): Promise<void>;
    close(): void;
    private request;
    private notify;
}
