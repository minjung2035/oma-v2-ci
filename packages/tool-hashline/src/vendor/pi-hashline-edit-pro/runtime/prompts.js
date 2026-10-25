import { readFileSync } from "node:fs";
import { errCode } from "./utils.js";
export function loadP(relativePath) {
    return readFileSync(new URL(relativePath, import.meta.url), "utf-8").trim();
}
export function loadGuide(relativePath) {
    let raw;
    try {
        raw = readFileSync(new URL(relativePath, import.meta.url), "utf-8");
    }
    catch (error) {
        if (errCode(error) === "ENOENT") {
            console.warn(`hashline: missing prompt file ${relativePath}; continuing without those guidelines`);
            return [];
        }
        throw error;
    }
    return raw
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("- "))
        .map((line) => line.slice(2));
}
