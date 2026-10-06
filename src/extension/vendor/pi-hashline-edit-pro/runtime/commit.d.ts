import type { PipelineResult } from "./replace.js";
import { type TResult } from "./replace-response.js";
import { type LineEnding } from "./normalize.js";
export interface CommitMeta {
    editAnchors?: [string, string];
    anchorCarry?: number;
    path: string;
    absolutePath: string;
    mutationTargetPath: string;
    signal?: AbortSignal;
    verb?: string;
    noopNoun?: string;
    prefixWarnings?: string[];
    foldedAnchorLines?: number;
    endingOverrides?: (LineEnding | undefined)[];
}
export declare function commitEdit(pipe: PipelineResult, meta: CommitMeta): Promise<TResult>;
