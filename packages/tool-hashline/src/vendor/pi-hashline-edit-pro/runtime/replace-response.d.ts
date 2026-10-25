import type { NEdit } from "./hashline/index.js";
import type { ReplaceDetails } from "./replace.js";
import { type DiffSpan } from "./replace-diff.js";
export type TResult = {
    content: Array<{
        type: "text";
        text: string;
    }>;
    isError?: boolean;
    details: ReplaceDetails;
};
export type RMetrics = {
    edits_attempted: number;
    edits_noop: number;
    warnings: number;
    classification: "applied" | "noop";
    changed_lines?: {
        first: number;
        last: number;
    };
    added_lines?: number;
    removed_lines?: number;
};
export type RMeta = {
    editsAttempted: number;
    noopEditsCount: number;
    firstChangedLine?: number;
    lastChangedLine?: number;
    addedLines: number;
    removedLines: number;
};
export interface NoopInput {
    path: string;
    noopEdit: NEdit | undefined;
    snapshotId?: string;
    editMeta: RMeta;
    warnings: string[] | undefined;
}
export interface SuccessInput {
    path: string;
    originalNormalized: string;
    originalHashes: string[];
    result: string;
    resultHashes: string[];
    warnings: string[] | undefined;
    snapshotId?: string;
    editMeta: RMeta;
    spans?: DiffSpan[];
}
export declare function buildMetrics(args: {
    classification: "applied" | "noop";
    editsAttempted: number;
    noopEditsCount: number;
    warningsCount: number;
    firstChangedLine?: number;
    lastChangedLine?: number;
    addedLines?: number;
    removedLines?: number;
}): RMetrics;
export declare function buildNoop(input: NoopInput, noopNoun?: string): TResult;
export declare function buildChanged(input: SuccessInput, verb?: string, diffContextLines?: number): TResult;
