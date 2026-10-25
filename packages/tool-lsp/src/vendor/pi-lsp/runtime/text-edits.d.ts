import type { LspPosition, LspTextEdit, WorkspaceEdit } from "./types.js";
export declare function positionAt(text: string, offset: number): LspPosition;
export declare function applyTextEdits(text: string, edits: LspTextEdit[]): string;
export declare function hasOverlappingTextEdits(text: string, edits: LspTextEdit[]): boolean;
export declare function collectWorkspaceEdits(edit: WorkspaceEdit | undefined, uri: string): LspTextEdit[];
