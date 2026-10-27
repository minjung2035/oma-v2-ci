import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { configPath } from "./paths.js";
import { errCode, isRec } from "./utils.js";
import { writeAtomic } from "./fs-write.js";
const AUTO_READ_ALL_MODES = ["off", "on", "git"];
export const DEFAULT_DIFF_CONTEXT_LINES = 1;
export const MIN_DIFF_CONTEXT_LINES = 0;
export const MAX_DIFF_CONTEXT_LINES = 10;
const DEFAULT_CONFIG = {
    autoRead: true,
    anchorGrepEnabled: true,
    copyMoveEnabled: true,
    replaceWithinEnabled: true,
    autoReadAll: "off",
    autoReadAllIgnore: [],
    requirePath: false,
    strictInput: false,
    diffContextLines: DEFAULT_DIFF_CONTEXT_LINES
};
function parseAutoReadAllMode(value) {
    if (value === "off" || value === "on" || value === "git")
        return value;
    if (value === true)
        return "on";
    if (value === false)
        return "off";
    return DEFAULT_CONFIG.autoReadAll ?? "off";
}
export function normalizeAutoReadAllIgnoreEntry(entry) {
    return entry.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
}
export function parseAutoReadAllIgnore(value) {
    const raw = typeof value === "string" ? value.split(",") : Array.isArray(value) ? value : [];
    const seen = new Set();
    const out = [];
    for (const item of raw) {
        if (typeof item !== "string")
            continue;
        const cleaned = normalizeAutoReadAllIgnoreEntry(item);
        if (cleaned.length === 0)
            continue;
        const lower = cleaned.toLowerCase();
        if (seen.has(lower))
            continue;
        seen.add(lower);
        out.push(cleaned);
    }
    return out;
}
export function normalizeDiffContextLines(value) {
    if (typeof value !== "number" || !Number.isFinite(value))
        return DEFAULT_DIFF_CONTEXT_LINES;
    const floored = Math.floor(value);
    if (floored < MIN_DIFF_CONTEXT_LINES)
        return MIN_DIFF_CONTEXT_LINES;
    if (floored > MAX_DIFF_CONTEXT_LINES)
        return MAX_DIFF_CONTEXT_LINES;
    return floored;
}
function parseConfig(content) {
    const parsed = JSON.parse(content);
    if (!isRec(parsed) || (parsed.autoRead !== undefined && typeof parsed.autoRead !== "boolean")) {
        throw new Error("config.json must be an object with a boolean autoRead field");
    }
    const autoRead = parsed.autoRead;
    const anchorGrepEnabled = parsed.anchorGrepEnabled;
    const copyMoveEnabled = parsed.copyMoveEnabled;
    const replaceWithinEnabled = parsed.replaceWithinEnabled;
    const autoReadAll = parsed.autoReadAll;
    const requirePath = parsed.requirePath;
    const strictInput = parsed.strictInput;
    const diffContextLines = parsed.diffContextLines;
    const autoReadAllIgnore = parsed.autoReadAllIgnore;
    return {
        autoRead: typeof autoRead === "boolean" ? autoRead : DEFAULT_CONFIG.autoRead,
        anchorGrepEnabled: typeof anchorGrepEnabled === "boolean" ? anchorGrepEnabled : DEFAULT_CONFIG.anchorGrepEnabled,
        copyMoveEnabled: typeof copyMoveEnabled === "boolean" ? copyMoveEnabled : DEFAULT_CONFIG.copyMoveEnabled,
        replaceWithinEnabled: typeof replaceWithinEnabled === "boolean" ? replaceWithinEnabled : DEFAULT_CONFIG.replaceWithinEnabled,
        autoReadAll: parseAutoReadAllMode(autoReadAll),
        requirePath: typeof requirePath === "boolean" ? requirePath : DEFAULT_CONFIG.requirePath,
        strictInput: typeof strictInput === "boolean" ? strictInput : DEFAULT_CONFIG.strictInput,
        diffContextLines: normalizeDiffContextLines(diffContextLines),
        autoReadAllIgnore: parseAutoReadAllIgnore(autoReadAllIgnore),
    };
}
async function loadConfigFile() {
    let content;
    try {
        content = await readFile(configPath(), "utf-8");
    }
    catch (error) {
        if (errCode(error) === "ENOENT")
            return { config: { ...DEFAULT_CONFIG }, corrupted: false };
        console.error("Config file unreadable, using defaults:", error);
        return { config: { ...DEFAULT_CONFIG }, corrupted: false };
    }
    try {
        return { config: parseConfig(content), corrupted: false };
    }
    catch (error) {
        try {
            const badPath = configPath();
            await rename(badPath, `${badPath}.corrupt-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}`);
        }
        catch { }
        console.error("Config file corrupted, quarantined, using defaults:", error);
        return { config: { ...DEFAULT_CONFIG }, corrupted: true };
    }
}
export async function readConfig() {
    return (await loadConfigFile()).config;
}
export async function readConfigWithStatus() {
    return loadConfigFile();
}
const CONFIG_LOCK_DELAY_MS = 25;
const CONFIG_LOCK_STALE_MS = 5000;
const CONFIG_LOCK_RETRIES = Math.ceil(CONFIG_LOCK_STALE_MS / CONFIG_LOCK_DELAY_MS) * 2;
async function acquireConfigLock(lockPath) {
    try {
        await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
    }
    catch { }
    for (let attempt = 0; attempt < CONFIG_LOCK_RETRIES; attempt++) {
        try {
            await mkdir(lockPath, { mode: 0o700 });
        }
        catch (error) {
            if (errCode(error) === "ENOENT") {
                try {
                    await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
                }
                catch { }
                continue;
            }
            if (errCode(error) !== "EEXIST")
                throw error;
            try {
                const st = await stat(lockPath);
                if (Date.now() - st.mtimeMs > CONFIG_LOCK_STALE_MS) {
                    await rm(lockPath, { recursive: true, force: true });
                    continue;
                }
            }
            catch { }
            await new Promise((r) => setTimeout(r, CONFIG_LOCK_DELAY_MS));
            continue;
        }
        try {
            const st = await stat(lockPath);
            return { path: lockPath, dev: st.dev, ino: st.ino };
        }
        catch (error) {
            if (errCode(error) !== "ENOENT") {
                try {
                    await rm(lockPath, { recursive: true, force: true });
                }
                catch { }
            }
            continue;
        }
    }
    throw new Error(`[E_ACCESS] Could not acquire config lock: ${lockPath}`);
}
async function releaseConfigLock(lock) {
    try {
        const st = await stat(lock.path);
        if (st.dev !== lock.dev || st.ino !== lock.ino)
            return;
    }
    catch {
        return;
    }
    try {
        await rm(lock.path, { recursive: true, force: true });
    }
    catch { }
}
export async function updateConfig(mut) {
    const cfgPath = configPath();
    const lockPath = `${cfgPath}.lock`;
    const lock = await acquireConfigLock(lockPath);
    try {
        const config = await readConfig();
        mut(config);
        await writeConfig(config);
        return config;
    }
    finally {
        await releaseConfigLock(lock);
    }
}
export async function writeConfig(config) {
    await writeAtomic(configPath(), JSON.stringify(config, null, 2));
}
async function toggleFlag(key) {
    const config = await updateConfig((c) => { c[key] = !(c[key] === true); });
    return config[key] === true;
}
export const toggleAutoRead = () => toggleFlag("autoRead");
export const toggleAnchorGrep = () => toggleFlag("anchorGrepEnabled");
export const toggleCopyMove = () => toggleFlag("copyMoveEnabled");
export const toggleReplaceWithin = () => toggleFlag("replaceWithinEnabled");
export async function cycleAutoReadAllMode() {
    let next = "off";
    await updateConfig((c) => {
        const current = c.autoReadAll ?? "off";
        next = AUTO_READ_ALL_MODES[(AUTO_READ_ALL_MODES.indexOf(current) + 1) % AUTO_READ_ALL_MODES.length] ?? "off";
        c.autoReadAll = next;
    });
    return next;
}
export const toggleRequirePath = () => toggleFlag("requirePath");
export const toggleStrictInput = () => toggleFlag("strictInput");
export async function getDiffContextLines() {
    return normalizeDiffContextLines((await readConfig()).diffContextLines);
}
export async function adjustDiffContextLines(delta) {
    let next = DEFAULT_DIFF_CONTEXT_LINES;
    await updateConfig((c) => {
        next = normalizeDiffContextLines(normalizeDiffContextLines(c.diffContextLines) + delta);
        c.diffContextLines = next;
    });
    return next;
}
export async function setAutoReadAllIgnore(dirs) {
    let next = [];
    await updateConfig((c) => {
        next = parseAutoReadAllIgnore(dirs);
        c.autoReadAllIgnore = next;
    });
    return next;
}
export async function setAutoReadAllIgnoreFromText(text) {
    return setAutoReadAllIgnore(text.split(","));
}
