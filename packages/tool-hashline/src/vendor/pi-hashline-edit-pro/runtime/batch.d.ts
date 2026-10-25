import { type FileIdentity } from "./fs-write.js";
import { type HEdit, type StripWarningLocation } from "./hashline/index.js";
import { type LineEnding } from "./normalize.js";
import { type TResult } from "./replace-response.js";
export interface PlannedMember {
    batchKey: number;
    id: string;
    display: number;
    total: number;
    target: string;
    kind: BatchKind;
    args: unknown;
    order: number;
    size: number;
    last: boolean;
}
export type BatchKind = "replace" | "insert";
interface BatchBase {
    content: string;
    hashes: string[];
    bom: string;
    ending: LineEnding;
    separators: LineEnding[];
    identity: FileIdentity;
    hadUtf8DecodeErrors: boolean;
    absolutePath: string;
    snapshotId?: string;
    baseLines: string[];
}
export interface BatchPiece {
    order: number;
    kind: BatchKind;
    direction?: "before" | "after";
    start: number;
    end: number;
    fromHash: string;
    toHash: string;
    newLines: string[];
    warnings: string[];
    noop: boolean;
    foldedLines: number;
    carryIndex?: number;
    separators?: (LineEnding | undefined)[];
}
export interface BatchMemberInput {
    kind: BatchKind;
    direction?: "before" | "after";
    member: PlannedMember;
    targetPath: string;
    mutationTargetPath: string;
    cwd: string;
    signal?: AbortSignal;
    hedit: HEdit;
    extraWarnings: string[];
    foldedLines?: number;
    stripWarning?: StripWarningLocation;
    contentSeparators?: (LineEnding | undefined)[];
}
export declare function abortedBatchMessageFor(toolCallId: string): string | undefined;
export declare function batchMemberFor(toolCallId: string): PlannedMember | undefined;
export declare function resetBatchStateForTests(): void;
export declare function planAssistantMessage(message: unknown, cwd: string): Promise<void>;
export declare function withAbortSuffix(message: string, display: number): string;
export declare function noteBatchFailure(member: PlannedMember, error: unknown): void;
export declare function ensureBatchBase(input: {
    member: PlannedMember;
    targetPath: string;
    mutationTargetPath: string;
    cwd: string;
    signal?: AbortSignal;
}): Promise<BatchBase>;
export declare function executeBatchMember(input: BatchMemberInput): Promise<TResult>;
export declare function finalizeTurn(toolCallIds: string[]): Promise<void>;
export {};
