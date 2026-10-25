export const SNAPSHOT_CACHE_LIMIT = 256;
export const snapshotCache = new Map();
export function cacheSnapshot(path, checksum, lineCount, hashes) {
    snapshotCache.delete(path);
    snapshotCache.set(path, { checksum, lineCount, hashes: hashes.slice() });
    if (snapshotCache.size > SNAPSHOT_CACHE_LIMIT) {
        const oldest = snapshotCache.keys().next().value;
        if (oldest !== undefined)
            snapshotCache.delete(oldest);
    }
}
