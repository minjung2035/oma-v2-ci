/** Deny-by-default child-process environment for vendored extensions that
 * spawn children — the shared predicate both the pi-lsp boundary
 * (lsp-tools.ts) and the pi-mcp-adapter boundary (mcp-tools.ts) build
 * their child environments from.
 *
 * The boundary is an allowlist: a name reaches the child only through the
 * named allowlist, the `LC_*` prefix grant or — for the four proxy
 * spellings — only when its value is the sandbox's own injected loopback
 * pin byte-for-byte. Everything else — credentials, loader preloads,
 * toolchain config, session/IPC authority, OMA/PI wiring — is denied by
 * absence, not emptied: loaders treat empty path-list elements as the
 * current directory (`LD_LIBRARY_PATH=""` searches the workspace), so an
 * empty-string tombstone would still be a channel.
 *
 * HOME, the XDG homes and the temp names are deliberately not in the
 * allowlist: they are never inherited — the caller's per-call scratch
 * supplies them (see `childEnvScratchEntries`) so a server's user-level
 * caches land where OMA removes them. */
import { isAbsolute } from "node:path";

/** The named allowlist, lowercased: PATH (the engine's or the config's
 * declared one), locale/terminal identity (`LANG`, `LANGUAGE`, `TZ`,
 * `TERM`, `NO_COLOR`), login identity, Windows process plumbing
 * (`SYSTEMROOT`, `WINDIR`, `SYSTEMDRIVE`, `COMSPEC`, `PATHEXT`). */
export const OMA_CHILD_ENV_ALLOW: ReadonlySet<string> = new Set([
  "path",
  "lang", "language", "tz", "term", "no_color",
  "user", "logname", "username",
  "systemroot", "windir", "systemdrive", "comspec", "pathext",
]);

/** The one name prefix the allowlist grants: `LC_*` locale-category
 * overrides (`LC_ALL`, `LC_CTYPE`, ...). The LC_ namespace carries
 * locale names -- values are guarded below -- so a prefix is honest
 * where an enumeration would silently miss a category. */
export const OMA_CHILD_ENV_PREFIXES: ReadonlyArray<string> = ["lc_"];

/** Allowlist names whose values are paths or path-shaped by definition;
 * every other admitted name gets the token guard below. */
const CHILD_ENV_PATH_TYPED: ReadonlySet<string> = new Set([
  "path", "systemroot", "windir", "systemdrive", "comspec",
]);

/** A `/`, `\` or NUL inside a token value is a path channel wearing a
 * locale or identity name: glibc resolves `LC_*`/`LANG` values as locale
 * files, ncurses resolves `TERM` under its terminfo dirs, and a child
 * building paths from `USER` inherits whatever it was handed. `tz`
 * legitimately carries `Area/City` zone names, so only absolute paths,
 * the `:`-prefixed implementation form and parent traversal are refused
 * for it. `..` and NUL are refused for every token. */
function tokenValueAllowed(lower: string, value: string): boolean {
  if (value.includes("\0") || value.includes("..")) return false;
  if (lower === "tz") return !value.startsWith("/") && !value.startsWith(":");
  return !value.includes("/") && !value.includes("\\");
}

/** The proxy names OMA's Resident sandbox injects (pi-spawn-plan.ts),
 * lowercased -- the only `*_proxy` spellings a child may carry, and then
 * only the value `egressProxyValue` reproduces. */
const CHILD_PROXY_NAMES: ReadonlySet<string> = new Set([
  "http_proxy", "https_proxy", "all_proxy", "no_proxy",
]);

/** The one value a proxy var may carry: the Resident sandbox's own
 * injected loopback, recomputed from the engine's egress wiring. The
 * spawn plan's injection is `http://127.0.0.1:<OMA_EGRESS_PROXY_PORT>`
 * and a fixed `no_proxy` literal, and it exists only beside
 * `OMA_EGRESS_PROXY_SOCKET` (an absolute path): a host engine, or an env
 * carrying only part of the wiring, derives no pin and every proxy var
 * is denied. A credential-carrying or redirecting value cannot
 * reproduce the pin; inside the sandbox the child keeps exactly the
 * egress every other Resident tool has -- the CONNECT allowlist still
 * decides what it may dial, and no other route out exists. */
