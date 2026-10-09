import { lookup as dnsLookup } from "node:dns/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import net from "node:net";
import { getActiveProxy, getWebSearchConfigPath, hasScopedProxyDecision, isProxyBypassedUrl, loadConfiguredProxy, normalizeProxyUrl, omaEgressPinnedProxy, omaWebPolicy } from "./utils.js";
const DEFAULT_MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const LOOPBACK_ALLOW_RANGES = ["127.0.0.0/8", "::1", "::ffff:127.0.0.0/104"];
// Proxy schemes where the proxy, not curl, resolves the target hostname.
const REMOTE_DNS_PROXY_PROTOCOLS = new Set(["http:", "https:", "socks4a:", "socks5h:"]);
const WEB_SEARCH_CONFIG_PATH = getWebSearchConfigPath();
let cachedConfigRoot = null;
function loadConfigRoot() {
    if (!existsSync(WEB_SEARCH_CONFIG_PATH))
        return null;
    let signature;
    try {
        const stat = statSync(WEB_SEARCH_CONFIG_PATH);
        signature = `${stat.mtimeMs}:${stat.size}`;
    }
    catch {
        return null;
    }
    if (cachedConfigRoot?.signature === signature)
        return cachedConfigRoot.value;
    let raw;
    try {
        raw = readFileSync(WEB_SEARCH_CONFIG_PATH, "utf-8");
    }
    catch {
        // Do not memoize read failures: a chmod fix changes neither mtime nor size,
        // so a cached failure would permanently fail-open the domain policy.
        return null;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to parse ${WEB_SEARCH_CONFIG_PATH}: ${message}`);
    }
    const value = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : null;
    cachedConfigRoot = { signature, value };
    return value;
}
const DEFAULT_DOMAIN_POLICY = { allow: [], deny: [] };
export function loadFetchContentDomainPolicy() {
    const parsed = loadConfigRoot();
    if (!parsed)
        return { ...DEFAULT_DOMAIN_POLICY };
    const fetchContent = parsed.fetchContent;
    if (fetchContent === undefined || fetchContent === null)
        return { ...DEFAULT_DOMAIN_POLICY };
    if (typeof fetchContent !== "object" || Array.isArray(fetchContent)) {
        throw new Error(`fetchContent in ${WEB_SEARCH_CONFIG_PATH} must be an object`);
    }
    const policy = fetchContent.domainPolicy;
    if (policy === undefined || policy === null)
        return { ...DEFAULT_DOMAIN_POLICY };
    if (typeof policy !== "object" || Array.isArray(policy)) {
        throw new Error(`fetchContent.domainPolicy in ${WEB_SEARCH_CONFIG_PATH} must be an object`);
    }
    const config = policy;
    return {
        allow: parseDomainEntries(config.allow, "allow"),
        deny: parseDomainEntries(config.deny, "deny"),
    };
}
function parseDomainEntries(value, field) {
    if (value === undefined || value === null)
        return [];
    if (!Array.isArray(value)) {
        throw new Error(`fetchContent.domainPolicy.${field} in ${WEB_SEARCH_CONFIG_PATH} must be an array of hostnames`);
    }
    return value.map((entry, index) => {
        if (typeof entry !== "string") {
            throw new Error(`fetchContent.domainPolicy.${field} in ${WEB_SEARCH_CONFIG_PATH} must contain only hostnames; entry ${index + 1} is ${typeof entry}`);
        }
        const hostname = normalizeDomainEntry(entry);
        if (!hostname) {
            throw new Error(`fetchContent.domainPolicy.${field} in ${WEB_SEARCH_CONFIG_PATH} contains an invalid hostname: ${JSON.stringify(entry)}`);
        }
        return hostname;
    });
}
function normalizeDomainEntry(entry) {
    const hostname = normalizeHostname(entry.trim());
    if (!hostname || /\s|[\\/?:#@]/.test(hostname))
        return null;
    if (net.isIP(hostname))
        return hostname;
    if (hostname.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(hostname))
        return null;
    return hostname;
}
export function loadSsrfConfig() {
    const parsed = loadConfigRoot();
    if (!parsed)
        return { allowRanges: [], trustEnvProxy: false };
    const ssrf = parsed.ssrf;
    if (ssrf === undefined || ssrf === null)
        return { allowRanges: [], trustEnvProxy: false };
    if (typeof ssrf !== "object" || Array.isArray(ssrf)) {
        throw new Error(`ssrf in ${WEB_SEARCH_CONFIG_PATH} must be an object`);
    }
    const config = ssrf;
    if (config.allowRanges !== undefined && config.allowRanges !== null && !Array.isArray(config.allowRanges)) {
        throw new Error(`ssrf.allowRanges in ${WEB_SEARCH_CONFIG_PATH} must be an array of CIDR strings`);
    }
    if (config.trustEnvProxy !== undefined && typeof config.trustEnvProxy !== "boolean") {
        throw new Error(`ssrf.trustEnvProxy in ${WEB_SEARCH_CONFIG_PATH} must be a boolean`);
    }
    const allowRangesValue = Array.isArray(config.allowRanges) ? config.allowRanges : [];
    const allowRanges = allowRangesValue.map((entry, index) => {
        if (typeof entry !== "string") {
            throw new Error(`ssrf.allowRanges in ${WEB_SEARCH_CONFIG_PATH} must contain only CIDR strings; entry ${index + 1} is ${typeof entry}`);
        }
        return entry.trim();
    }).filter(Boolean);
    parseAllowRanges(allowRanges);
    return { allowRanges, trustEnvProxy: config.trustEnvProxy === true };
}
async function defaultLookup(hostname) {
    return dnsLookup(hostname, { all: true, verbatim: true });
}
export async function validateRemoteUrl(rawUrl, options = {}) {
    const url = rawUrl instanceof URL ? rawUrl : new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Only HTTP and HTTPS URLs can be fetched remotely");
    }
    const hostname = normalizeHostname(url.hostname);
    if (!hostname)
        throw new Error("URL must include a hostname");
    // The Human authorized full network access, including local development services.
    // Keep URL grammar and the Human's explicit domain policy on every redirect.
    if (omaWebPolicy() !== undefined) {
        assertDomainPolicy(hostname, options.domainPolicy);
        return url;
    }
    if (hostname === "localhost") {
        if (options.allowLoopback === true)
            return url;
        throw new Error(`Blocked internal hostname: ${hostname}`);
    }
    if (hostname.endsWith(".localhost")) {
        throw new Error(`Blocked internal hostname: ${hostname}`);
    }
    const allowRanges = parseAllowRanges(options.allowRanges);
    assertDomainPolicy(hostname, options.domainPolicy);
    if (net.isIP(hostname)) {
        const addressAllowRanges = options.allowLoopback === true
            ? [...allowRanges, ...parseAllowRanges(LOOPBACK_ALLOW_RANGES)]
            : allowRanges;
        assertPublicAddress(hostname, hostname, addressAllowRanges);
        return url;
    }
    // OMA divergence: an installed egress pin means the env proxy is
    // the route — trust it for hostname resolution the way upstream
    // trusts a configured remote-DNS proxy.
    const trustProxy = options.trustEnvProxy === true || omaEgressPinnedProxy() !== null;
    const proxy = options.proxy !== undefined
        ? normalizeProxyUrl(options.proxy, "proxy")
        : hasScopedProxyDecision() ? getActiveProxy() : undefined;
    if (proxy === undefined ? shouldTrustEnvProxy(url, trustProxy) : trustProxy && isConfiguredRemoteDnsProxy(url, proxy))
        return url;
    let addresses;
    try {
        addresses = await (options.lookup ?? defaultLookup)(hostname);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const hint = !trustProxy && proxy && isConfiguredRemoteDnsProxy(url, proxy)
            ? ". If your configured proxy resolves hostnames, set ssrf.trustEnvProxy to true in web-search.json."
            : "";
        throw new Error(`Failed to resolve ${hostname}: ${message}${hint}`);
    }
    if (addresses.length === 0)
        throw new Error(`Failed to resolve ${hostname}: no addresses returned`);
    for (const { address } of addresses) {
        assertPublicAddress(address, hostname, allowRanges);
    }
    return url;
}
export async function fetchRemoteUrl(url, init = {}, options = {}) {
    const fetchImpl = options.fetch ?? fetch;
    const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
    let current = await validateRemoteUrl(url, options);
    const configuredOrigin = current.origin;
    let requestInit = init;
    for (let redirects = 0; redirects <= maxRedirects; redirects++) {
        const response = await fetchImpl(current, { ...requestInit, redirect: "manual" });
        if (!REDIRECT_STATUSES.has(response.status))
            return response;
        const location = response.headers.get("location");
        if (!location)
            return response;
        if (redirects === maxRedirects)
            throw new Error(`Too many redirects fetching ${current.toString()}`);
        const from = current;
        const next = new URL(location, current);
        // allowLoopback exempts an explicitly configured endpoint, never a redirect target: a loopback
        // base must not be able to pivot the request onto a different loopback origin.
        current = await validateRemoteUrl(next, next.origin === configuredOrigin ? options : { ...options, allowLoopback: false });
        if (response.status === 303 || ((response.status === 301 || response.status === 302) && requestInit.method?.toUpperCase() === "POST")) {
            const { body: _body, ...nextInit } = requestInit;
            requestInit = { ...nextInit, method: "GET" };
        }
        if (options.onRedirect)
            requestInit = options.onRedirect({ from, to: current, init: requestInit, response });
    }
    throw new Error(`Too many redirects fetching ${current.toString()}`);
}
function normalizeHostname(hostname) {
    return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}
function assertDomainPolicy(hostname, policy) {
    if (!policy)
        return;
    if (policy.deny.some((entry) => domainMatches(hostname, entry))) {
        throw new Error(`Blocked hostname by fetch_content domain policy: ${hostname}`);
    }
    if (policy.allow.length > 0 && !policy.allow.some((entry) => domainMatches(hostname, entry))) {
        throw new Error(`Hostname not allowed by fetch_content domain policy: ${hostname}`);
    }
}
function domainMatches(hostname, entry) {
    return hostname === entry || hostname.endsWith(`.${entry}`);
}
function getProxyForProtocol(protocol) {
    const candidates = protocol === "http:"
        ? [process.env.HTTP_PROXY, process.env.http_proxy, process.env.ALL_PROXY, process.env.all_proxy]
        : protocol === "https:"
            ? [process.env.HTTPS_PROXY, process.env.https_proxy, process.env.HTTP_PROXY, process.env.http_proxy, process.env.ALL_PROXY, process.env.all_proxy]
            : [];
    for (const candidate of candidates) {
        const value = candidate?.trim();
        if (!value)
            continue;
        try {
            const proxyUrl = new URL(value);
            if ((proxyUrl.protocol === "http:" || proxyUrl.protocol === "https:") && proxyUrl.hostname)
                return value;
        }
        catch {
            // Invalid proxy env vars should not weaken local DNS SSRF checks.
        }
    }
    return "";
}
function hostnameMatchesNoProxy(hostname, port, entry) {
    const trimmed = entry.trim();
    if (!trimmed)
        return false;
    if (trimmed === "*")
        return true;
    // NO_PROXY entries may include a port. Strip it only after handling
    // bracketed IPv6 literals, which can contain several colons.
    let hostEntry = trimmed;
    let entryPort;
    if (hostEntry.startsWith("[")) {
        const closingBracket = hostEntry.indexOf("]");
        if (closingBracket >= 0) {
            const suffix = hostEntry.slice(closingBracket + 1);
            if (/^:\\d+$/.test(suffix))
                entryPort = suffix.slice(1);
            hostEntry = hostEntry.slice(0, closingBracket + 1);
        }
    }
    else {
        const colon = hostEntry.lastIndexOf(":");
        if (colon > -1 && /^\d+$/.test(hostEntry.slice(colon + 1))) {
            entryPort = hostEntry.slice(colon + 1);
            hostEntry = hostEntry.slice(0, colon);
        }
    }
    if (entryPort !== undefined && entryPort !== port)
        return false;
    const normalizedEntry = normalizeHostname(hostEntry);
    if (!normalizedEntry)
        return false;
    if (normalizedEntry === hostname)
        return true;
    const suffix = normalizedEntry.startsWith("*.")
        ? normalizedEntry.slice(1)
        : normalizedEntry.startsWith(".")
            ? normalizedEntry
            : `.${normalizedEntry}`;
    return hostname.endsWith(suffix);
}
function shouldTrustEnvProxy(url, enabled) {
    if (!enabled || !getProxyForProtocol(url.protocol))
        return false;
    const hostname = normalizeHostname(url.hostname);
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    const noProxy = process.env.NO_PROXY || process.env.no_proxy || "";
    return !noProxy.split(",").some(entry => hostnameMatchesNoProxy(hostname, port, entry));
}
/** Only the operator's configured proxy qualifies: a model-supplied per-call proxy must not skip DNS validation. */
function isConfiguredRemoteDnsProxy(url, proxy) {
    return proxy !== null &&
        REMOTE_DNS_PROXY_PROTOCOLS.has(new URL(proxy).protocol) &&
        !isProxyBypassedUrl(url) &&
        // OMA divergence: under an installed policy the egress pin is the
        // one proxy normalizeProxyUrl will ever pass, so it is "the
        // configured proxy" for the remote-DNS skip.
        proxy === (omaEgressPinnedProxy() ?? loadConfiguredProxy());
}
function assertPublicAddress(address, hostname, allowRanges = []) {
    const normalized = normalizeHostname(address);
    const ipVersion = net.isIP(normalized);
    if (ipVersion === 0)
        throw new Error(`Resolved non-IP address for ${hostname}: ${address}`);
    // Explicitly-allowed ranges bypass the private/reserved checks below. This lets
    // users exempt synthetic ranges produced by TUN/fake-IP proxies (e.g. 198.18/15).
    if (isInAllowedRange(normalized, ipVersion, allowRanges))
        return;
    if (ipVersion === 4 && isBlockedIPv4(normalized)) {
        const hint = isFakeIpProxyAddress(normalized)
            ? '. This address is in 198.18.0.0/15, commonly used by TUN/fake-IP proxies. If that matches your setup, configure ssrf.allowRanges with ["198.18.0.0/15"] in web-search.json.'
            : "";
        throw new Error(`Blocked internal address for ${hostname}: ${normalized}${hint}`);
    }
    if (ipVersion === 6 && isBlockedIPv6(normalized)) {
        throw new Error(`Blocked internal address for ${hostname}: ${normalized}`);
    }
}
function isFakeIpProxyAddress(address) {
    const [a, b] = address.split(".").map(part => Number(part));
    return a === 198 && (b === 18 || b === 19);
}
function isBlockedIPv4(address) {
    const parts = address.split(".").map(part => Number(part));
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255))
        return true;
    const [a, b] = parts;
    return a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        isFakeIpProxyAddress(address) ||
        a >= 224;
}
function isBlockedIPv6(address) {
    const groups = parseIPv6(address);
    if (!groups)
        return true;
    const first = groups[0];
    if (groups.every(group => group === 0))
        return true;
    if (groups.slice(0, 7).every(group => group === 0) && groups[7] === 1)
        return true;
    if ((first & 0xfe00) === 0xfc00)
        return true;
    if ((first & 0xffc0) === 0xfe80)
        return true;
    const isMappedIPv4 = groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff;
    if (isMappedIPv4) {
        const ipv4 = [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
        return isBlockedIPv4(ipv4);
    }
    return false;
}
function parseIPv6(address) {
    if (address.includes(".")) {
        const lastColon = address.lastIndexOf(":");
        const ipv4 = address.slice(lastColon + 1);
        if (net.isIP(ipv4) !== 4)
            return null;
        const octets = ipv4.split(".").map(part => Number(part));
        address = `${address.slice(0, lastColon)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
    }
    const pieces = address.split("::");
    if (pieces.length > 2)
        return null;
    const left = pieces[0] ? pieces[0].split(":") : [];
    const right = pieces.length === 2 && pieces[1] ? pieces[1].split(":") : [];
    const missing = 8 - left.length - right.length;
    if (pieces.length === 1 && missing !== 0)
        return null;
    if (pieces.length === 2 && missing < 0)
        return null;
    const groups = [...left, ...Array(missing).fill("0"), ...right].map(part => {
        if (!/^[0-9a-f]{1,4}$/i.test(part))
            return -1;
        return parseInt(part, 16);
    });
    return groups.length === 8 && groups.every(group => group >= 0 && group <= 0xffff) ? groups : null;
}
/** Parse `allowRanges` config value into validated CIDR rules. Throws on malformed entries. */
function parseAllowRanges(input) {
    if (input === undefined || input === null)
        return [];
    if (!Array.isArray(input)) {
        throw new Error("ssrf.allowRanges must be an array of CIDR strings");
    }
    const rules = [];
    for (const entry of input) {
        if (typeof entry !== "string") {
            throw new Error(`ssrf.allowRanges entries must be strings, got ${typeof entry}`);
        }
        const rule = parseCidr(entry.trim());
        if (!rule) {
            throw new Error(`Invalid CIDR notation in ssrf.allowRanges: "${entry}"`);
        }
        rules.push(rule);
    }
    return rules;
}
/** Parse a single CIDR (e.g. "198.18.0.0/15", "fd00::/8") or bare host ("1.2.3.4"). Returns null if invalid. */
function parseCidr(raw) {
    if (!raw)
        return null;
    const slash = raw.lastIndexOf("/");
    const addrPart = slash >= 0 ? raw.slice(0, slash) : raw;
    const prefixPart = slash >= 0 ? raw.slice(slash + 1) : null;
    // A slash must be followed by digits. Number("")/Number(" ") are 0, which
    // would silently turn "198.18.0.0/" into /0 and exempt every address.
    if (prefixPart !== null && !/^\d+$/.test(prefixPart))
        return null;
    const version = net.isIP(addrPart);
    if (version === 4) {
        const bytes = ipv4ToBytes(addrPart);
        if (!bytes)
            return null;
        const prefix = prefixPart === null ? 32 : Number(prefixPart);
        if (!Number.isInteger(prefix) || prefix < 1 || prefix > 32)
            return null;
        return { bytes, prefix };
    }
    if (version === 6) {
        const groups = parseIPv6(addrPart);
        if (!groups)
            return null;
        const prefix = prefixPart === null ? 128 : Number(prefixPart);
        if (!Number.isInteger(prefix) || prefix < 1 || prefix > 128)
            return null;
        return { bytes: ipv6GroupsToBytes(groups), prefix };
    }
    return null;
}
function ipv4ToBytes(address) {
    const parts = address.split(".");
    if (parts.length !== 4)
        return null;
    const bytes = new Uint8Array(4);
    for (let i = 0; i < 4; i++) {
        const octet = Number(parts[i]);
        if (!Number.isInteger(octet) || octet < 0 || octet > 255)
            return null;
        bytes[i] = octet;
    }
    return bytes;
}
function ipv6GroupsToBytes(groups) {
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 8; i++) {
        bytes[i * 2] = groups[i] >> 8;
        bytes[i * 2 + 1] = groups[i] & 0xff;
    }
    return bytes;
}
function ipToBytes(address, version) {
    if (version === 4)
        return ipv4ToBytes(address);
    if (version === 6) {
        const groups = parseIPv6(address);
        return groups ? ipv6GroupsToBytes(groups) : null;
    }
    return null;
}
/** True if `address` (already validated as `ipVersion`) falls within any allowed CIDR. */
function isInAllowedRange(address, ipVersion, allowRanges) {
    if (allowRanges.length === 0)
        return false;
    const addrBytes = ipToBytes(address, ipVersion);
    if (!addrBytes)
        return false;
    for (const rule of allowRanges) {
        // Only compare same-family rules (4-byte IPv4 vs 16-byte IPv6).
        if (rule.bytes.length !== addrBytes.length)
            continue;
        if (bytesMatchPrefix(addrBytes, rule.bytes, rule.prefix))
            return true;
    }
    return false;
}
/** Compare the leading `prefix` bits of two equal-length byte arrays. */
function bytesMatchPrefix(addr, network, prefix) {
    const fullBytes = prefix >> 3;
    const remBits = prefix & 7;
    for (let i = 0; i < fullBytes; i++) {
        if (addr[i] !== network[i])
            return false;
    }
    if (remBits > 0 && fullBytes < addr.length) {
        const mask = (0xff << (8 - remBits)) & 0xff;
        if ((addr[fullBytes] & mask) !== (network[fullBytes] & mask))
            return false;
    }
    return true;
}
