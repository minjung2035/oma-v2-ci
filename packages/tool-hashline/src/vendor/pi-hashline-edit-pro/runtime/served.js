import { HASH_CLASS } from "./hashline/alphabet.js";
import { lineChecksum } from "./hashline/hash.js";
import { markServed } from "./anchor-registry.js";
const SERVED_DIFF_ROW_RE = new RegExp(`^[+ ](${HASH_CLASS})│`);
export function servedHashesFromDiff(diff) {
    const hashes = [];
    for (const line of diff.split("\n")) {
        const match = SERVED_DIFF_ROW_RE.exec(line);
        if (match)
            hashes.push(match[1]);
    }
    return hashes;
}
export function buildServedMap(fileHashes, fileLines, wantedHashes) {
    const index = new Map();
    for (let i = 0; i < fileHashes.length; i++) {
        const existing = index.get(fileHashes[i]);
        if (existing === undefined)
            index.set(fileHashes[i], i);
    }
    const entries = [];
    for (const hash of wantedHashes) {
        const idx = index.get(hash);
        if (idx !== undefined)
            entries.push([hash, lineChecksum(fileLines[idx])]);
    }
    return entries;
}
export function serveRows(path, fileHashes, fileLines, wantedHashes) {
    markServed(path, buildServedMap(fileHashes, fileLines, wantedHashes), new Set(fileHashes));
}
