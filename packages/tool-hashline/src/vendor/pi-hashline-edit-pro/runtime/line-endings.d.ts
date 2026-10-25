import type { LineEnding } from "./normalize.js";
export interface EndingSpan {
    start: number;
    end: number;
    replacementCount: number;
}
export declare function countNewlines(content: string): number;
export declare function splitSeparators(raw: string): LineEnding[];
export declare function joinSeparators(content: string, separators: readonly LineEnding[]): string;
export declare function separatorsForSpans(baseSeparators: readonly LineEnding[], baseLineCount: number, spans: readonly EndingSpan[], resultContent: string, fallback: LineEnding): LineEnding[];
export declare function endingsForRange(separators: readonly LineEnding[], startLine: number, endLine: number): (LineEnding | undefined)[];
export declare function splitWithEndings(text: string): {
    lines: string[];
    endings: (LineEnding | undefined)[];
};
export declare function applyEndingOverrides(separators: LineEnding[], spanStart: number, endings: readonly (LineEnding | undefined)[] | undefined): void;
export declare function applySpanEndings(separators: LineEnding[], spans: readonly {
    start: number;
    end: number;
    replacementCount: number;
    endings?: (LineEnding | undefined)[];
}[]): void;
