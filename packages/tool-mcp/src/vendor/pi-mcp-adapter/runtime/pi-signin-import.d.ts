import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type AuthEntry, type AuthStorageOptions } from "./mcp-auth.js";
import { type McpConfig } from "./types.js";
interface PiSignInImport {
    serverName: string;
    serverUrl: string;
    /** Normalized URL, the key in Pi's file. */
    url: string;
    entry: AuthEntry;
}
/** Servers that can import Pi's sign-in now: matched in Pi's file, with no adapter credentials for that URL. */
export declare function findPiSignInImports(config: McpConfig, authStorageOptions: AuthStorageOptions): PiSignInImport[];
/** Saves Pi's sign-in; returns false, saving nothing, when adapter credentials for the URL exist by now. */
export declare function importPiSignIn(candidate: PiSignInImport, authStorageOptions: AuthStorageOptions): boolean;
/**
 * Asks once per server and URL whether to import Pi's sign-in. Interactive sessions only;
 * "Sign in again" leaves everything as it is, so the user signs in later with /mcp-auth.
 */
export declare function offerPiSignInImports(ctx: Pick<ExtensionContext, "hasUI" | "ui" | "cwd">, config: McpConfig, signal?: AbortSignal): Promise<void>;
export {};
