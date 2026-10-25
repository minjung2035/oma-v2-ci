import { type LFile } from "./file-kind.js";
import { type FileIdentity } from "./fs-write.js";
import { type LineEnding } from "./normalize.js";
import type { HashStore } from "./hash-store.js";
export interface NormFile {
    absolutePath: string;
    normalized: string;
    bom: string;
    originalEnding: LineEnding;
    endingSeparators: LineEnding[];
    fileHashes: string[];
    hadUtf8DecodeErrors: boolean;
    identity: FileIdentity;
}
export type SnapInfo = {
    snapshotId: string;
    ino: number;
    mtimeMs: number;
    ctimeMs: number;
    size: number;
};
export declare function fileSnap(absolutePath: string): Promise<SnapInfo>;
export declare function safeSnapId(absolutePath: string, context: string): Promise<string | undefined>;
export interface ReadNormOptions {
    signal?: AbortSignal;
    accessMode?: number;
    preloadedFile?: LFile;
    preloadedNorm?: NormFile;
    maxLines?: number;
    store?: HashStore;
    noPersist?: boolean;
    allocation?: "real" | "shadow";
}
export declare function readNormFile(path: string, cwd: string, options?: ReadNormOptions): Promise<NormFile>;
export declare function tryReadNormFile(absPath: string, cwd: string, options?: ReadNormOptions): Promise<NormFile | undefined>;
