import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type TruncationResult } from "@earendil-works/pi-coding-agent";
import { type EditToolFlags } from "./edit-common.js";
export declare function formatPaginationHint(startLine: number, endLine: number, totalLines: number, nextOffset: number, byteLimit?: number): string;
export declare function fmtReadPreview(text: string, options: {
    offset?: number;
    limit?: number;
}, precomputedHashes?: string[], path?: string, maxLineBytes?: number, maxTruncLines?: number): Promise<{
    text: string;
    truncation?: TruncationResult;
    nextOffset?: number;
    servedHashes: string[];
}>;
export declare function regRead(pi: ExtensionAPI, flags?: EditToolFlags): void;
