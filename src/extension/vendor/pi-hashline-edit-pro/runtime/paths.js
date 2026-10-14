import { homedir } from "node:os";
import { isAbsolute, relative, resolve as resolvePath, join, dirname, parse } from "node:path";
function homeBase() {
    const envHome = process.env.HOME;
    return envHome && envHome.length > 0 ? envHome : homedir();
}
function configBase() {
    if (process.platform !== "win32") {
        const xdg = process.env.XDG_CONFIG_HOME;
        if (xdg && xdg.length > 0)
            return xdg;
    }
    return join(homeBase(), ".config");
}
export function configDir() {
    const override = process.env.PI_HASHLINE_DIR;
    if (override && !isAbsolute(override)) {
        throw new Error("[E_CONFIG] PI_HASHLINE_DIR must be an absolute path");
    }
    return override || join(configBase(), "pi-hashline-edit-pro");
}
export function configPath() {
    return join(configDir(), "config.json");
}
export function hashStorePath() {
    return join(configDir(), "hash-store.sqlite");
}
export function legacyHashStorePath() {
    return join(configDir(), "hash-store.json");
}
export function sessionClaimsDir() {
    return join(configDir(), "sessions");
}
export function hashStoreDir() {
    return dirname(hashStorePath());
}
function expand(filePath) {
    const home = homeBase();
    if (filePath === "~")
        return home;
    if (filePath.startsWith("~/"))
        return home + filePath.slice(1);
    return filePath;
}
export function toCwd(filePath, cwd) {
    const expanded = expand(filePath);
    return isAbsolute(expanded) ? expanded : resolvePath(cwd, expanded);
}
function pathDepth(path) {
    const root = parse(path).root;
    return path.slice(root.length).split(/[\\/]+/).filter((part) => part.length > 0).length;
}
function climbsToRoot(cwd, relativePath) {
    let climbs = 0;
    for (const part of relativePath.split("/")) {
        if (part !== "..")
            break;
        climbs += 1;
    }
    return climbs > 0 && climbs >= pathDepth(resolvePath(cwd));
}
export function toDisplayPath(cwd, absolutePath, fallback) {
    const rel = relative(cwd, absolutePath).replace(/\\/g, "/");
    if (rel.length === 0 || climbsToRoot(cwd, rel))
        return fallback ?? absolutePath;
    return rel;
}
