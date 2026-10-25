import { type RHEdit, type NEdit, type HEdit, type StripWarningLocation } from "./resolve.js";
type LIdx = {
    fileLines: string[];
    lineStarts: number[];
};
export declare function buildIdx(content: string): LIdx;
export declare function assertNotEmpty(originalContent: string, result: string): void;
export interface PlannedEdit {
    resolved: RHEdit;
    warnings: string[];
}
export declare function planEdit(content: string, edit: HEdit, precomputedHashes: string[], options?: {
    filePath?: string;
    servedHashes?: ReadonlyMap<string, string>;
    signal?: AbortSignal;
    baseFileLines?: string[];
    stripWarning?: StripWarningLocation;
}): PlannedEdit;
export declare function applyEdit(content: string, edit: HEdit, signal?: AbortSignal, precomputedHashes?: string[], filePath?: string, servedHashes?: ReadonlyMap<string, string>, allowEmpty?: boolean, stripWarning?: StripWarningLocation): {
    content: string;
    firstChangedLine: number | undefined;
    lastChangedLine: number | undefined;
    warnings?: string[];
    noopEdit?: NEdit;
};
export { fmtRegion, fmtRow } from "./resolve.js";
export declare function changedRange(original: string, result: string): {
    firstChangedLine: number;
    lastChangedLine: number;
} | null;
