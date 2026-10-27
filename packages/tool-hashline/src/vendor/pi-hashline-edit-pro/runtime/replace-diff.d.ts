import { detectEnding, toLF, restoreEndings, stripBOM, type LineEnding } from "./normalize.js";
export { detectEnding, toLF, restoreEndings, stripBOM, type LineEnding };
export interface DiffSpan {
    start: number;
    end: number;
    replacementCount: number;
    carry?: number;
}
export interface DiffLimits {
    maxLineBytes?: number;
    maxBytes?: number;
    unlimited?: boolean;
}
export declare function spansFromHashes(oldHashes: string[], newHashes: string[]): DiffSpan[];
export declare function disambiguateDuplicateAnchors(diff: string): string;
export declare function genDiff(oldContent: string, newContent: string, contextLines?: number, newContentHashes?: string[], oldContentHashes?: string[], limits?: DiffLimits, spans?: DiffSpan[]): {
    diff: string;
    firstChangedLine: number | undefined;
    lineNumbers: (number | undefined)[];
};
export declare function genPatch(path: string, oldContent: string, newContent: string, limits?: DiffLimits): {
    patch: string;
    truncated: boolean;
};
