import { accessSync, constants, existsSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
export function commandExists(command, cwd = process.cwd(), pathValue = process.env.PATH ?? "") {
    return resolveCommandPath(command, cwd, process.platform, pathValue) !== undefined;
}
export function commandPathValue(env, platform = process.platform) {
    return environmentValue(env, "PATH", platform) ?? environmentValue(process.env, "PATH", platform) ?? "";
}
export function mergeEnvironment(overrides, platform = process.platform) {
    // OMA divergence: deny-by-default -- the overrides ARE the child's
    // whole environment; nothing is inherited from process.env. OMA's
    // adapter writes the complete map (allowlisted inherited names, the
    // adapter's declared extras through the same allowlist, the per-call
    // scratch redirects), so an injection channel OMA never named cannot
    // reach the child through the union this line used to seed -- and an
    // emptied tombstone cannot fake stripping either, since loaders read
    // an empty path-list element as the current directory.
    const environment = {};
    for (const [key, value] of Object.entries(overrides ?? {})) {
        if (platform === "win32") {
            for (const existingKey of Object.keys(environment)) {
                if (existingKey.toLowerCase() === key.toLowerCase())
                    delete environment[existingKey];
            }
        }
        environment[key] = value;
    }
    return environment;
}
function environmentValue(environment, name, platform) {
    if (platform !== "win32")
        return environment?.[name];
    let value;
    for (const [key, candidate] of Object.entries(environment ?? {})) {
        if (key.toLowerCase() === name.toLowerCase())
            value = candidate;
    }
    return value;
}
export function resolveCommandPath(command, cwd = process.cwd(), platform = process.platform, pathValue = process.env.PATH ?? "") {
    const extensions = platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
    if (command.includes("/") || command.includes("\\")) {
        const commandPath = path.isAbsolute(command) ? command : path.resolve(cwd, command);
        return resolveRunnableFile(commandPath, extensions, platform);
    }
    for (const directory of pathValue.split(platform === "win32" ? ";" : ":")) {
        const resolved = resolveRunnableFile(path.resolve(cwd, directory || ".", command), extensions, platform);
        if (resolved)
            return resolved;
    }
    return undefined;
}
function resolveRunnableFile(filePath, extensions, platform) {
    for (const extension of extensions) {
        const candidate = `${filePath}${extension}`;
        if (isRunnableFile(candidate, platform))
            return candidate;
    }
    return undefined;
}
function isRunnableFile(filePath, platform) {
    if (!existsSync(filePath))
        return false;
    try {
        if (!statSync(filePath).isFile())
            return false;
        if (platform !== "win32")
            accessSync(filePath, constants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}
