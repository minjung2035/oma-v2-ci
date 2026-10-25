export interface SnapshotCacheEntry {
    checksum: string;
    lineCount: number;
    hashes: string[];
}
export declare const SNAPSHOT_CACHE_LIMIT = 256;
export declare const snapshotCache: Map<string, SnapshotCacheEntry>;
export declare function cacheSnapshot(path: string, checksum: string, lineCount: number, hashes: string[]): void;
