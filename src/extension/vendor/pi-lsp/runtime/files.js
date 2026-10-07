import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
export function resolveRoot(root) {
    const resolvedRoot = path.resolve(root?.trim() || process.cwd());
    if (!existsSync(resolvedRoot))
        throw new Error(`Workspace root does not exist: ${resolvedRoot}`);
    if (!statSync(resolvedRoot).isDirectory()) {
        throw new Error(`Expected workspace root to be a directory: ${resolvedRoot}`);
    }
    return resolvedRoot;
}
export function directoryUri(directory) {
    return pathToFileURL(directory.endsWith(path.sep) ? directory : `${directory}${path.sep}`).href;
}
export function resolveSupportedFile(adapter, root, filePath) {
    const resolvedPath = resolveWorkspacePath(root, filePath, "File path");
    if (!existsSync(resolvedPath))
        throw new Error(`${adapter.name} file does not exist: ${resolvedPath}`);
    if (!isInsidePath(realpathSync(root), realpathSync(resolvedPath))) {
        throw new Error(`File resolves outside workspace root: ${resolvedPath}`);
    }
    if (!statSync(resolvedPath).isFile())
        throw new Error(`Expected a file: ${resolvedPath}`);
    if (!adapter.isSupportedFile(resolvedPath)) {
        throw new Error(`Expected a ${adapter.name} supported file: ${resolvedPath}`);
    }
    return resolvedPath;
}
export function collectSupportedFiles(adapter, root, requestedPaths, limit) {
    const cappedLimit = Math.max(1, Math.floor(limit));
    const files = [];
    const seen = new Set();
    const visitedDirectories = new Set();
    const realRoot = realpathSync(root);
    const inputs = requestedPaths?.length ? requestedPaths : [root];
    for (const input of inputs) {
        const targetPath = resolveWorkspacePath(root, input, "Requested path");
        if (!existsSync(targetPath))
            throw new Error(`Requested path does not exist: ${targetPath}`);
        if (!isInsidePath(realRoot, realpathSync(targetPath))) {
            throw new Error(`Requested path resolves outside workspace root: ${targetPath}`);
        }
        collectPath(adapter, targetPath, files, seen, visitedDirectories, realRoot, cappedLimit);
        if (files.length >= cappedLimit)
            break;
    }
    return files;
}
// OMA divergence (applied by scripts/vendor-pi-lsp.mjs; recorded under
// generated.divergences in manifest.json): the recursion became an
// explicit stack -- a deep tree is collected whole, never dropped for
// depth and never recursed into a stack overflow. Children are pushed
// in reverse sorted order so pops visit them in the recursion's own
// depth-first order; the collected list is identical.
function collectPath(adapter, targetPath, files, seen, visitedDirectories, realRoot, limit) {
    const pending = [targetPath];
    while (pending.length > 0 && files.length < limit) {
        const current = pending.pop();
        if (!existsSync(current))
            continue;
        if (!isInsidePath(realRoot, realpathSync(current)))
            continue;
        const stats = statSync(current);
        if (stats.isFile()) {
            if (adapter.isSupportedFile(current) && !seen.has(current)) {
                seen.add(current);
                files.push(current);
            }
            continue;
        }
        if (!stats.isDirectory())
            continue;
        const directoryKey = realpathSync(current);
        if (visitedDirectories.has(directoryKey))
            continue;
        visitedDirectories.add(directoryKey);
        const entries = readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
        for (let index = entries.length - 1; index >= 0; index -= 1) {
            const entry = entries[index];
            if ((entry.isDirectory() || entry.isSymbolicLink()) && adapter.skipDirectories.has(entry.name))
                continue;
            pending.push(path.join(current, entry.name));
        }
    }
}
function resolveWorkspacePath(root, inputPath, label) {
    const resolvedPath = path.resolve(root, inputPath);
    const realRoot = realpathSync(root);
    const isLexicallyInsideRoot = isInsidePath(root, resolvedPath);
    if (existsSync(resolvedPath)) {
        const realResolvedPath = realpathSync(resolvedPath);
        if (!isInsidePath(realRoot, realResolvedPath)) {
            throw new Error(`${label} resolves outside workspace root: ${resolvedPath}`);
        }
        return isLexicallyInsideRoot ? resolvedPath : path.join(root, path.relative(realRoot, realResolvedPath));
    }
    if (!isLexicallyInsideRoot && !isInsidePath(realRoot, resolvedPath)) {
        throw new Error(`${label} escapes workspace root: ${resolvedPath}`);
    }
    return resolvedPath;
}
function isInsidePath(parent, child) {
    const relativePath = path.relative(parent, child);
    return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}
