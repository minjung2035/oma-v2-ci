import { isValidHashList, parseStoredHashes, isCorruptionError, parseHashList } from "./hash-store/validation.js";
import { SNAPSHOT_CACHE_LIMIT } from "./hash-store/cache.js";
export { isValidHashList, parseHashList, parseStoredHashes, isCorruptionError };
export { SNAPSHOT_CACHE_LIMIT };
export declare const STORE_NOT_OPEN_MESSAGE = "Hash store is not open; transactional update aborted";
export declare const STORE_SHUT_DOWN_MESSAGE = "Hash store was shut down while it was opening; call loadHashStore again.";
type SqlParams = (string | number | null)[];
export type SqliteEngine = "node:sqlite" | "bun:sqlite";
interface Prepared {
    get: (...params: SqlParams) => Record<string, unknown> | undefined;
    getState: (...params: SqlParams) => Record<string, unknown> | undefined;
    allPaths: (...params: SqlParams) => Record<string, unknown>[];
    deleteOne: (...params: SqlParams) => void;
    upsert: (...params: SqlParams) => void;
    undoUpsert: (...params: SqlParams) => void;
    undoGet: (...params: SqlParams) => Record<string, unknown> | undefined;
    undoDelete: (...params: SqlParams) => void;
    snapshotTime: (...params: SqlParams) => Record<string, unknown> | undefined;
    undoTime: (...params: SqlParams) => Record<string, unknown> | undefined;
}
export interface HashStore {
    readonly stmts: Prepared;
    readonly engine: SqliteEngine;
}
export interface UndoRecord {
    content: string;
    bom: string;
    ending: string;
    separators?: string[];
    hashes: string[];
    resultContent: string;
    resultSeparators?: string[];
    mode?: number;
}
export declare function loadHashStore(): Promise<HashStore>;
export declare function shutdownHashStore(): void;
export declare function withStore(fn: () => void): void;
export declare function getSnapshot(store: HashStore, path: string, content: string, deleteCorrupt?: boolean): string[] | undefined;
export declare function upsertSnapshot(store: HashStore, path: string, checksum: string, lineCount: number, hashes: string[], lineChecksums?: string[]): void;
export declare function persistSnapshot(store: HashStore, path: string, content: string, hashes: string[], lineChecksums?: string[]): void;
export interface AllocatedState {
    anchors: string[];
    checksums: string[] | undefined;
    contentChecksum: string;
}
export declare function getAllocatedState(store: HashStore, path: string, deleteCorrupt?: boolean): AllocatedState | undefined;
export declare function upsertUndo(store: HashStore, path: string, entry: UndoRecord): void;
export declare function getUndoEntry(store: HashStore, path: string): UndoRecord | undefined;
export declare function deleteUndo(store: HashStore, path: string): void;
export declare function pruneMissing(store: HashStore): Promise<string[]>;
