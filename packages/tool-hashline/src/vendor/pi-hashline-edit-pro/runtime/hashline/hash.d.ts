import { type HashStore } from "../hash-store.js";
import { initHasher, canon, hashSource, lineChecksum } from "./hasher.js";
export { canon, hashSource, lineChecksum };
import { HASH_LEN, HASH_CLASS, HASH_RUN } from "./alphabet.js";
export { initHasher, HASH_LEN, HASH_CLASS, HASH_RUN };
export declare const ANCHOR_LEN = 4;
export declare const HASH_SEP = "\u2502";
export declare const HASH_SPACE: number;
export declare const MAX_HASH_LINES: number;
export declare const HASH_PROBE_STRIDE = 836286;
export declare const HL_PREFIX_PLUS_RE: RegExp;
export declare const HL_PREFIX_MINUS_RE: RegExp;
export declare const HL_BARE_PREFIX_RE: RegExp;
export type RowPrefixKind = "bare" | "plus" | "minus";
export type StrippedRow = {
    text: string;
    kind: RowPrefixKind | null;
    hash: string | undefined;
};
export declare function stripRowPrefix(line: string): StrippedRow;
export declare function _lineHashesPure(content: string): string[];
export declare function lineHashes(content: string, path?: string, previous?: {
    content: string;
    hashes: string[];
    spans?: {
        start: number;
        end: number;
        replacementCount: number;
        carry?: number;
    }[];
}, store?: HashStore, persist?: boolean, shadow?: boolean): Promise<string[]>;
