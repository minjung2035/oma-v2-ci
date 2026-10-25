import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, readlink, rename, rm, stat, writeFile, } from "node:fs/promises";
import { dirname, join, parse, resolve, sep } from "node:path";
import { configDir, toCwd } from "./paths.js";
import { errCode, isModeUnsupported } from "./utils.js";
function sameIdentity(actual, expected) {
    return actual.dev === expected.dev && actual.ino === expected.ino;
}
function pathChanged(path) {
    return new Error(`[E_PATH_CHANGED] Refusing to write ${path}: the target changed after it was read.`);
}
export async function resolveTarget(path) {
    const absolutePath = resolve(path);
    const { root } = parse(absolutePath);
    const parts = absolutePath
        .slice(root.length)
        .split(sep)
        .filter((part) => part.length > 0);
    const visitedSymlinks = new Set();
    async function resParts(currentPath, remainingParts, symlinkDepth = 0) {
        if (symlinkDepth > 40) {
            const error = new Error(`Too many symbolic links while resolving ${path}`);
            error.code = "ELOOP";
            throw error;
        }
        if (remainingParts.length === 0) {
            return currentPath;
        }
        const [nextPart, ...tail] = remainingParts;
        const candidatePath = join(currentPath, nextPart);
        try {
            const candidateStats = await lstat(candidatePath);
            if (!candidateStats.isSymbolicLink()) {
                return resParts(candidatePath, tail, symlinkDepth);
            }
            if (visitedSymlinks.has(candidatePath)) {
                const error = new Error(`Too many symbolic links while resolving ${path}`);
                error.code = "ELOOP";
                throw error;
            }
            visitedSymlinks.add(candidatePath);
            const linkTargetPath = resolve(dirname(candidatePath), await readlink(candidatePath));
            const targetParts = linkTargetPath
                .slice(parse(linkTargetPath).root.length)
                .split(sep)
                .filter((part) => part.length > 0);
            return resParts(parse(linkTargetPath).root, [
                ...targetParts,
                ...tail,
            ], symlinkDepth + 1);
        }
        catch (error) {
            if (errCode(error) === "ENOENT") {
                return join(candidatePath, ...tail);
            }
            throw error;
        }
    }
    return resParts(root, parts);
}
const TEMP_PREFIX = ".tmp-";
const TEMP_UUID_RE = /^\.tmp-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STALE_TEMP_MS = 60 * 60 * 1000;
const sweptDirs = new Map();
const SWEPT_DIRS_LIMIT = 256;
async function sweepStaleTemps(dir) {
    const sweepNow = Date.now();
    const lastSweep = sweptDirs.get(dir);
    if (lastSweep !== undefined && sweepNow - lastSweep < STALE_TEMP_MS)
        return;
    sweptDirs.delete(dir);
    sweptDirs.set(dir, sweepNow);
    if (sweptDirs.size > SWEPT_DIRS_LIMIT) {
        const oldest = sweptDirs.keys().next().value;
        if (oldest !== undefined)
            sweptDirs.delete(oldest);
    }
    try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isFile() || !TEMP_UUID_RE.test(entry.name))
                continue;
            const tempPath = join(dir, entry.name);
            try {
                const stats = await stat(tempPath);
                if (sweepNow - stats.mtimeMs > STALE_TEMP_MS) {
                    await rm(tempPath, { force: true });
                }
            }
            catch {
            }
        }
    }
    catch {
    }
}
async function syncDir(dir) {
    if (process.platform === "win32")
        return;
    try {
        const handle = await open(dir, "r");
        try {
            await handle.sync();
        }
        finally {
            await handle.close();
        }
    }
    catch {
    }
}
export async function resolveInCwd(path, cwd) {
    const absolute = toCwd(path, cwd);
    const resolved = await resolveTarget(absolute);
    return { absolute, resolved };
}
// OMA divergence (applied by scripts/vendor-pi-hashline.mjs; recorded
// under generated.divergences in manifest.json): the commit write and the
// verification re-read are injectable and fail-closed. The seam is one
// object -- reads and writes of the mutation target route together so a
// caller cannot split them across boundaries. Installed by the adapter at
// registration, after bundle verification. With no channel installed the
// seam refuses rather than falling back to upstream's readFile/writeAtomic:
// a missing channel means the contained boundary was never wired, and a
// silent fallback would read or write the mutation target outside it.
let omaCommitChannel;
/** Install OMA's commit channel: { read(path) -> utf8 text,
 * write(path, content, expectedIdentity) -> contained write }. Passing
 * undefined restores the fail-closed default. */
