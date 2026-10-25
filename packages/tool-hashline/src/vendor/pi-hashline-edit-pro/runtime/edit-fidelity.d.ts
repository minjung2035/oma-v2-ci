import type { DiffSpan } from "./replace-diff.js";
export declare function isFidelitySensitiveChar(char: string): boolean;
export declare function annotateLiteralEscapeHints(hints: string[], resultContent: string, spans: readonly DiffSpan[] | undefined, resultHashes: readonly string[]): string[];
export declare function fidelityHints(originalContent: string, resultContent: string, spans: readonly DiffSpan[] | undefined, originalHashes?: readonly string[], options?: {
    separatorMoved?: boolean;
    indentHints?: boolean;
}): string[];
