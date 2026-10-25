import { readFileSync } from "node:fs";
import { getPiMcpAuthPath, isPiMcpConfigEnabled } from "./config.js";
import { supportsOAuth } from "./mcp-auth-flow.js";
import { getAuthStorageOptions, inspectAuthForUrl, saveAuthEntry } from "./mcp-auth.js";
import { loadOnboardingState, markPiSignInImportAsked } from "./onboarding-state.js";
import { isServerDisabled } from "./types.js";
import { resolveServerUrl, sanitizeTerminalText } from "./utils.js";
const IMPORT_CHOICE = "Import sign-in";
const SIGN_IN_AGAIN_CHOICE = "Sign in again";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function optional(value, type) {
    return value === undefined || typeof value === type;
}
/** Only `tokens` and `clientInformation` are taken; Pi's PKCE verifier and state are never copied. */
function toAuthEntry(value) {
    if (!isRecord(value) || !isRecord(value.tokens))
        return undefined;
    const { access_token, refresh_token, scope } = value.tokens;
    if (typeof access_token !== "string" || !access_token)
        return undefined;
    if (!optional(refresh_token, "string") || !optional(scope, "string") || !optional(value.tokensExpireAt, "number"))
        return undefined;
    const entry = {
        tokens: {
            accessToken: access_token,
            ...(typeof refresh_token === "string" ? { refreshToken: refresh_token } : {}),
            // Pi stores the expiry in milliseconds; the adapter in seconds.
            ...(typeof value.tokensExpireAt === "number" ? { expiresAt: value.tokensExpireAt / 1000 } : {}),
            ...(typeof scope === "string" ? { scope } : {}),
        },
    };
    if (value.clientInformation === undefined)
        return entry;
    const client = value.clientInformation;
    if (!isRecord(client) || typeof client.client_id !== "string"
        || !optional(client.client_secret, "string")
        || !optional(client.client_id_issued_at, "number")
        || !optional(client.client_secret_expires_at, "number")
        || !(client.redirect_uris === undefined || (Array.isArray(client.redirect_uris) && client.redirect_uris.every((uri) => typeof uri === "string")))) {
        return undefined;
    }
    const clientInfo = {
        clientId: client.client_id,
        ...(typeof client.client_secret === "string" ? { clientSecret: client.client_secret } : {}),
        ...(typeof client.client_id_issued_at === "number" ? { clientIdIssuedAt: client.client_id_issued_at } : {}),
        ...(typeof client.client_secret_expires_at === "number" ? { clientSecretExpiresAt: client.client_secret_expires_at } : {}),
        ...(client.redirect_uris !== undefined ? { redirectUris: client.redirect_uris } : {}),
    };
    return { ...entry, clientInfo };
}
/** Configured OAuth servers whose exact URL has a usable sign-in in Pi's file. Malformed files and entries are skipped. */
function matchPiSignIns(config, authStorageOptions) {
    if (!isPiMcpConfigEnabled() || authStorageOptions.credentialStore === "encrypted-file")
        return [];
    let stored;
    try {
        stored = JSON.parse(readFileSync(getPiMcpAuthPath(), "utf-8"));
    }
    catch {
        return [];
    }
    if (!isRecord(stored))
        return [];
    const matches = [];
    for (const [serverName, definition] of Object.entries(config.mcpServers)) {
        if (isServerDisabled(definition) || !supportsOAuth(definition))
            continue;
        if (definition.oauth && definition.oauth.grantType === "client_credentials")
            continue;
        let serverUrl;
        try {
            serverUrl = resolveServerUrl(definition);
        }
        catch {
            continue;
        }
        if (!serverUrl)
            continue;
        const url = String(new URL(serverUrl));
        if (!Object.hasOwn(stored, url))
            continue;
        const entry = toAuthEntry(stored[url]);
        if (entry)
            matches.push({ serverName, serverUrl, url, entry });
    }
    return matches;
}
/** Servers that can import Pi's sign-in now: matched in Pi's file, with no adapter credentials for that URL. */
export function findPiSignInImports(config, authStorageOptions) {
    return matchPiSignIns(config, authStorageOptions)
        .filter((candidate) => inspectAuthForUrl(candidate.serverName, candidate.serverUrl, authStorageOptions).status === "absent");
}
/** Saves Pi's sign-in; returns false, saving nothing, when adapter credentials for the URL exist by now. */
export function importPiSignIn(candidate, authStorageOptions) {
    // Checked again at save time: another session can sign in while the prompt waits.
    const current = inspectAuthForUrl(candidate.serverName, candidate.serverUrl, authStorageOptions);
    if (current.status === "unavailable")
        throw new Error(current.message);
    if (current.status === "present")
        return false;
    saveAuthEntry(candidate.serverName, candidate.entry, candidate.serverUrl, authStorageOptions);
    return true;
}
/**
 * Asks once per server and URL whether to import Pi's sign-in. Interactive sessions only;
 * "Sign in again" leaves everything as it is, so the user signs in later with /mcp-auth.
 */
export async function offerPiSignInImports(ctx, config, signal) {
    if (!ctx.hasUI)
        return;
    const authStorageOptions = getAuthStorageOptions(config.settings?.oauthDir, ctx.cwd, config.settings?.oauthCredentialStore);
    const asked = loadOnboardingState().piSignInImportsAsked ?? [];
    const candidates = matchPiSignIns(config, authStorageOptions)
        .filter((candidate) => !asked.some((entry) => entry.server === candidate.serverName && entry.url === candidate.url))
        .filter((candidate) => inspectAuthForUrl(candidate.serverName, candidate.serverUrl, authStorageOptions).status === "absent");
    for (const candidate of candidates) {
        const name = sanitizeTerminalText(candidate.serverName);
        const choice = await ctx.ui.select([
            `Pi's built-in MCP is signed in to "${name}" (${sanitizeTerminalText(candidate.url)}). Import it, or sign in again with /mcp-auth ${name}.`,
            "If the server rotates refresh tokens, the adapter's first refresh can sign Pi's `pi mcp` commands out.",
        ].join("\n"), [IMPORT_CHOICE, SIGN_IN_AGAIN_CHOICE], signal ? { signal } : undefined);
        if (signal?.aborted)
            return;
        if (choice !== IMPORT_CHOICE) {
            markPiSignInImportAsked(candidate.serverName, candidate.url);
            continue;
        }
        try {
            const imported = importPiSignIn(candidate, authStorageOptions);
            markPiSignInImportAsked(candidate.serverName, candidate.url);
            ctx.ui.notify(imported ? `Imported Pi's sign-in for ${name}.` : `"${name}" is already signed in with the adapter; nothing imported.`, "info");
        }
        catch (error) {
            const message = sanitizeTerminalText(error instanceof Error ? error.message : String(error));
            ctx.ui.notify(`Could not import Pi's sign-in for ${name}: ${message}`, "error");
        }
    }
}
