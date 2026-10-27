import { type Anchor } from "./parse.js";
import type { LineEnding } from "../normalize.js";
export type RAnchor = {
    line: number;
    hash: string;
};
export type HEdit = {
    content_lines: string[];
    hash_bounds: [Anchor, Anchor];
    content_separators?: (LineEnding | undefined)[];
};
export type RHEdit = {
    content_lines: string[];
    hash_bounds: [RAnchor, RAnchor];
    content_separators?: (LineEnding | undefined)[];
};
interface HMismatch {
    ref: Anchor;
    kind: "not_found";
    context?: RAnchor;
}
export interface NEdit {
    loc: string;
    currentContent: string;
}
export type HTEdit = {
    replacement_lines: string[];
    remove_from: string;
    remove_to: string;
};
export type HTPayloadEdit = {
    replacement_lines: string;
    remove_from: string;
    remove_to: string;
};
export declare function fmtRow(hash: string, line: string): string;
export declare function fmtRegion(hashes: string[], lines: string[]): string;
export declare function fmtMismatchWithHashes(mismatches: HMismatch[], fileLines: string[], fileHashes: string[], filePath?: string): {
    text: string;
    hashes: string[];
    servedMap: Map<string, string>;
};
export declare const ANCHOR_ROW_RE: RegExp;
export declare function stripAnchorRow(trimmed: string, entryLabel: string, warnings?: string[]): string;
export declare function resEdit(edit: HTEdit | HTPayloadEdit, warnings?: string[]): HEdit;
declare function warnUnicodeEsc(edit: HEdit, warnings: string[]): void;
export interface StripWarningLocation {
    label: string;
    indexOffset: number;
}
export declare function stripBarePrefixes(edit: HEdit, warnings: string[], location?: StripWarningLocation): HEdit;
export declare function stripDiffPrefixes(edit: HEdit, warnings: string[], location?: StripWarningLocation): HEdit;
export declare function swapReversedRanges(edit: HEdit, fileHashes: string[]): HEdit;
export declare function preserveDeletionSeparators(edit: HEdit, fileLines: string[], fileHashes: string[]): HEdit;
export declare function valEdit(edit: HEdit, fileLines: string[], fileHashes: string[], warnings: string[], signal: AbortSignal | undefined): {
    resolved: RHEdit | undefined;
    mismatches: HMismatch[];
};
export declare function resolveAnchorLine(ref: Anchor, fileLines: string[], fileHashes: string[], filePath?: string): number;
export declare class RangeStaleError extends Error {
    readonly rangeHashes: string[];
    readonly rangeServedMap: Map<string, string>;
    constructor(message: string, rangeHashes: string[], rangeServedMap: Map<string, string>);
}
export declare class AnchorMismatchError extends Error {
    readonly feedbackHashes: string[];
    readonly feedbackMap: Map<string, string>;
    constructor(message: string, feedbackHashes: string[], feedbackMap: Map<string, string>);
}
export declare function assertRangeServed(resolved: RHEdit, fileLines: string[], fileHashes: string[], served: ReadonlyMap<string, string> | undefined, filePath?: string): void;
export { warnUnicodeEsc };
