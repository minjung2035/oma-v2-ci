import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type DiffSpan, type LineEnding } from "./replace-diff.js";
import { type NormFile } from "./file-reader.js";
import { editToolSchema, type ReqParams, type RawReqParams, assertReq } from "./payload-contract.js";
import { type FileIdentity } from "./fs-write.js";
import { type HEdit, type NEdit, type StripWarningLocation } from "./hashline/index.js";
import { type RMetrics } from "./replace-response.js";
import { type RPreview, type RRState } from "./replace-render.js";
import { type HashStore } from "./hash-store.js";
import { type EditToolFlags } from "./edit-common.js";
export { editToolSchema, type ReqParams, assertReq };
export type ReplaceDetails = {
    diff: string;
    patch?: string;
    patchTruncated?: boolean;
    firstChangedLine?: number;
    snapshotId?: string;
    classification?: "noop";
    metrics?: RMetrics;
    diffLineNumbers?: (number | null)[];
    warnings?: string[];
    hints?: string[];
    batch?: {
        id: number;
        size: number;
        last: boolean;
        total: number;
        aborted?: boolean;
        abortMessage?: string;
    };
};
export interface PipelineResult {
    path: string;
    originalNormalized: string;
    result: string;
    bom: string;
    originalEnding: LineEnding;
    originalSeparators: LineEnding[];
    hadUtf8DecodeErrors: boolean;
    warnings: string[];
    noopEdit?: NEdit;
    firstChangedLine?: number;
    lastChangedLine?: number;
    originalHashes: string[];
    resultHashes: string[];
    totalAddedLines: number;
    totalRemovedLines: number;
    identity: FileIdentity;
    spans?: DiffSpan[];
    contentSeparators?: (LineEnding | undefined)[];
}
export interface ExecPipelineOptions {
    accessMode?: number;
    signal?: AbortSignal;
    store?: HashStore;
    noPersist?: boolean;
    preloadedNorm?: NormFile;
    served?: ReadonlyMap<string, string>;
    allowEmpty?: boolean;
    stripWarning?: StripWarningLocation;
    endingOverrides?: (LineEnding | undefined)[];
    preserveDeletionSeparators?: boolean;
}
export declare function hashSpan(hashes: string[], from: string, to: string): [number, number] | undefined;
export declare function spanForEdit(originalHashes: string[], from: string, to: string, resultContent: string): DiffSpan | undefined;
export declare function noteAnchorError(absolutePath: string, error: unknown, noPersist?: boolean): Promise<void>;
export declare function buildReplaceHEdit(params: RawReqParams): {
    edit: HEdit;
    warnings: string[];
};
export declare function execPipeline(targetPath: string, params: RawReqParams, cwd: string, options?: ExecPipelineOptions): Promise<PipelineResult>;
export declare function previewFromPipe(pipe: PipelineResult): RPreview;
export declare function previewError(error: unknown): RPreview;
export declare function compPreview(request: unknown, cwd: string, signal?: AbortSignal): Promise<RPreview>;
type ToolDef = ToolDefinition<any, ReplaceDetails, RRState> & {
    renderShell?: "default" | "self";
};
export declare function buildToolDef(flags?: EditToolFlags): ToolDef;
export declare function regReplace(pi: ExtensionAPI, flags?: EditToolFlags): void;
