/** OMA divergence: mirrors the utils.js re-export — the vendored
 * undici's dispatcher surface so the adapter installs the egress agent
 * without an import specifier into the bundle's node_modules. */
export { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
export declare function getWebSearchConfigDir(): string;
export declare function getWebSearchConfigPath(): string;
interface ApiBaseUrlOptions {
    configKey: string;
    configuredValue: unknown;
    defaultValue: string;
    environmentKey: string;
    environmentValue: string | undefined;
}
export declare function isLoopbackHostname(hostnameValue: string): boolean;
export declare function resolveApiBaseUrl(options: ApiBaseUrlOptions): string;
export declare function fetchWithCredentialRedirects(url: string, init: RequestInit, credentialHeaders: readonly string[]): Promise<Response>;
export interface CuratorNetworkConfig {
    /** Whether remote access was opted into via curatorRemote. */
    enabled: boolean;
    host: string;
    bind: string;
}
/** Resolves the curator server bind address and URL host from `curatorRemote`. */
export declare function resolveCuratorNetworkConfig(): CuratorNetworkConfig;
export declare function formatSeconds(s: number): string;
export declare function readExecError(err: unknown): {
    code?: string;
    stderr: string;
    message: string;
};
export declare function isTimeoutError(err: unknown): boolean;
export declare function trimErrorText(text: string): string;
export declare function mapFfmpegError(err: unknown): string;
/** OMA divergence: the web policy the adapter installs before the
 * vendored extension factory runs. */
export interface OmaWebPolicy {
    /** The deployment's egress pin (the loopback CONNECT forwarder URL),
     * or null when no proxy value is permitted at all. */
    readonly egressPinned: string | null;
    /** Deny-by-default ambient-discovery permits; all unset under
     * Society's install. */
    readonly credentialCommands?: boolean;
    readonly browserCookies?: boolean;
    readonly ghCli?: boolean;
    readonly gitClone?: boolean;
    readonly geminiAdc?: boolean;
    readonly nativeMedia?: boolean;
    readonly localFileFetch?: boolean;
    readonly workflows?: boolean;
}
export declare function omaInstallWebPolicy(policy: OmaWebPolicy | undefined): void;
export declare function omaWebPolicy(): OmaWebPolicy | undefined;
export declare function omaPermits(flag: keyof OmaWebPolicy & string): boolean;
export declare function omaEgressPinnedProxy(): string | null;
export declare function normalizeProxyUrl(value: unknown, source: string): string | null;
export declare function loadConfiguredProxy(): string | null;
export declare function runWithProxy<T>(proxy: string | undefined, fn: () => T): T;
export declare function getActiveProxy(): string | null;
export declare function hasScopedProxyDecision(): boolean;
/** True when a URL must NOT be sent through the active proxy. */
export declare function isProxyBypassedUrl(url: URL): boolean;
export interface ProxiedRequestInit extends RequestInit {
    /** Caller-supplied proxy; bypasses AsyncLocalStorage for pLimit-safe contexts. */
    __proxy?: string;
}
/** Wraps globalThis.fetch so every http(s) call routes through curl while a proxy is active. Idempotent. */
export declare function installGlobalProxyFetch(): void;
export {};
