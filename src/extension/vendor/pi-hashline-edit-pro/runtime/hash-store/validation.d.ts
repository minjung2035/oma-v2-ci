export declare function isValidHashList(value: unknown): value is string[];
export declare function parseHashList(raw: string, onInvalid: () => void, context?: string): string[] | undefined;
export declare function parseStoredHashes(row: Record<string, unknown> | undefined, onInvalid: () => void): string[] | undefined;
export declare function isValidSnapshot(value: unknown): value is {
    content: string;
    hashes: string[];
};
export declare function isCorruptionError(error: unknown): boolean;
export declare function isBusyError(error: unknown): boolean;
export interface SeparatorParse {
    ok: boolean;
    value?: string[];
}
export declare function parseSeparators(raw: unknown): SeparatorParse;