export function egressProxyValue(lower: string): string | undefined {
  const socket = process.env.OMA_EGRESS_PROXY_SOCKET;
  const port = process.env.OMA_EGRESS_PROXY_PORT;
  if (socket === undefined || !isAbsolute(socket) ||
    port === undefined || !/^\d+$/.test(port)) return undefined;
  return lower === "no_proxy" ? "127.0.0.1,localhost,::1" : `http://127.0.0.1:${Number(port)}`;
}

/** The exact charset a child env name may be written in. A name is not
 * inert labeling: it is the `NAME` half of the `NAME=value` byte string
 * the child receives, so a key can carry what the value guard never
 * sees -- `LC_ALL=/etc/evil-locale` lowercases into the `lc_` prefix
 * and serializes as `LC_ALL=/etc/evil-locale=C`, a path smuggled
 * through the key side, and a NUL name is an unhandled
 * ERR_INVALID_ARG_VALUE at spawn. Checked on the RAW key before any
 * folding: U+212A (KELVIN SIGN) lowercases to plain `k`, so folding
 * first would launder a hostile name into the `lc_` prefix. `=` and NUL
 * cannot be planted in process.env -- an environ entry is a `name=value`
 * C string -- so they arrive only through a config's declared env; `..`
 * and non-ASCII names ride either channel. */
const CHILD_ENV_KEY_CHARSET = /^[A-Za-z0-9_]+$/;

/** A name reaches the child only through the allowlist -- or, for the
 * four proxy names, only when its value is the sandbox's own injected
 * loopback byte-for-byte -- and only in the sanctioned name charset.
 * Case-insensitive, so a case-variant of an unlisted name inherits the
 * same verdict. A NUL value is refused for every name up front -- the
 * path-typed names skip `tokenValueAllowed`, so without this line a
 * `PATH: "a\0b"` would reach spawn as an unhandled
 * ERR_INVALID_ARG_VALUE, the same class the key charset closed on the
 * name side. */
export function admittedChildEnv(key: string, value: string): boolean {
  if (!CHILD_ENV_KEY_CHARSET.test(key) || value.includes("\0")) return false;
  const lower = key.toLowerCase();
  if (CHILD_PROXY_NAMES.has(lower)) return value === egressProxyValue(lower);
  const named = OMA_CHILD_ENV_ALLOW.has(lower) ||
    OMA_CHILD_ENV_PREFIXES.some(prefix => lower.startsWith(prefix));
  if (!named) return false;
  return CHILD_ENV_PATH_TYPED.has(lower) || tokenValueAllowed(lower, value);
}

/** The scratch names a child gets — HOME/XDG/TMP — supplied by the
 * caller's per-call scratch, never inherited. */
export const CHILD_ENV_SCRATCH_NAMES: ReadonlyArray<string> = [
  "HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME",
  "TMPDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
];

export function childEnvScratchEntries(scratch: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of CHILD_ENV_SCRATCH_NAMES) env[key] = scratch;
  return env;
}

/** The complete environment a vendored child gets, built in three tiers:
 * the allowlisted inherited names first, the config's declared env
 * second (same predicate — a declared `GOPRIVATE` or `NODE_OPTIONS` is
 * stripped exactly as if inherited), the scratch redirects last. A
 * same-spelling collision goes to the later tier; a denied name is
 * absent, never an empty string. */
export function buildChildEnv(base: NodeJS.ProcessEnv, declared?: Record<string, string>, scratch?: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base))
    if (typeof value === "string" && admittedChildEnv(key, value)) env[key] = value;
  for (const [key, value] of Object.entries(declared ?? {}))
    if (typeof value === "string" && admittedChildEnv(key, value)) env[key] = value;
  if (scratch !== undefined)
    Object.assign(env, childEnvScratchEntries(scratch));
  return env;
}
