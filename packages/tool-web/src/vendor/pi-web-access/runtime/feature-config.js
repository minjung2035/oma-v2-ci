import { existsSync, readFileSync } from "node:fs";
import { getWebSearchConfigPath } from "./utils.js";
const CONFIG_PATH = getWebSearchConfigPath();
function loadFeatureConfig() {
    if (!existsSync(CONFIG_PATH))
        return {};
    try {
        const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
        return raw && typeof raw === "object" ? raw : {};
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to parse ${CONFIG_PATH}: ${message}`);
    }
}
export function isImageEnabled() {
    return loadFeatureConfig().image?.enabled !== false;
}
export function canAttachImages() {
    try {
        return isImageEnabled();
    }
    catch {
        return false;
    }
}
