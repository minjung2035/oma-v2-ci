import xxhash from "xxhash-wasm";
import { truncateToBytes } from "../utils.js";
import { MAX_HASH_SOURCE_BYTES } from "../constants.js";
let hasher = null;
export function getH() {
    if (hasher)
        return hasher;
    throw new Error("xxhash-wasm hasher not initialized; await initHasher() before calling hashline APIs.");
}
const hasherP = xxhash().then((h) => {
    hasher = h;
    return hasher;
}).catch((err) => {
    console.error("xxhash-wasm initialization failed:", err);
    throw err;
});
export function initHasher() {
    return hasherP;
}
export function xxh32(input, seed = 0) {
    return getH().h32(input, seed) >>> 0;
}
export function contentChecksum(content) {
    return getH().h64ToString(content);
}
export function canon(line) {
    return line.replace(/\r/g, "").trimEnd();
}
export function hashSource(line) {
    return truncateToBytes(canon(line), MAX_HASH_SOURCE_BYTES);
}
export function lineChecksum(line) {
    return contentChecksum(hashSource(line));
}
