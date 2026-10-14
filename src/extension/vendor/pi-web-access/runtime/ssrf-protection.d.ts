export type LookupAddress = {
    address: string;
    family: number;
};
export type Lookup = (hostname: string) => Promise<LookupAddress[]>;
type Fetch = typeof fetch;
export interface SsrfConfig {
    allowRanges: string[];
    trustEnvProxy: boolean;
}
export interface DomainPolicy {
    allow: string[];
    deny: string[];
}
export declare function loadFetchContentDomainPolicy(): DomainPolicy;
export declare function loadSsrfConfig(): SsrfConfig;
interface ValidationOptions {
    lookup?: Lookup;
    /** Optional hostname policy for fetch_content target URLs. */
    domainPolicy?: DomainPolicy;
    /**
     * CIDR ranges (e.g. "198.18.0.0/15") to exempt from the SSRF guard.
     * Useful when a host runs a TUN/fake-IP proxy (Surge, Clash, Mihomo, ...)
     * that resolves public domains into a reserved range. Entries are validated
     * strictly; an invalid entry throws so misconfiguration is not silent.
     */
    allowRanges?: string[];
    /**
     * When true, let the proxy carrying the request resolve hostnames instead of
     * performing local DNS lookups: an HTTP(S) proxy from the environment, or the
     * `proxy` configured in web-search.json. A different per-call proxy never
     * qualifies. Literal IPs and localhost remain blocked, and NO_PROXY hosts still
     * use the local SSRF preflight. This does not configure proxy transport.
     */
    trustEnvProxy?: boolean;
    /** Proxy pinned on the request via `__proxy`; defaults to the scoped proxy, like the transport. */
    proxy?: string;
    /** Allow loopback URLs for explicit provider base endpoints, not fetched targets. */
    allowLoopback?: boolean;
}
interface RedirectRequestInitArgs {
    from: URL;
    to: URL;
    init: RequestInit;
    response: Response;
}
interface FetchRemoteOptions extends ValidationOptions {
    fetch?: Fetch;
    maxRedirects?: number;
    onRedirect?: (args: RedirectRequestInitArgs) => RequestInit;
}
export declare function validateRemoteUrl(rawUrl: string | URL, options?: ValidationOptions): Promise<URL>;
export declare function fetchRemoteUrl(url: string | URL, init?: RequestInit, options?: FetchRemoteOptions): Promise<Response>;
export {};