export function omaInstallCommitChannel(channel) {
    omaCommitChannel = channel;
}
function omaRequiredChannel() {
    if (omaCommitChannel === undefined)
        throw new Error("[E_OMA_NO_COMMIT_CHANNEL] no OMA commit channel is installed; refusing to read or write a mutation target outside the contained boundary");
    return omaCommitChannel;
}
export async function omaReadFileText(path) {
    return omaRequiredChannel().read(path);
}
export async function omaWriteCommit(path, content, expectedIdentity) {
    return omaRequiredChannel().write(path, content, expectedIdentity);
}
export async function writeAtomic(path, content, expectedIdentity, restoreMode) {
    // OMA divergence: direct writeAtomic use is confined to the bundle's
    // own state directory -- config.js writes configPath() under
    // configDir(), which the adapter redirects into OMA-owned space via
    // PI_HASHLINE_DIR. Mutation targets are the commit channel's domain,
    // so a direct writeAtomic call on anything else -- replace-undo.js's
    // undo write, were that tool ever registered -- refuses closed here
    // instead of writing uncontained.
    const omaStateDir = resolve(configDir());
    if (!resolve(path).startsWith(omaStateDir + sep))
        throw new Error(`[E_OMA_STATE_DOMAIN] writeAtomic serves the bundle's own state directory only; a mutation target goes through the OMA commit channel: ${path}`);
    const targetPath = await resolveTarget(path);
    let existingStats = null;
    try {
        existingStats = await stat(targetPath);
    }
    catch (error) {
        if (errCode(error) !== "ENOENT") {
            throw error;
        }
    }
    if (expectedIdentity && (!existingStats || !sameIdentity(existingStats, expectedIdentity))) {
        throw pathChanged(path);
    }
    if (existingStats && existingStats.nlink > 1) {
        const noFollow = process.platform === "win32" ? 0 : constants.O_NOFOLLOW;
        const handle = await open(targetPath, constants.O_WRONLY | noFollow);
        try {
            const openedStats = await handle.stat();
            if (!sameIdentity(openedStats, existingStats))
                throw pathChanged(path);
            await handle.writeFile(content, "utf-8");
            await handle.truncate(Buffer.byteLength(content, "utf-8"));
            try {
                await handle.chmod(existingStats.mode & 0o7777);
            }
            catch { }
            await handle.sync();
        }
        finally {
            await handle.close();
        }
        return;
    }
    const dir = dirname(targetPath);
    await sweepStaleTemps(dir);
    const tempPath = join(dir, `${TEMP_PREFIX}${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    const tempHandle = await open(tempPath, "wx", 0o600);
    try {
        await tempHandle.writeFile(content, "utf-8");
        const mode = existingStats ? existingStats.mode & 0o7777 : restoreMode;
        if (mode !== undefined) {
            try {
                await tempHandle.chmod(mode);
            }
            catch (error) {
                if (!isModeUnsupported(error))
                    throw error;
            }
        }
        await tempHandle.sync();
    }
    catch (error) {
        try {
            await tempHandle.close();
        }
        catch { }
        try {
            await rm(tempPath, { force: true });
        }
        catch { }
        throw error;
    }
    try {
        await tempHandle.close();
        try {
            const finalStats = await lstat(targetPath);
            if (!existingStats || finalStats.isSymbolicLink() || !sameIdentity(finalStats, existingStats)) {
                throw pathChanged(path);
            }
        }
        catch (error) {
            if (errCode(error) !== "ENOENT" || existingStats)
                throw error;
        }
        await rename(tempPath, targetPath);
        await syncDir(dir);
    }
    catch (error) {
        if (process.platform === "win32" && errCode(error) === "EPERM") {
            try {
                await writeFile(targetPath, content, "utf-8");
                return;
            }
            finally {
                try {
                    await rm(tempPath, { force: true });
                }
                catch { }
            }
        }
        try {
            await rm(tempPath, { force: true });
        }
        catch { }
        throw error;
    }
}
