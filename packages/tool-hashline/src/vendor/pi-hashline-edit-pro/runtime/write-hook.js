import { HASH_CLASS } from "./hashline/alphabet.js";
import { HASH_SEP } from "./hashline/hash.js";
import { servedForPath, withAnchorSession } from "./anchor-registry.js";
import { resolveInCwd } from "./fs-write.js";
import { abortIf, splitLines, isRec, normalizeFilePath } from "./utils.js";
const HASH_ECHO_RE = new RegExp(`^(?: *[0-9]+ ${HASH_SEP} )?[+ -]?(${HASH_CLASS})${HASH_SEP}`);
function searchEcho(lines, served) {
    for (let i = 0; i < lines.length; i++) {
        const match = HASH_ECHO_RE.exec(lines[i]);
        if (match && served.has(match[1]))
            return { line: i + 1, hash: match[1] };
    }
    return undefined;
}
export function findServedHashEcho(content, served) {
    return searchEcho(splitLines(content), served);
}
export async function servedHashEchoDenial(rawPath, content, cwd, signal) {
    abortIf(signal);
    const { resolved } = await resolveInCwd(rawPath, cwd);
    abortIf(signal);
    const served = servedForPath(resolved);
    if (!served || served.size === 0)
        return undefined;
    const echo = findServedHashEcho(content, served);
    if (!echo)
        return undefined;
    return `[E_WRITE_HASH_ECHO] Refused write to ${rawPath}: line ${echo.line} contains the copied ${echo.hash}${HASH_SEP} anchor served for this file. Remove the copied anchors and retry.`;
}
export function registerWriteHook(pi) {
    pi.on("tool_call", async (event, ctx) => withAnchorSession(ctx, async () => {
        if (event.toolName !== "write")
            return;
        const input = event.input;
        if (!input || !isRec(input))
            return;
        const normalized = { ...input };
        normalizeFilePath(normalized);
        const rawPath = normalized.path;
        const content = normalized.content;
        if (typeof rawPath !== "string" || typeof content !== "string")
            return;
        const signal = ctx.signal;
        try {
            const reason = await servedHashEchoDenial(rawPath, content, ctx.cwd, signal);
            if (reason !== undefined)
                return { block: true, reason };
        }
        catch (error) {
            if (signal?.aborted)
                throw error;
            console.error("write hook failed:", error);
        }
        return;
    }));
}
