#!/usr/bin/env node
import { NPM_METADATA_PACKAGING, preserveNpmMetadata, vendorPackagingProblems } from "./vendor-bundle-lib.mjs";
/** Vendored pi-mcp-adapter bundle maintenance — the only writer of
 * `apps/oma/src/extension/vendor/pi-mcp-adapter/runtime/` and `manifest.json`.
 *
 * `upstream/` is the exact npm tarball snapshot of pi-mcp-adapter (verified
 * against `package/npm integrity` and `shasum` at vendoring time) and is
 * never touched here. `upstream-tests/` is the repository's test tree at
 * the same commit — the npm tarball ships no tests — kept for provenance
 * and porting; they are not wired into `npm test` (they need vitest, the
 * upstream repo layout, and for most suites a network). `node_modules/` is
 * the pinned runtime dependency closure, byte-exact to the npm-installed
 * production tree named in DEPENDENCIES, kept separate from anything a
 * user-installed Pi package would resolve. Peer/host API packages
 * (@earendil-works/pi-coding-agent, @earendil-works/pi-tui,
 * @earendil-works/pi-ai, typebox) resolve to OMA's own install — they are
 * the host API, not payload.
 *
 * `runtime/` is tsc's emit of every upstream root-level .ts module —
 * index.ts is the extension entry whose `createMcpAdapter` export the OMA
 * adapter drives, and its (lazy) import graph covers the rest — compiled
 * with the repository's tsc under ESNext/bundler resolution, from a staged
 * copy whose relative ".ts" specifiers were mechanically rewritten to
 * ".js" (Node's loader needs them; that rewrite is derived, not a
 * divergence). Two classes of extra bytes join the emit:
 *
 *  1. RUNTIME_ASSETS — upstream's non-.ts files the emitted modules reach
 *     by URL/dirname (mcp-script-worker.mjs, mcp-keyring-helper.cjs,
 *     app-bridge.bundle.js, package.json, skills/), copied verbatim.
 *  2. OMA_DIVERGENCES — the only semantic difference between upstream emit
 *     and runtime/. Each splice is an exact-once anchor replacement over
 *     the post-emit bytes; a drifted anchor fails loudly.
 *
 * This script never reaches the network: npm integrity/shasum/commit are
 * recorded metadata, verified once at vendoring time.
 */
import ts from "typescript";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import {
  applyDivergences, bundleDigest, bundleRecordProblems, bundleRecords, canonical,
  divergenceMetadata, divergenceProblems, emittedRuntimeProblems, filesUnder,
  writeRuntimeTree,
} from "./vendor-bundle-lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE_DIR = join(root, "packages/tool-mcp/src/vendor/pi-mcp-adapter");
const UPSTREAM_DIR = join(BUNDLE_DIR, "upstream");
const RUNTIME_DIR = join(BUNDLE_DIR, "runtime");
const UPSTREAM_TESTS_DIR = join(BUNDLE_DIR, "upstream-tests");
const MANIFEST_PATH = join(BUNDLE_DIR, "manifest.json");

const EXPECTED_PACKAGE = Object.freeze({
  name: "pi-mcp-adapter",
  version: "5.0.0",
  // The commit whose tree the npm tarball was published from: every tarball
  // member — all 87 root .ts modules, dist/, docs/, skills/, examples/,
  // cli.js, the .cjs/.mjs helpers, LICENSE, README.md, CHANGELOG.md and
  // package.json itself — matches this commit byte-for-byte (the only
  // difference between the two trees is files npm never ships: the test
  // suites, configs, .github and examples/interactive-visualizer).
  // upstream-tests/ is this commit's own test tree, byte-exact.
  commit: "5783e5eacfe820829b18be5d4de91e5f46e79dbb",
  npmIntegrity: "sha512-/3vWQLSXwud+VX1vV/dFfKpp6I40guCeqiaP/XMdXIyon+frIm+sPXGArLlmvY5PIwL2ChJ3AhELIusroGA8Ng==",
  npmShasum: "6c20461d658ec7d7b7e303b067e2ff13a7846d00",
});

/** The runtime dependency closure vendored under node_modules/ — the
 * production `npm install --omit=dev` resolution of upstream's declared
 * dependencies on linux-x64, pinned to the exact lockfile entries at
 * vendoring time. Keys are the vendored subpaths under node_modules/.
 * npm resolves the platform-bound optional natives (@napi-rs/keyring-*,
 * recheck-*) for the vendoring platform only: under OMA the keyring store
 * is never reached (OMA_AUTH_STORE diverges it to the in-memory store
 * before any require runs) and recheck keeps its own fallback order, so
 * the closure is complete for what OMA can execute. Every name+version is
 * verified against the vendored package.json on --check, and every file's
 * bytes are bound by manifest.files and the bundle digest. Peer/host API
 * packages (@earendil-works/pi-coding-agent, @earendil-works/pi-tui,
 * @earendil-works/pi-ai, typebox) resolve to OMA's own install — they are
 * the host API, not payload. zod is a real dependency (not only a peer),
 * so it is vendored here. */
const DEPENDENCIES = Object.freeze({
  "@modelcontextprotocol/client": { version: "2.0.0", integrity: "sha512-8f1OghQ2rjzIOfqgUCP+8GiUWqRs89njoWLNqAe8kWmDePv3s1fZXseej+QXemssEuuOvLLmLO/kqM3IQHtISw==" },
  "@modelcontextprotocol/core": { version: "2.0.0", integrity: "sha512-pJCEwGG7Lfr/+PQp9ZTwKXNeO5wzbfKL7H3MYpCorM4oFBoQrdjnBgEoqG+RjhsvS1FKrDbKux+M1HhlnGWqcA==" },
  "@modelcontextprotocol/ext-tasks": { version: "0.1.0", integrity: "sha512-N6kQdDoR8bQcXFvoB0qsPh2k5/hr+aQDKngiJH8P2u3L68bdX0yMuPRMAZ6JHBGTA51rRFc3ajhiosEaeW9U1A==" },
  "@napi-rs/keyring": { version: "2.1.0", integrity: "sha512-km9J3fomkGSLpImpelq0cMvLBrJ5eVlTzuWdG3Iy0laP6gU90MmHYjqhUhG32aYq0/0++r2TLuAA9xlnh4XU1g==" },
  "@napi-rs/keyring-linux-x64-gnu": { version: "2.1.0", integrity: "sha512-7ZA0ssxfpuGXV8S5Ct1ZJoEL3sKg/8u7mIL4SK9/PwKBhxIq7K+FVcjnggNsuFnEhHTX+HYl9hHDrlX0odZnHg==" },
  "@pkgr/core": { version: "0.2.10", integrity: "sha512-x6fFWCeak8aCGfqZfe6CXYt5xVjxe9Os1cIPmVRcToInKLjhJkRVXvJ/L3/1KxFkjDQdbZV/YsuLKqa8t/xKpA==" },
  "@typesafe-ai/sdk": { version: "0.6.0", integrity: "sha512-IddX+Q0XM+VagOUZFeP7wZjaO4SHMdvnh2zEBdrZZnXedWI3BNK1lKhMx3ayrkFWvVLbVcUHJy6AVZlY+e6Jaw==" },
  "ajv": { version: "8.20.0", integrity: "sha512-Thbli+OlOj+iMPYFBVBfJ3OmCAnaSyNn4M1vz9T6Gka5Jt9ba/HIR56joy65tY6kx/FCF5VXNB819Y7/GUrBGA==" },
  "ajv-formats": { version: "3.0.1", integrity: "sha512-8iUql50EUR+uUcdRQ3HDqa6EVyo3docL8g5WJ3FNcWmu62IbkGUue/pEyLBW8VGKKucTPgqeks4fIU1DA4yowQ==" },
  "bundle-name": { version: "4.1.1", integrity: "sha512-DdH81/zPLVS11EUgWq3tEu/xn+EzljlMYooDNdzWEnFha3R3NBMpMV1UqYIpjYHV/SgpFKMIX1Oh7o06SjM/oA==" },
  "cross-spawn": { version: "7.0.6", integrity: "sha512-uV2QOWP2nWzsy2aMp8aRibhi9dlzF5Hgh5SHaB9OiTGEyDTiJJyx0uy51QXdyWbtAHNua4XJzUKca3OzKUd3vA==" },
  "default-browser": { version: "5.5.1", integrity: "sha512-m1pAzaJgZ/gssEqlOhJkPJp8Xly7QyW6xcrkUa2KKcDeDSEMP7X8xipU3snUcfisTQx0w1AGae+9UtJSfVnXGw==" },
  "default-browser-id": { version: "5.0.1", integrity: "sha512-x1VCxdX4t+8wVfd1so/9w+vQ4vx7lKd2Qp5tDRutErwmR85OgmfX7RlLRMWafRMY7hbEiXIbudNrjOAPa/hL8Q==" },
  "define-lazy-prop": { version: "3.0.0", integrity: "sha512-N+MeXYoqr3pOgn8xfyRPREN7gHakLYjhsHhWGT3fWAiL4IkAt0iDw14QiiEm2bE30c5XX5q0FtAA3CK5f9/BUg==" },
  "eventsource": { version: "3.0.7", integrity: "sha512-CRT1WTyuQoD771GW56XEZFQ/ZoSfWid1alKGDYMmkt2yl8UXrVR4pspqWNEcqKvVIzg6PAltWjxcSSPrboA4iA==" },
  "eventsource-parser": { version: "3.1.1", integrity: "sha512-EKN1vKAMcZ8MlYMpaNuxN6R9yakzH6uajHcHVTqWJzvu5pWw9DyhbP35HH8MVBQ+dZjAfDxk+A8NiR9KWaXiyQ==" },
  "fast-deep-equal": { version: "3.1.3", integrity: "sha512-f3qQ9oQy9j2AhBe/H9VC91wLmKBCCU/gDOnKNAYG5hswO7BLKj09Hc5HYNz9cGI++xlpDCIgDaitVs03ATR84Q==" },
  "fast-uri": { version: "3.1.8", integrity: "sha512-GZMtZUTNRpOVIECoXwLNZS5xUGE+mVNbTB8h/7Rwh2TFWcBQiPzTgyZi05BF9UMZKkLJv8XBRJTlU7zg8+ZfMg==" },
  "is-docker": { version: "3.0.0", integrity: "sha512-eljcgEDlEns/7AXFosB5K/2nCM4P7FQPkGc/DWLy5rmFEWvZayGrik1d9/QIY5nJ4f9YsVvBkA6kJpHn9rISdQ==" },
  "is-inside-container": { version: "1.0.0", integrity: "sha512-KIYLCCJghfHZxqjYBE7rEy0OBuTd5xCHS7tHVgvCLkx7StIoaxwNW3hCALgEUjFfeRk+MG/Qxmp/vtETEF3tRA==" },
  "is-wsl": { version: "3.1.1", integrity: "sha512-e6rvdUCiQCAuumZslxRJWR/Doq4VpPR82kqclvcS0efgt430SlGIk05vdCN58+VrzgtIcfNODjozVielycD4Sw==" },
  "isexe": { version: "2.0.0", integrity: "sha512-RHxMLp9lnKHGHRng9QFhRCMbYAcVpn69smSGcq3f36xjgVVWThj4qqLbTLlq7Ssj8B+fIQ1EuCEGI2lKsyQeIw==" },
  "jose": { version: "6.2.12", integrity: "sha512-9NiFmJEex0sy2Dk58j2UGBSHgUs2ypF9eZSu4L6vjOX3Dp96Sw1F3uL+H+D1sx02jZZdzUT0HgvCy59CuvXcWw==" },
  "json-schema-traverse": { version: "1.0.0", integrity: "sha512-NM8/P9n3XjXhIZn1lLhkFaACTOURQXjWhV4BA/RnOv8xvgqtqpAX9IO4mRQxSx1Rlo4tqzeqb0sOlruaOy3dug==" },
  "open": { version: "10.2.0", integrity: "sha512-YgBpdJHPyQ2UE5x+hlSXcnejzAvD0b22U2OuAP+8OnlJT+PjWPxtgmGqKKc+RgTM63U9gN0YzrYc71R2WT/hTA==" },
  "path-key": { version: "3.1.1", integrity: "sha512-ojmeN0qd+y0jszEtoY48r0Peq5dwMEkIlCOu6Q5f41lfkswXuKtYrhgoTpLnyIcHm24Uhqx+5Tqm2InSwLhE6Q==" },
  "pkce-challenge": { version: "5.0.1", integrity: "sha512-wQ0b/W4Fr01qtpHlqSqspcj3EhBvimsdh0KlHhH8HRZnMsEa0ea2fTULOXOS9ccQr3om+GcGRk4e+isrZWV8qQ==" },
  "quickjs-wasi": { version: "3.6.2", integrity: "sha512-FCqGtGOrMgzUiIrMNMA2YnsOxCNwo31dzqXvclXUC6xeT35NJLKXQJsvbeCTjvoFAwZgEAPg8U6+KAPDGXn8Mg==" },
  "recheck": { version: "4.6.0-beta.3", integrity: "sha512-vFGnR2AF6o8O5/gyLoIx5Kcnqdf/e3RLeMbZYgTJAiTIkKFPEFAWKxHiGWOhZDg5ibt46oqN7h+yJE6Gx2HqYw==" },
  "recheck-jar": { version: "4.6.0-beta.3", integrity: "sha512-CwADkL99b8QlGcg7vRzuhkzfQebIPO8+IfIOi1HIlzBRUC8k6/zAylmzcavI9rjZD4jVStRR+Px+TnkCOCoXbQ==" },
  "recheck-linux-x64": { version: "4.6.0-beta.3", integrity: "sha512-QBzszyfVO7jZqOh6yjNlulD45BYS0QVReHrPzN2rDWSTs8NnDbWcrXMGo5zSlCsS/hMmuuExbs/jYIZQfqyIsQ==" },
  "require-from-string": { version: "2.0.2", integrity: "sha512-Xf0nWe6RseziFMu+Ap9biiUbmplq6S9/p+7w7YXP/JBHhrUDDUhwa+vANyubuqfZWTveU//DYVGsDG7RKL/vEw==" },
  "run-applescript": { version: "7.1.0", integrity: "sha512-DPe5pVFaAsinSaV6QjQ6gdiedWDcRCbUuiQfQa2wmWV7+xC9bGulGI8+TdRmoFkAPaBXk8CrAbnlY2ISniJ47Q==" },
  "shebang-command": { version: "2.0.0", integrity: "sha512-kHxr2zZpYtdmrN1qDjrrX/Z1rR1kG8Dx+gkpK1G4eXmvXswmcE1hTWBWYUzlraYw1/yZp6YuDY77YtvbN0dmDA==" },
  "shebang-regex": { version: "3.0.0", integrity: "sha512-7++dFhtcx3353uBaq8DDR4NuxBetBzC7ZQOhmTQInHEd6bSrXdiEyzCvG07Z44UYdLShWUyXt5M/yhz8ekcb1A==" },
  "smol-toml": { version: "1.9.0", integrity: "sha512-hpd+HLON7HdZXqYchMM/+LaTTbdK0AU3NngIJ4KVyWbY9bfQqdL9cD+4yf6dUoU2Ap4VsU0JkQi6FxAI1B2mXQ==" },
  "strip-json-comments": { version: "5.0.3", integrity: "sha512-1tB5mhVo7U+ETBKNf92xT4hrQa3pm0MZ0PQvuDnWgAAGHDsfp4lPSpiS6psrSiet87wyGPh9ft6wmhOMQ0hDiw==" },
  "synckit": { version: "0.11.11", integrity: "sha512-MeQTA1r0litLUf0Rp/iisCaL8761lKAZHaimlbGK4j0HysC4PLfqygQj9srcs0m2RdtDYnF8UuYyKpbjHYp7Jw==" },
  "undici": { version: "6.29.0", integrity: "sha512-R+RODBqp6i2pPflGdq+xIOUkl+RNfGgHwoinecKu/JCuf2uO06cOKoDbI2P7Dn6KcswdKwrczbU6IYJ6K8X+wg==" },
  "which": { version: "2.0.2", integrity: "sha512-BLI3Tl1TW3Pvl70l3yq3Y64i+awpwXqsGBYWkkqMtnbXgrMD+yj7rhW0kuEDxzJaYXGjEW5ogapKNMEKNMjibA==" },
  "wsl-utils": { version: "0.1.0", integrity: "sha512-h3Fbisa2nKGPxCpm89Hk33lBLsnaGBvctQopaBSOW/uIs6FTe1ATyAnKFJrzVs9vpGdsTe73WF3V4lIsk4Gacw==" },
  "zod": { version: "4.6.5", integrity: "sha512-v5l/aFXZQeai4awLbOpSoHecE9UiMrnfx75tEXLjNonXVARxQ5mOeipTjROUchszUNCqnE+hqAMujRsRHsut2Q==" },
});

/** Upstream's non-.ts bytes that runtime/ modules reach through
 * import.meta URLs: the QuickJS script worker and the app-bridge bundle
 * are read relative to the module that loads them, the keyring helper is
 * looked up adjacent first (upstream's own '../' fallback keeps working
 * because the file also sits at upstream/), and index.js computes
 * "./skills/mcp-scripting/SKILL.md" relative to itself. package.json is
 * copied so pi-builtin-mcp.js's module-scope "./package.json" read
 * resolves exactly as it does beside upstream's package root. Copied
 * verbatim — they are payload, not generated code. */
const RUNTIME_ASSETS = Object.freeze([
  "mcp-script-worker.mjs",
  "mcp-keyring-helper.cjs",
  "app-bridge.bundle.js",
  "package.json",
]);

/** OMA boundary splices applied to the emitted runtime. Every anchor must
 * occur exactly once in the tsc emit: the emitted text is upstream's own,
 * and a splice that fails to anchor means upstream drifted — regenerate
 * and re-derive, never skip.
 *
 * The splices install exactly one seam — `omaMcpPolicy`, installed by the
 * OMA adapter (src/extension/mcp-tools.ts) before upstream's factory runs:
 *
 *  - utils.js: the policy itself — deny-by-default `omaPermits`, the
 *    egress pin, the pinned-leaf fetch (vendored undici fetch + ProxyAgent,
 *    loopback bypassing the pin so stdio-adjacent local servers stay
 *    direct), the CA dispatcher (ProxyAgent requestTls when pinned, else
 *    upstream's own Agent), and re-exports so no module ever names the
 *    bundle's node_modules; plus the `!command` credential refusal inside
 *    resolveCommandSecret, covering env/headers/bearer/clientSecret sinks.
 *  - bearer-command-resolver.js: the TTL-cached `!command` bearer path has
 *    its own spawn — refused under the same permit before any shell runs.
 *  - request-headers-command.js: per-request `!command` header generation
 *    refused under the same permit.
 *  - mcp-auth.js: under OMA the OS keyring is unreachable — the secret
 *    store resolves to the in-memory store before @napi-rs/keyring is ever
 *    required, so no host credential (existing token entries included) can
 *    be inherited.
 *  - server-manager.js / mcp-auth-fetch.js / http-ca.js / mcp-probe.js /
 *    jev-client.js: every upstream fetch leaf routes through the pinned
 *    leaf — when the egress pin exists, MCP traffic, OAuth/auth HTTP and
 *    endpoint probes are carried by the vendored ProxyAgent dispatcher;
 *    without a pin upstream's own globalThis.fetch stands.
 *  - proxy-modes.js / direct-tools.js: a tool call whose metadata carries
 *    uiResourceUri returns a structured ui_session_refused result under an
 *    installed OMA policy — before maybeStartUiSession can read the UI
 *    resource, probe remote logins (`who`), or resolve/launch a viewer
 *    (`orca`, `npm root -g`, a host-global glimpseui import, a browser
 *    open). ui-session.js and glimpse-ui.js carry the same permit as a
 *    backstop for any caller that reaches them directly.
 */
const OMA_DIVERGENCES = Object.freeze({
  "utils.js": {
    reason:
      "The OMA boundary seam itself. omaInstallMcpPolicy is called by " +
      "apps/oma/src/extension/mcp-tools.ts before upstream's factory runs; without an " +
      "installed policy every helper degrades to upstream's own behavior " +
      "(globalThis.fetch, process.env, tmpdir, the keyring store selector), " +
      "so the seam is inert payload under a bare upstream load. Under the " +
      "policy: omaPermits is deny-by-default (a permit absent from the table " +
      "is refused); omaRequirePermit refuses `!command` credential sinks in " +
      "resolveCommandSecret before any shell runs, covering env, header, " +
      "bearer and clientSecret interpolation; omaAmbientEnv is the only " +
      "ambient-env view vendored code consults on spliced sites (OMA " +
      "supplies an empty map, so user-land env knobs like MCP_DIRECT_TOOLS, " +
      "MCP_OAUTH_DIR, NPM_CONFIG_CACHE, BROWSER, MCP_OAUTH_CALLBACK_PORT, " +
      "SYSTEMONE_ENDPOINT/*_API_KEY and the PI_MCP_ADAPTER_* test/recovery " +
      "selectors cannot reach in); omaAgentDir/omaTmpdir re-root every " +
      "getAgentPath-derived write and the output-guard spill root into " +
      "OMA-owned directories; omaChildEnv runs the shared child-env " +
      "allowlist over inherited process.env for stdio children; " +
      "omaPinnedFetch is the egress leaf every HTTP path funnels into — " +
      "loopback stays direct, everything else rides the vendored undici " +
      "through a ProxyAgent built on the OMA pin, with upstream's own " +
      "Request-translation (mirroring http-ca.js) so dispatcher and fetch " +
      "share the vendored undici implementation; omaCaFetch substitutes " +
      "that leaf for the whole fetch chain when upstream's CA-only leaf is " +
      "absent; omaAuthStoreKind/omaOAuthFileKey pin the credential store to " +
      "what the OMA policy declares; omaSecureKeyringClosed returns the " +
      "same 'OS secure credential storage is unavailable' shape upstream " +
      "produces on a host without keyring, so no vendored path can reach " +
      "the OS keyring, the @napi-rs/keyring native binding or the keyctl " +
      "recovery spawn; omaUiSessionsRefused is the same closed-by-default " +
      "predicate for the interactive-UI permit the ui-session/glimpse " +
      "gates consult; omaPolicyActive lets a spliced site distinguish " +
      "'no OMA policy' from 'policy installed'.",
    edits: [
      {
        find: `import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import stripJsonComments from "strip-json-comments";`,
        replace: `import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { homedir, platform, tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import stripJsonComments from "strip-json-comments";
import { ProxyAgent as OmaUndiciProxyAgent, Request as OmaUndiciRequest, fetch as omaUndiciFetch } from "undici";
/* ------------------------------------------------------------------ *
 * OMA boundary seam — installed by src/extension/mcp-tools.ts before    *
 * upstream's factory runs. With no policy installed every helper below  *
 * degrades to upstream's own behavior, so the seam is inert under a     *
 * bare upstream load; under OMA every ambient escape routes through it. *
 * ------------------------------------------------------------------ */
let omaMcpPolicy;
export function omaInstallMcpPolicy(policy) { omaMcpPolicy = policy; }
export function omaPolicyActive() { return omaMcpPolicy !== undefined; }
export function omaPermits(name) { return omaMcpPolicy?.permits?.[name] === true; }
export function omaRequirePermit(name, context) {
    if (omaMcpPolicy !== undefined && !omaPermits(name))
        throw new Error(\`[E_OMA_MCP_AUTHORITY] \${context}: "\${name}" is not permitted at the OMA boundary\`);
}
/** The only ambient-env view a spliced site may read. OMA installs an empty
 * map: nothing the operator's shell exported can reach vendored knobs. */
export function omaAmbientEnv() { return omaMcpPolicy?.env ?? process.env; }
/** The OMA-owned directory all getAgentPath-derived state lands under. */
export function omaAgentDir() { return omaMcpPolicy?.agentDir; }
/** The OMA-owned scratch root for output-guard spill files. */
export function omaTmpdir() { return omaMcpPolicy?.tmpDir ?? tmpdir(); }
/** The stdio-child env scrub: policy.childEnv applies OMA's allowlist. */
export function omaChildEnv(base) { return omaMcpPolicy?.childEnv?.(base) ?? base; }
/** The declared-env + scratch finish: policy.childEnvFinish filters the
 * merged map through the same predicate, then layers the scratch redirects
 * (HOME/XDG/TMP) no other channel may supply. */
export function omaChildEnvFinish(merged) { return omaMcpPolicy?.childEnvFinish?.(merged) ?? merged; }
/** Which credential store OMA pins ("memory" | "encrypted-file"). */
export function omaAuthStoreKind() { return omaMcpPolicy?.authStore; }
/** The OMA-held encrypted-file key; never an ambient env read. */
export function omaOAuthFileKey() { return omaMcpPolicy?.oauthFileKey; }
/** Under OMA the OS keyring is unreachable unless explicitly permitted —
 * the callers keep upstream's "store unavailable" semantics. */
export function omaSecureKeyringClosed() { return omaMcpPolicy !== undefined && !omaPermits("os-keyring"); }
/** Under OMA an interactive MCP UI session is refused unless the
 * "ui-session" permit is granted — deny-by-default. The refusal fires
 * before the UI machinery (the ui-resource read, the \`who\` remote-login
 * probe, orca/npm/glimpse viewer resolution, a host-global package
 * import, a browser open) can run. With no policy upstream's flow
 * stands. */
export function omaUiSessionsRefused() { return omaMcpPolicy !== undefined && !omaPermits("ui-session"); }
let omaPinnedDispatcher;
/** The egress leaf every spliced HTTP path funnels into. With no policy —
 * or no pin inside it — this is upstream's own globalThis.fetch. With a
 * pin, non-loopback requests ride the vendored undici through the pinned
 * loopback CONNECT proxy; loopback stays direct (local MCP servers and
 * the OAuth callback listener never round-trip the proxy). The Request
 * translation mirrors http-ca.js's own bundled-dispatch path so the
 * vendored undici fetch and its dispatcher share an implementation. */
export function omaPinnedFetch(input, init) {
    const pinned = omaMcpPolicy?.egressPinned ?? null;
    if (pinned === null)
        return globalThis.fetch(input, init);
    let url;
    try {
        url = new URL(input instanceof Request ? input.url : input.toString());
    }
    catch {
        return globalThis.fetch(input, init);
    }
    if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
        return globalThis.fetch(input, init);
    omaPinnedDispatcher ??= new OmaUndiciProxyAgent(pinned);
    const bundledInput = input instanceof Request
        ? new OmaUndiciRequest(input.url, {
            method: input.method,
            headers: [...input.headers],
            ...(init?.body == null && input.body ? { body: (async function* () {
                    yield* input.body;
                })(), duplex: "half" } : {}),
            cache: input.cache,
            credentials: input.credentials,
            integrity: input.integrity,
            keepalive: input.keepalive,
            mode: input.mode,
            redirect: input.redirect,
            referrer: input.referrer,
            referrerPolicy: input.referrerPolicy,
            signal: input.signal,
        })
        : input;
    return omaUndiciFetch(bundledInput, {
        ...init,
        ...(init?.headers !== undefined ? { headers: [...new Headers(init.headers)] } : {}),
        dispatcher: omaPinnedDispatcher,
    });
}
/** The fetch-chain leaf for an HTTP server: upstream's CA dispatcher when
 * it exists, else the pinned leaf when the egress pin exists, else
 * undefined exactly as upstream left it. */
export function omaCaFetch(caFetch) {
    if (caFetch !== undefined)
        return caFetch;
    if ((omaMcpPolicy?.egressPinned ?? null) === null)
        return undefined;
    return { fetch: omaPinnedFetch, close: () => undefined };
}`,
      },
      {
        find: `    if (!value.startsWith("!"))
        return interpolateEnvVars(value);
    const result = spawnSync(value.slice(1), {`,
        replace: `    if (!value.startsWith("!"))
        return interpolateEnvVars(value);
    omaRequirePermit("credential-command", context);
    const result = spawnSync(value.slice(1), {`,
      },
      {
        find: `export function interpolateEnvVars(value, environment = process.env) {`,
        replace: `export function interpolateEnvVars(value, environment = omaAmbientEnv()) {`,
      },
      {
        find: `export function getMissingEnvVars(value, environment = process.env) {`,
        replace: `export function getMissingEnvVars(value, environment = omaAmbientEnv()) {`,
      },
      {
        find: `export function interpolateEnvRecord(values, environment = process.env) {`,
        replace: `export function interpolateEnvRecord(values, environment = omaAmbientEnv()) {`,
      },
      {
        find: `export function resolveServerUrl(definition, environment = process.env) {`,
        replace: `export function resolveServerUrl(definition, environment = omaAmbientEnv()) {`,
      },
      {
        find: `export function resolveConfigPath(value, environment = process.env) {`,
        replace: `export function resolveConfigPath(value, environment = omaAmbientEnv()) {`,
      },
      {
        find: `export function resolveBearerToken(definition, environment = process.env) {`,
        replace: `export function resolveBearerToken(definition, environment = omaAmbientEnv()) {`,
      },
    ],
  },
  "utils.d.ts": {
    reason:
      "Declarations for the utils.js OMA policy seam (see the .js " +
      "divergence) so the adapter's install call and the sibling seam " +
      "imports type-check under NodeNext/bundler resolution.",
    edits: [
      {
        find: `export declare function stripUtf8Bom(raw: string): string;`,
        replace: `/** OMA divergence: the MCP boundary policy the adapter installs
 * before the vendored extension factory runs. */
export interface OmaMcpPolicy {
    /** The OMA-owned directory every getAgentPath-derived path lands
     * under (OAuth legacy/encrypted dirs, metadata cache, onboarding
     * state, npx cache). */
    readonly agentDir?: string;
    /** The OMA-owned scratch root for output-guard spill files. */
    readonly tmpDir?: string;
    /** The deployment's egress pin — the loopback CONNECT forwarder URL —
     * or null when no proxy value is permitted at all. */
    readonly egressPinned?: string | null;
    /** The scrubbed ambient-env view spliced sites read instead of
     * process.env; {} under OMA. */
    readonly env?: Record<string, string>;
    /** The stdio-child env scrub: applied to inherited process.env before
     * a server's declared env merges over it. */
    readonly childEnv?: (base: NodeJS.ProcessEnv) => NodeJS.ProcessEnv;
    /** The child-env finish: applied to the merged inherited+declared map —
     * filters declared values through the same predicate and layers the
     * scratch redirects (HOME/XDG/TMP) no other channel may supply.
     * Entries may carry an explicit \`undefined\` tombstone: the vendored
     * SDK's StdioClientTransport unions its own getDefaultEnvironment()
     * beneath this map, and the tombstone overrides the ambient default
     * inside that union (Node's spawn drops \`undefined\` values), keeping
     * denied names absent. */
    readonly childEnvFinish?: (merged: Record<string, string>) => Record<string, string | undefined>;
    /** The credential store OMA pins; absent means upstream's selector. */
    readonly authStore?: "memory" | "encrypted-file";
    /** The encrypted-file store key (canonical base64 of 32 bytes), held
     * by the policy — never read from ambient env under OMA. */
    readonly oauthFileKey?: string;
    /** Deny-by-default permits; every unset name is refused. */
    readonly permits?: {
        readonly "credential-command"?: boolean;
        readonly "browser-open"?: boolean;
        readonly "os-keyring"?: boolean;
        readonly "ui-session"?: boolean;
    };
}
export declare function omaInstallMcpPolicy(policy: OmaMcpPolicy | undefined): void;
export declare function omaPolicyActive(): boolean;
export declare function omaPermits(name: string): boolean;
export declare function omaRequirePermit(name: string, context: string): void;
export declare function omaAmbientEnv(): Record<string, string> | NodeJS.ProcessEnv;
export declare function omaAgentDir(): string | undefined;
export declare function omaTmpdir(): string;
export declare function omaChildEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export declare function omaChildEnvFinish(merged: Record<string, string>): Record<string, string | undefined>;
export declare function omaAuthStoreKind(): "memory" | "encrypted-file" | undefined;
export declare function omaOAuthFileKey(): string | undefined;
export declare function omaSecureKeyringClosed(): boolean;
export declare function omaUiSessionsRefused(): boolean;
export declare function omaPinnedFetch(input: unknown, init?: unknown): Promise<unknown>;
export declare function omaCaFetch(caFetch: { fetch: unknown; close: () => unknown } | undefined): { fetch: unknown; close: () => unknown } | undefined;
export declare function stripUtf8Bom(raw: string): string;`,
      },
    ],
  },
  "agent-dir.js": {
    reason:
      "OMA-owned state root. getAgentDir is upstream's root for the agent " +
      "directory — the OAuth legacy dir, the encrypted-file store root, the " +
      "metadata cache, the onboarding state, the adapter/pi config fallback " +
      "paths and the npx resolver's package cache all derive from it. Under " +
      "an installed OMA policy it returns the policy's agentDir, so none of " +
      "those can be steered by PI_PACKAGE_DIR, *_CODING_AGENT_DIR or HOME, " +
      "and no host-side Pi credential directory is ever read or imported. " +
      "Without a policy the upstream resolution stands.",
    edits: [
      {
        find: `import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";`,
        replace: `import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { omaAgentDir, omaAmbientEnv } from "./utils.js";`,
      },
      {
        find: `export function getAgentDir() {
    const piConfig = readPiConfig();`,
        replace: `export function getAgentDir() {
    const omaDir = omaAgentDir();
    if (omaDir !== undefined)
        return omaDir;
    const piConfig = readPiConfig();`,
      },
      {
        find: `    const configured = process.env[\`\${appName.toUpperCase()}_CODING_AGENT_DIR\`]?.trim();`,
        replace: `    const configured = omaAmbientEnv()[\`\${appName.toUpperCase()}_CODING_AGENT_DIR\`]?.trim();`,
      },
      {
        find: `    const dir = process.env.PI_PACKAGE_DIR?.trim();`,
        replace: `    const dir = omaAmbientEnv().PI_PACKAGE_DIR?.trim();`,
      },
    ],
  },
  "server-manager.js": {
    reason:
      "Stdio child env scrub and HTTP egress pin. resolveEnv inherits " +
      "process.env verbatim upstream — under OMA it inherits only " +
      "omaChildEnv's allowlisted subset (the child's env entries still " +
      "override per upstream order). createCaFetch's leaf gains the pinned " +
      "fetch when upstream left none (OMA rejects caFile at config " +
      "validation, so the upstream CA branch is unreachable under OMA " +
      "anyway); the bearer-command and provider-token wrappers' implicit " +
      "globalThis.fetch defaults and the SSE path's `requestFetch ?? " +
      "globalThis.fetch` fall to omaPinnedFetch so no composition step can " +
      "leak past the pin.",
    edits: [
      {
        find: `import { interpolateEnvVars, expandHomePath, providerAuthUrlError, resolveBearerToken, resolveCommandSecretsRecord, resolveConfigPath, resolveServerUrl, } from "./utils.js";`,
        replace: `import { interpolateEnvVars, expandHomePath, providerAuthUrlError, resolveBearerToken, resolveCommandSecretsRecord, resolveConfigPath, resolveServerUrl, } from "./utils.js";
import { omaCaFetch, omaChildEnv, omaChildEnvFinish, omaPinnedFetch } from "./utils.js";`,
      },
      {
        find: `    if (inheritEnv) {
        for (const [key, value] of Object.entries(process.env)) {`,
        replace: `    if (inheritEnv) {
        for (const [key, value] of Object.entries(omaChildEnv(process.env))) {`,
      },
      {
        find: `    if (literalEnv)
        return env ? { ...resolved, ...env } : resolved;
    const overrides = resolveCommandSecretsRecord(env, key => \`MCP server "\${serverName}" stdio env "\${key}"\`);
    return overrides ? { ...resolved, ...overrides } : resolved;
}`,
        replace: `    let merged;
    if (literalEnv)
        merged = env ? { ...resolved, ...env } : resolved;
    else {
        const overrides = resolveCommandSecretsRecord(env, key => \`MCP server "\${serverName}" stdio env "\${key}"\`);
        merged = overrides ? { ...resolved, ...overrides } : resolved;
    }
    return omaChildEnvFinish(merged);
}`,
      },
      {
        find: `        let caFetch = createCaFetch(definition);`,
        replace: `        let caFetch = omaCaFetch(createCaFetch(definition));`,
      },
      {
        find: `function createBearerCommandFetch(resolver, delegate) {
    const innerFetch = delegate
        ? (input, init) => delegate(input, init)
        : (input, init) => globalThis.fetch(input, init);`,
        replace: `function createBearerCommandFetch(resolver, delegate) {
    const innerFetch = delegate
        ? (input, init) => delegate(input, init)
        : (input, init) => omaPinnedFetch(input, init);`,
      },
      {
        find: `function createProviderTokenFetch(serverUrl, provider, providerToken, delegate) {
    const origin = new URL(serverUrl).origin;
    const innerFetch = delegate
        ? (input, init) => delegate(input, init)
        : (input, init) => globalThis.fetch(input, init);`,
        replace: `function createProviderTokenFetch(serverUrl, provider, providerToken, delegate) {
    const origin = new URL(serverUrl).origin;
    const innerFetch = delegate
        ? (input, init) => delegate(input, init)
        : (input, init) => omaPinnedFetch(input, init);`,
      },
      {
        find: `                            return await (requestFetch ?? globalThis.fetch)(input, init);`,
        replace: `                            return await (requestFetch ?? omaPinnedFetch)(input, init);`,
      },
    ],
  },
  "mcp-auth-fetch.js": {
    reason:
      "OAuth/auth HTTP through the pinned leaf: the OAuth fetch wrapper's " +
      "absent-delegate fallback becomes omaPinnedFetch, so authorization- " +
      "server metadata, token and revocation requests ride the same egress " +
      "policy as the MCP stream they protect.",
    edits: [
      {
        find: `import { combineAbortSignals } from "./runtime-owner.js";
import { interpolateEnvRecord, resolveCommandSecretsRecord } from "./utils.js";`,
        replace: `import { combineAbortSignals } from "./runtime-owner.js";
import { interpolateEnvRecord, resolveCommandSecretsRecord, omaAmbientEnv, omaPinnedFetch } from "./utils.js";`,
      },
      {
        find: `            return await (options.delegate ?? globalThis.fetch)(input, {`,
        replace: `            return await (options.delegate ?? omaPinnedFetch)(input, {`,
      },
      {
        find: `            if (!process.env[name])
                throw new TypeError("Missing environment credential in OAuth HTTP headers");`,
        replace: `            if (!omaAmbientEnv()[name])
                throw new TypeError("Missing environment credential in OAuth HTTP headers");`,
      },
      {
        find: `    const parsed = Number(process.env.PI_MCP_OAUTH_REQUEST_TIMEOUT_MS);`,
        replace: `    const parsed = Number(omaAmbientEnv().PI_MCP_OAUTH_REQUEST_TIMEOUT_MS);`,
      },
    ],
  },
  "mcp-probe.js": {
    reason:
      "Endpoint probes through the pinned leaf: the transport-kind probe's " +
      "bare fetch becomes omaPinnedFetch so detection requests for a remote " +
      "MCP server are egress-gated like the connection that would follow.",
    edits: [
      {
        find: `const PROBE_TIMEOUT_MS = 5_000;`,
        replace: `import { omaPinnedFetch } from "./utils.js";
const PROBE_TIMEOUT_MS = 5_000;`,
      },
      {
        find: `    const response = await fetch(url, {`,
        replace: `    const response = await omaPinnedFetch(url, {`,
      },
    ],
  },
  "jev-client.js": {
    reason:
      "Semantic-search (Jev) request egress and ambient env. The pinned- " +
      "endpoint fetch keeps its upstream shape — same endpoint pinning, " +
      "redirect refusal — but the leaf becomes omaPinnedFetch so the " +
      "request is egress-gated. Credential resolution reads omaAmbientEnv, " +
      "so SYSTEMONE_API_KEY/TYPESAFE_API_KEY/OPENROUTER_API_KEY exported in " +
      "the operator's shell are invisible; with the secure keyring also " +
      "closed under OMA, resolution reaches upstream's own " +
      "credential_missing/credential_unavailable results.",
    edits: [
      {
        find: `import { JEV_SDK_PATH, OPENROUTER_ORIGIN, resolveJevCredential, resolveJevEndpoint } from "./jev-key-store.js";`,
        replace: `import { JEV_SDK_PATH, OPENROUTER_ORIGIN, resolveJevCredential, resolveJevEndpoint } from "./jev-key-store.js";
import { omaAmbientEnv, omaPinnedFetch } from "./utils.js";`,
      },
      {
        find: `    const credential = resolveJevCredential(process.env, endpoint);`,
        replace: `    const credential = resolveJevCredential(omaAmbientEnv(), endpoint);`,
      },
      {
        find: `        return fetch(target, { ...init, redirect: "error" });`,
        replace: `        return omaPinnedFetch(target, { ...init, redirect: "error" });`,
      },
    ],
  },
  "jev-key-store.js": {
    reason:
      "The Jev endpoint/credential env defaults read omaAmbientEnv instead " +
      "of process.env: an operator-exported SYSTEMONE_ENDPOINT cannot retarget " +
      "semantic search to an arbitrary provider under OMA.",
    edits: [
      {
        find: `import { createSecureKeyringStore } from "./secure-keyring.js";`,
        replace: `import { createSecureKeyringStore } from "./secure-keyring.js";
import { omaAmbientEnv } from "./utils.js";`,
      },
      {
        find: `export function resolveJevEndpoint(env = process.env) {`,
        replace: `export function resolveJevEndpoint(env = omaAmbientEnv()) {`,
      },
      {
        find: `export function resolveJevCredential(env = process.env, endpoint, secretStore = store()) {`,
        replace: `export function resolveJevCredential(env = omaAmbientEnv(), endpoint, secretStore = store()) {`,
      },
    ],
  },
  "secure-keyring.js": {
    reason:
      "OS keyring closure. Under an installed OMA policy without the " +
      "os-keyring permit, createSecureKeyringStore returns a store whose " +
      "read/write/remove throw the same 'OS secure credential storage is " +
      "unavailable' message upstream's own native-missing path produces — " +
      "so @napi-rs/keyring, the Linux keyctl recovery spawn and the helper " +
      "script are all unreachable, for the Jev service-key store and the " +
      "bearer-token store alike.",
    edits: [
      {
        find: `import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);`,
        replace: `import { fileURLToPath } from "node:url";
import { omaAmbientEnv, omaSecureKeyringClosed } from "./utils.js";
const require = createRequire(import.meta.url);`,
      },
      {
        find: `export function createSecureKeyringStore(service) {
    const mode = process.env[TEST_STORE_ENV];`,
        replace: `export function createSecureKeyringStore(service) {
    if (omaSecureKeyringClosed())
        return {
            read() { throw new Error("OS secure credential storage is unavailable. Configure or unlock the OS credential store and retry."); },
            write() { throw new Error("OS secure credential storage is unavailable. Configure or unlock the OS credential store and retry."); },
            remove() { throw new Error("OS secure credential storage is unavailable. Configure or unlock the OS credential store and retry."); },
        };
    const mode = omaAmbientEnv()[TEST_STORE_ENV];`,
      },
      {
        find: `    if (process.platform !== "linux" || process.env.PI_MCP_ADAPTER_DISABLE_KEYRING_RECOVERY === "1")
        return false;`,
        replace: `    if (process.platform !== "linux" || omaAmbientEnv().PI_MCP_ADAPTER_DISABLE_KEYRING_RECOVERY === "1")
        return false;`,
      },
    ],
  },
  "mcp-auth.js": {
    reason:
      "Credential-store pinning and ambient env. Under an installed OMA " +
      "policy getAuthSecretStore resolves the policy's authStore — " +
      "'memory' or 'encrypted-file' — before the OS keyring and before the " +
      "PI_MCP_ADAPTER_TEST_AUTH_STORE selectors, so host keyring reads, " +
      "legacy plaintext imports of a host's tokens and keyctl recovery are " +
      "all unreachable. getEncryptedFileKey reads the policy-held key under " +
      "OMA (never an operator-exported PI_MCP_ADAPTER_OAUTH_FILE_KEY); the " +
      "upstream env fallback stands only with no policy installed. " +
      "MCP_OAUTH_DIR reads through omaAmbientEnv, so the legacy auth dir " +
      "override cannot be steered from the operator's shell — the base dir " +
      "is the OMA-pinned settings.oauthDir or the OMA-pinned agent dir.",
    edits: [
      {
        find: `import { getAgentPath } from './agent-dir.js';
import { resolveConfiguredOAuthDir } from './config.js';`,
        replace: `import { getAgentPath } from './agent-dir.js';
import { resolveConfiguredOAuthDir } from './config.js';
import { omaAmbientEnv, omaAuthStoreKind, omaOAuthFileKey, omaPolicyActive } from './utils.js';`,
      },
      {
        // Upstream's only bare-builtin import block; Node treats 'fs' and
        // 'node:fs' identically, and OMA's package audit recognizes only the
        // node: spelling.
        find: `import { spawnSync } from 'child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { createRequire } from 'module';
import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';`,
        replace: `import { spawnSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { chmodSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';`,
      },
      {
        find: `function getAuthSecretStore(options = {}) {
    if (options.credentialStore === 'encrypted-file')`,
        replace: `function getAuthSecretStore(options = {}) {
    const omaStoreKind = omaAuthStoreKind();
    if (omaStoreKind === 'memory')
        return memoryAuthSecretStore;
    if (omaStoreKind === 'encrypted-file')
        return createEncryptedFileAuthSecretStore();
    if (options.credentialStore === 'encrypted-file')`,
      },
      {
        find: `    const encoded = process.env[OAUTH_FILE_KEY_ENV];`,
        replace: `    const encoded = omaPolicyActive() ? omaOAuthFileKey() : process.env[OAUTH_FILE_KEY_ENV];`,
      },
      {
        find: `    const override = process.env.MCP_OAUTH_DIR?.trim();`,
        replace: `    const override = omaAmbientEnv().MCP_OAUTH_DIR?.trim();`,
      },
      {
        find: `    return process.env[AUTH_CACHE_DISABLED_ENV] !== '1';`,
        replace: `    return omaAmbientEnv()[AUTH_CACHE_DISABLED_ENV] !== '1';`,
      },
      {
        find: `    if (process.env[TEST_AUTH_STORE_ENV] === 'memory')
        return memoryAuthSecretStore;
    if (process.env[TEST_AUTH_STORE_ENV] === 'sizelimited')
        return sizeLimitedAuthSecretStore;
    if (process.env[TEST_AUTH_STORE_ENV] === 'writefailing')
        return writeFailingAuthSecretStore;
    if (process.env[TEST_AUTH_STORE_ENV] === 'unavailable')
        return unavailableAuthSecretStore;
    if (process.env[TEST_AUTH_STORE_ENV] === 'keyrevoked')
        return keyRevokedAuthSecretStore;`,
        replace: `    if (omaAmbientEnv()[TEST_AUTH_STORE_ENV] === 'memory')
        return memoryAuthSecretStore;
    if (omaAmbientEnv()[TEST_AUTH_STORE_ENV] === 'sizelimited')
        return sizeLimitedAuthSecretStore;
    if (omaAmbientEnv()[TEST_AUTH_STORE_ENV] === 'writefailing')
        return writeFailingAuthSecretStore;
    if (omaAmbientEnv()[TEST_AUTH_STORE_ENV] === 'unavailable')
        return unavailableAuthSecretStore;
    if (omaAmbientEnv()[TEST_AUTH_STORE_ENV] === 'keyrevoked')
        return keyRevokedAuthSecretStore;`,
      },
      {
        find: `    if (process.env[KEYRING_RECOVERY_DISABLED_ENV] === '1')
        return false;
    return process.platform === 'linux' || process.env[TEST_LINUX_KEYRING_RECOVERY_ENV] === '1';`,
        replace: `    if (omaAmbientEnv()[KEYRING_RECOVERY_DISABLED_ENV] === '1')
        return false;
    return process.platform === 'linux' || omaAmbientEnv()[TEST_LINUX_KEYRING_RECOVERY_ENV] === '1';`,
      },
      {
        find: `    const keyctl = process.env[KEYRING_RECOVERY_KEYCTL_ENV]?.trim() || 'keyctl';
    const node = process.env[KEYRING_RECOVERY_NODE_ENV]?.trim() || 'node';`,
        replace: `    const keyctl = omaAmbientEnv()[KEYRING_RECOVERY_KEYCTL_ENV]?.trim() || 'keyctl';
    const node = omaAmbientEnv()[KEYRING_RECOVERY_NODE_ENV]?.trim() || 'node';`,
      },
      {
        find: `    const helper = process.env[KEYRING_RECOVERY_HELPER_ENV]?.trim()`,
        replace: `    const helper = omaAmbientEnv()[KEYRING_RECOVERY_HELPER_ENV]?.trim()`,
      },
      {
        find: `        && (process.platform === 'win32' || process.env[TEST_AUTH_STORE_ENV] === 'sizelimited');`,
        replace: `        && (process.platform === 'win32' || omaAmbientEnv()[TEST_AUTH_STORE_ENV] === 'sizelimited');`,
      },
    ],
  },
  "mcp-oauth-provider.js": {
    reason:
      "The OAuth callback port override reads omaAmbientEnv: under OMA the " +
      "operator's MCP_OAUTH_CALLBACK_PORT cannot retarget the loopback " +
      "listener; the upstream default port rules stand.",
    edits: [
      {
        find: `import { resolveCommandSecret } from "./utils.js";`,
        replace: `import { resolveCommandSecret, omaAmbientEnv } from "./utils.js";`,
      },
      {
        find: `if (process.env.MCP_OAUTH_CALLBACK_PORT) {
    const parsedPort = Number.parseInt(process.env.MCP_OAUTH_CALLBACK_PORT, 10);`,
        replace: `if (omaAmbientEnv().MCP_OAUTH_CALLBACK_PORT) {
    const parsedPort = Number.parseInt(omaAmbientEnv().MCP_OAUTH_CALLBACK_PORT, 10);`,
      },
    ],
  },
  "init.js": {
    reason:
      "Ambient-env neutralization on reachable paths. MCP_DIRECT_TOOLS is " +
      "upstream's env escape hatch into direct-tool registration — under " +
      "OMA it reads omaAmbientEnv so the operator's shell cannot re-arm a " +
      "surface the OMA config forbade; BROWSER follows the same view so the " +
      "browser-open flow (itself behind pi.exec, which the facade refuses) " +
      "cannot be re-aimed by env either.",
    edits: [
      {
        find: `import { formatMcpFooterStatus, formatMcpStatus, openUrl, parallelLimit, providerSignInMessage, sanitizeTerminalText } from "./utils.js";`,
        replace: `import { formatMcpFooterStatus, formatMcpStatus, openUrl, parallelLimit, providerSignInMessage, sanitizeTerminalText } from "./utils.js";
import { omaAmbientEnv } from "./utils.js";`,
      },
      {
        find: `    const envDirect = process.env.MCP_DIRECT_TOOLS;`,
        replace: `    const envDirect = omaAmbientEnv().MCP_DIRECT_TOOLS;`,
      },
      {
        find: `            await openUrl(pi, url, process.env.BROWSER, owner.signal);`,
        replace: `            await openUrl(pi, url, omaAmbientEnv().BROWSER, owner.signal);`,
      },
    ],
  },
  "index.js": {
    reason:
      "Ambient-env neutralization: the factory-level MCP_DIRECT_TOOLS read " +
      "drives direct/namespace tool overrides at registration time — under " +
      "OMA it reads omaAmbientEnv, so no exported env var can resurrect a " +
      "tool surface the OMA config forbade.",
    edits: [
      {
        find: `    const earlyConfigPath = programmaticConfig
        ? undefined
        : options.configPath ?? getConfigPathFromArgv();`,
        replace: `    const earlyConfigPath = options.configPath ?? (programmaticConfig ? undefined : getConfigPathFromArgv());`,
      },
      {
        find: `        if (programmaticConfig) {
            return {
                content: [{ type: "text", text: "MCP install is unavailable when the adapter uses programmatic configuration." }],`,
        replace: `        if (programmaticConfig && earlyConfigPath === undefined) {
            return {
                content: [{ type: "text", text: "MCP install needs an explicit configuration destination." }],`,
      },
      {
        find: `        const destination = target === "project" ? getProjectConfigPath(cwd) : getPiGlobalConfigPath(earlyConfigPath);`,
        replace: `        // OMA supplies one explicit installation destination for this engine.
        // Project installs use it too, so a sandbox never writes an unrelated .pi file.
        const destination = programmaticConfig && earlyConfigPath !== undefined ? earlyConfigPath
            : target === "project" ? getProjectConfigPath(cwd) : getPiGlobalConfigPath(earlyConfigPath);`,
      },
      {
        find: `import { formatMcpFooterStatus, formatTerminalError, getConfigPathFromArgv, normalizeDirectToolInputSchema, truncateAtWord } from "./utils.js";`,
        replace: `import { formatMcpFooterStatus, formatTerminalError, getConfigPathFromArgv, normalizeDirectToolInputSchema, truncateAtWord } from "./utils.js";
import { omaAmbientEnv } from "./utils.js";`,
      },
      {
        find: `    const envRaw = process.env.MCP_DIRECT_TOOLS;`,
        replace: `    const envRaw = omaAmbientEnv().MCP_DIRECT_TOOLS;`,
      },
      {
        find: `        if (target === "project" && process.env.PI_MCP_CONFIG_MODE?.trim().toLowerCase() === "exclusive"`,
        replace: `        if (target === "project" && omaAmbientEnv().PI_MCP_CONFIG_MODE?.trim().toLowerCase() === "exclusive"`,
      },
      {
        find: `    if (path === "~")
        return resolve(process.env.HOME ?? "", ".");
    if (path.startsWith("~/"))
        return resolve(process.env.HOME ?? "", path.slice(2));`,
        replace: `    if (path === "~")
        return resolve(omaAmbientEnv().HOME ?? "", ".");
    if (path.startsWith("~/"))
        return resolve(omaAmbientEnv().HOME ?? "", path.slice(2));`,
      },
    ],
  },
  "config.js": {
    reason:
      "PI_MCP_CONFIG_MODE reads omaAmbientEnv: upstream's 'exclusive' env " +
      "mode decides whether config sources merge or override — under OMA " +
      "no env may reach that authority decision.",
    edits: [
      {
        find: `import { getMissingEnvVars, parseJsonWithComments, providerAuthUrlError, stripUtf8Bom, toStringRecord } from "./utils.js";`,
        replace: `import { getMissingEnvVars, parseJsonWithComments, providerAuthUrlError, stripUtf8Bom, toStringRecord } from "./utils.js";
import { omaAmbientEnv } from "./utils.js";`,
      },
      {
        find: `    return process.env.PI_MCP_CONFIG_MODE?.trim().toLowerCase() === "exclusive";`,
        replace: `    return omaAmbientEnv().PI_MCP_CONFIG_MODE?.trim().toLowerCase() === "exclusive";`,
      },
    ],
  },
  "glimpse-ui.js": {
    reason:
      "GLIMPSE_BINARY reads omaAmbientEnv: an operator-exported path to a " +
      "binary must not select what a UI surface would exec under OMA. And " +
      "the glimpse viewer itself is gated on the ui-session permit: " +
      "getGlimpseBinaryPath (the `npm root -g` host probe) and " +
      "openGlimpseWindow (the host-global/bundled-path glimpseui dynamic " +
      "import) refuse under an installed OMA policy before either runs — " +
      "backstops beneath the call-site refusal in proxy-modes.js and " +
      "direct-tools.js; with no policy upstream's flow stands.",
    edits: [
      {
        find: `import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";`,
        replace: `import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { omaAmbientEnv, omaRequirePermit } from "./utils.js";`,
      },
      {
        find: `function getGlimpseBinaryPath() {`,
        replace: `function getGlimpseBinaryPath() {
    omaRequirePermit("ui-session", "Glimpse viewer resolution");`,
      },
      {
        find: `export async function openGlimpseWindow(html, options) {`,
        replace: `export async function openGlimpseWindow(html, options) {
    omaRequirePermit("ui-session", "Glimpse window");`,
      },
      {
        find: `    if (process.env.GLIMPSE_BINARY && existsSync(process.env.GLIMPSE_BINARY)) {
        return process.env.GLIMPSE_BINARY;`,
        replace: `    if (omaAmbientEnv().GLIMPSE_BINARY && existsSync(omaAmbientEnv().GLIMPSE_BINARY)) {
        return omaAmbientEnv().GLIMPSE_BINARY;`,
      },
    ],
  },
  "logger.js": {
    reason:
      "MCP_UI_DEBUG reads omaAmbientEnv: an operator-exported debug flag " +
      "must not raise vendored log verbosity under OMA.",
    edits: [
      {
        find: `const LEVEL_PRIORITY = {`,
        replace: `import { omaAmbientEnv } from "./utils.js";
const LEVEL_PRIORITY = {`,
      },
      {
        find: `if (process.env.MCP_UI_DEBUG === "1" || process.env.MCP_UI_DEBUG === "true") {`,
        replace: `if (omaAmbientEnv().MCP_UI_DEBUG === "1" || omaAmbientEnv().MCP_UI_DEBUG === "true") {`,
      },
    ],
  },
  "metadata-cache.js": {
    reason:
      "computeServerHash and isServerCacheValid default their env " +
      "interpolation base to omaAmbientEnv: server definitions' ${VAR} " +
      "fields hash against the OMA view, not the ambient environment.",
    edits: [
      {
        find: `import { extractToolAnnotations, extractToolUiStreamMode, interpolateEnvRecord, interpolateEnvVars, resolveBearerToken, resolveConfigPath, resolveServerUrl, stableStringify, } from "./utils.js";`,
        replace: `import { extractToolAnnotations, extractToolUiStreamMode, interpolateEnvRecord, interpolateEnvVars, resolveBearerToken, resolveConfigPath, resolveServerUrl, stableStringify, } from "./utils.js";
import { omaAmbientEnv } from "./utils.js";`,
      },
      {
        find: `export function computeServerHash(definition, environment = process.env) {`,
        replace: `export function computeServerHash(definition, environment = omaAmbientEnv()) {`,
      },
      {
        find: `maxAgeMs = 0, environment = process.env) {`,
        replace: `maxAgeMs = 0, environment = omaAmbientEnv()) {`,
      },
    ],
  },
  "ui-session.js": {
    reason:
      "SSH_CONNECTION/SSH_TTY and MCP_UI_VIEWER read omaAmbientEnv: remote " +
      "session detection and viewer preference are upstream's UI heuristics " +
      "— under OMA no ambient env may steer them. And maybeStartUiSession " +
      "itself opens with the ui-session permit: under an installed OMA " +
      "policy it throws before the UI-resource read, the `who` remote " +
      "probe, orca or any viewer work can run — a backstop beneath the " +
      "call-site refusals in proxy-modes.js and direct-tools.js.",
    edits: [
      {
        find: `import { logger } from "./logger.js";`,
        replace: `import { logger } from "./logger.js";
import { omaAmbientEnv, omaRequirePermit } from "./utils.js";`,
      },
      {
        find: `export async function maybeStartUiSession(state, request) {
    const log = logger.child({`,
        replace: `export async function maybeStartUiSession(state, request) {
    // OMA divergence: every path underneath this call spawns or resolves
    // host-side software (the \`who\` login probe, \`orca\`, \`npm root -g\`,
    // a host-global glimpseui import, a browser open). The ui-session
    // permit is deny-by-default, so under an installed OMA policy this
    // throws before any of it runs; with no policy upstream's flow stands.
    omaRequirePermit("ui-session", \`MCP UI session \${request.serverName}/\${request.toolName}\`);
    const log = logger.child({`,
      },
      {
        find: `    return Boolean(process.env.SSH_CONNECTION || process.env.SSH_TTY);`,
        replace: `    return Boolean(omaAmbientEnv().SSH_CONNECTION || omaAmbientEnv().SSH_TTY);`,
      },
      {
        find: `        const viewerPref = process.env.MCP_UI_VIEWER?.toLowerCase();`,
        replace: `        const viewerPref = omaAmbientEnv().MCP_UI_VIEWER?.toLowerCase();`,
      },
    ],
  },
  "ui-server.js": {
    reason:
      "Post-listen 'error' absorption on both UI listeners: the host " +
      "server's startup once-listener is removed after a successful listen " +
      "(the EADDRINUSE candidate retry re-arms it per attempt) and the " +
      "sandbox proxy's once-listener is removed the same way, so an " +
      "accept-class error (EMFILE/ENFILE) later meets zero 'error' " +
      "listeners and escapes its emit as the hosting engine's death. " +
      "Permanent listeners journal best-effort through the child logger " +
      "and keep both sockets bound for the kernel to retry — the startup " +
      "rejection and the candidate-retry contract are unchanged. The " +
      "ui-session permit already refuses this module under an installed " +
      "OMA policy; this is defense in depth for a bare upstream load.",
    edits: [
      {
        find: `    server = hostServer;`,
        replace: `    // OMA divergence (applied by scripts/vendor-pi-mcp-adapter.mjs;
    // recorded under generated.divergences in manifest.json): a permanent
    // 'error' listener for the host server's whole life. The retry loop
    // below arms a fresh once-listener per candidate and onListening drops
    // it after a successful listen, so an accept-class error (EMFILE/
    // ENFILE) after that meets zero 'error' listeners and escapes its emit
    // as the hosting engine's death. The journal is best-effort -- a
    // logger that throws must not throw out of the emit either -- and the
    // socket stays bound for the kernel to retry.
    hostServer.on("error", (listenerError) => {
        try {
            log.error("UI server listener error", listenerError instanceof Error ? listenerError : undefined);
        }
        catch {
        }
    });
    server = hostServer;`,
      },
      {
        find: `                proxy.once("error", onError);`,
        replace: `                // OMA divergence: the same permanent 'error' listener on
                // the sandbox proxy -- onListening removes the startup
                // once-listener below, so a post-listen accept-class error
                // would otherwise escape its emit the same way.
                proxy.on("error", (listenerError) => {
                    try {
                        log.error("Sandbox proxy listener error", listenerError instanceof Error ? listenerError : undefined);
                    }
                    catch {
                    }
                });
                proxy.once("error", onError);`,
      },
    ],
  },
  "proxy-modes.js": {
    reason:
      "A uiResourceUri tool call is refused under an installed OMA policy " +
      "with a structured ui_session_refused result — before the UI " +
      "machinery (the ui-resource read, the `who` remote-login probe, " +
      "orca, `npm root -g`, a host-global glimpseui import, a browser " +
      "open) and before the downstream tool call itself: a tool built to " +
      "interact through its UI cannot run coherently with the UI refused. " +
      "With no policy upstream's flow stands.",
    edits: [
      {
        find: `import { formatAuthRequiredMessage, formatMcpStatus, normalizeToolArguments, resolveServerUrl, truncateAtWord, withToolCallIdMeta } from "./utils.js";`,
        replace: `import { formatAuthRequiredMessage, formatMcpStatus, normalizeToolArguments, omaUiSessionsRefused, resolveServerUrl, truncateAtWord, withToolCallIdMeta } from "./utils.js";`,
      },
      {
        find: `        uiSession = toolMeta.uiResourceUri
            ? await maybeStartUiSession(state, {`,
        replace: `        // OMA divergence: an interactive-UI tool call refuses at the
        // boundary, before the UI machinery and before the downstream call.
        if (toolMeta.uiResourceUri && omaUiSessionsRefused()) {
            const message = \`MCP tool "\${toolMeta.originalName}" on server "\${serverName}" advertises an interactive UI resource (\${toolMeta.uiResourceUri}); interactive UI sessions are refused at the OMA boundary.\`;
            return {
                content: [{ type: "text", text: message }],
                details: { mode: "call", error: "ui_session_refused", ...callIdentity, message },
            };
        }
        uiSession = toolMeta.uiResourceUri
            ? await maybeStartUiSession(state, {`,
      },
    ],
  },
  "direct-tools.js": {
    reason:
      "The same ui-session refusal as proxy-modes.js on the direct-tool " +
      "surface: a uiResourceUri tool call returns a structured " +
      "ui_session_refused result before the UI machinery and before the " +
      "downstream call, under an installed OMA policy. (OMA config " +
      "validation also pins settings.directTools off, so this is a " +
      "backstop for any path that reaches it.)",
    edits: [
      {
        find: `import { formatAuthRequiredMessage, normalizeToolArguments, resolveServerUrl, withToolCallIdMeta } from "./utils.js";`,
        replace: `import { formatAuthRequiredMessage, normalizeToolArguments, omaUiSessionsRefused, resolveServerUrl, withToolCallIdMeta } from "./utils.js";`,
      },
      {
        find: `            const hasUi = !!spec.uiResourceUri;
            uiSession = hasUi
                ? await maybeStartUiSession(state, {`,
        replace: `            // OMA divergence: an interactive-UI tool call refuses at
            // the boundary, before the UI machinery and the downstream call.
            if (spec.uiResourceUri && omaUiSessionsRefused()) {
                const message = \`MCP tool "\${spec.originalName}" on server "\${spec.serverName}" advertises an interactive UI resource (\${spec.uiResourceUri}); interactive UI sessions are refused at the OMA boundary.\`;
                return {
                    content: [{ type: "text", text: message }],
                    details: { error: "ui_session_refused", server: spec.serverName, tool: spec.originalName, message },
                };
            }
            const hasUi = !!spec.uiResourceUri;
            uiSession = hasUi
                ? await maybeStartUiSession(state, {`,
      },
    ],
  },
  "mcp-callback-server.js": {
    reason:
      "Bare-builtin specifier normalization: 'http' becomes 'node:http' " +
      "(identical module, the spelling OMA's package audit recognizes). " +
      "Post-listen 'error' absorption: upstream's startup once-listener is " +
      "never removed after a successful listen, so the first post-listen " +
      "error is swallowed by the already-settled reject and a second meets " +
      "zero listeners and escapes its emit as the hosting engine's death — " +
      "reachable through the allowed auth:\"oauth\" path (mcp-auth-flow.js " +
      "→ ensureCallbackServer). A permanent listener journals best-effort " +
      "and keeps the OAuth loopback socket bound for the kernel to retry, " +
      "and the startup once-listener is removed the moment the listen " +
      "succeeds so there is no swallowed-then-uncovered transition — the " +
      "startup rejection contract is unchanged.",
    edits: [
      {
        find: `import { createServer } from "http";`,
        replace: `import { createServer } from "node:http";`,
      },
      {
        find: `            candidateServer.once("error", (err) => {
                reject(err);
            });
            candidateServer.listen(listenPort, requestedHost, () => {
                resolve();
            });`,
        replace: `            // OMA divergence (applied by scripts/vendor-pi-mcp-adapter.mjs;
            // recorded under generated.divergences in manifest.json): a
            // permanent 'error' listener beside the startup once-listener.
            // Upstream never removed the once-listener after a successful
            // listen, so a post-listen error was swallowed by the settled
            // reject and the NEXT error met zero 'error' listeners and
            // escaped its emit as the hosting engine's death. The journal
            // is best-effort -- a dead stderr must not throw out of the
            // emit either -- and the socket stays bound for the kernel to
            // retry. The once-listener still carries startup rejection and
            // is removed exactly when the listen succeeds, so no post-
            // listen error is ever silently consumed.
            candidateServer.on("error", (listenerError) => {
                try {
                    console.error(\`OAuth callback listener error: \${listenerError instanceof Error ? listenerError.message : String(listenerError)}\`);
                }
                catch {
                }
            });
            const onStartupError = (err) => {
                reject(err);
            };
            candidateServer.once("error", onStartupError);
            candidateServer.listen(listenPort, requestedHost, () => {
                candidateServer.off("error", onStartupError);
                resolve();
            });`,
      },
    ],
  },
  "agent-plugin-loader.js": {
    reason:
      "Plugin-path `~` expansion reads omaAmbientEnv().HOME: the plugin " +
      "loader is unreachable under OMA's config validation, and if a path " +
      "ever reached it the ambient HOME could not steer it.",
    edits: [
      {
        find: `import { resolveRealContainedPath } from "./utils.js";`,
        replace: `import { resolveRealContainedPath } from "./utils.js";
import { omaAmbientEnv } from "./utils.js";`,
      },
      {
        find: `    if (path === "~")
        return resolve(process.env.HOME ?? "", ".");
    if (path.startsWith("~/"))
        return resolve(process.env.HOME ?? "", path.slice(2));`,
        replace: `    if (path === "~")
        return resolve(omaAmbientEnv().HOME ?? "", ".");
    if (path.startsWith("~/"))
        return resolve(omaAmbientEnv().HOME ?? "", path.slice(2));`,
      },
    ],
  },
  "claude-plugin-loader.js": {
    reason:
      "Plugin-path `~` expansion reads omaAmbientEnv().HOME — same " +
      "unreachable-under-OMA defense as agent-plugin-loader.js.",
    edits: [
      {
        find: `import { parseJsonWithComments } from "./utils.js";`,
        replace: `import { parseJsonWithComments } from "./utils.js";
import { omaAmbientEnv } from "./utils.js";`,
      },
      {
        find: `    if (path === "~")
        return resolve(process.env.HOME ?? "", ".");
    if (path.startsWith("~/"))
        return resolve(process.env.HOME ?? "", path.slice(2));`,
        replace: `    if (path === "~")
        return resolve(omaAmbientEnv().HOME ?? "", ".");
    if (path.startsWith("~/"))
        return resolve(omaAmbientEnv().HOME ?? "", path.slice(2));`,
      },
    ],
  },
  "npx-resolver.js": {
    reason:
      "NPM_CONFIG_CACHE reads through omaAmbientEnv: under OMA the " +
      "operator's npm cache setting cannot steer npx resolution into a " +
      "host-controlled cache directory (and OMA's config validator rejects " +
      "command:'npx'/'npm' outright, so this path is belt on suspenders).",
    edits: [
      {
        find: `import crossSpawn from "cross-spawn";`,
        replace: `import crossSpawn from "cross-spawn";
import { omaAmbientEnv } from "./utils.js";`,
      },
      {
        find: `    if (process.env.NPM_CONFIG_CACHE) {
        npmCacheDirCached = process.env.NPM_CONFIG_CACHE;`,
        replace: `    if (omaAmbientEnv().NPM_CONFIG_CACHE) {
        npmCacheDirCached = omaAmbientEnv().NPM_CONFIG_CACHE;`,
      },
    ],
  },
  "bearer-command-resolver.js": {
    reason:
      "The `!command` bearer-token sink is refused under OMA before the " +
      "shell spawn runs — same permit as resolveCommandSecret's " +
      "credential-command gate; upstream's error path (a failed command) is " +
      "what a denied resolution surfaces as.",
    edits: [
      {
        find: `import { spawn } from "node:child_process";`,
        replace: `import { spawn } from "node:child_process";
import { omaAmbientEnv, omaRequirePermit } from "./utils.js";`,
      },
      {
        find: `function runCommand(command, context, signal) {
    return new Promise((resolve, reject) => {`,
        replace: `function runCommand(command, context, signal) {
    omaRequirePermit("credential-command", context);
    return new Promise((resolve, reject) => {`,
      },
      {
        find: `    const parsed = Number(process.env[ENV_TTL_MS] || DEFAULT_TTL_MS);`,
        replace: `    const parsed = Number(omaAmbientEnv()[ENV_TTL_MS] || DEFAULT_TTL_MS);`,
      },
    ],
  },
  "request-headers-command.js": {
    reason:
      "The per-request `!command` header sink is refused under OMA before " +
      "the spawned header command runs — same credential-command permit — " +
      "and the command's own env spread inherits the omaChildEnv-scrubbed " +
      "ambient set instead of process.env verbatim, so even a path that " +
      "reached it could not inherit the engine's environment. The " +
      "PI_MCP_ADAPTER_TEST_FAIL_PS selector reads omaAmbientEnv.",
    edits: [
      {
        find: `import { interpolateEnvVars } from "./utils.js";`,
        replace: `import { interpolateEnvVars, omaAmbientEnv, omaChildEnv, omaRequirePermit } from "./utils.js";`,
      },
      {
        find: `async function invokeRequestHeadersCommand(config, envelope, signal) {
    const resolved = resolvedCommand(config);`,
        replace: `async function invokeRequestHeadersCommand(config, envelope, signal) {
    omaRequirePermit("credential-command", \`MCP requestHeadersCommand \${JSON.stringify(config)}\`);
    const resolved = resolvedCommand(config);`,
      },
      {
        find: `    if (process.env.PI_MCP_ADAPTER_TEST_FAIL_PS === "1")
        return { status: 1, signal: null, stdout: "" };`,
        replace: `    if (omaAmbientEnv().PI_MCP_ADAPTER_TEST_FAIL_PS === "1")
        return { status: 1, signal: null, stdout: "" };`,
      },
      {
        find: `        env: {
            ...process.env,
            ...Object.fromEntries(Object.entries(config.env ?? {}).map(([key, value]) => [key, interpolateEnvVars(value)])),
        },`,
        replace: `        env: {
            ...omaChildEnv(process.env),
            ...Object.fromEntries(Object.entries(config.env ?? {}).map(([key, value]) => [key, interpolateEnvVars(value)])),
        },`,
      },
    ],
  },
  "mcp-auth-flow.js": {
    reason:
      "Browser-open gating for the OAuth flow: the `open` package call " +
      "becomes conditional on the browser-open permit. Under OMA's default " +
      "the call short-circuits to a rejection, which upstream's own catch " +
      "already degrades to 'Failed to open browser; waiting for manual " +
      "callback' — the manual-URL path keeps working.",
    edits: [
      {
        find: `import { formatTerminalError, interpolateEnvVars } from "./utils.js";`,
        replace: `import { formatTerminalError, interpolateEnvVars, omaPermits } from "./utils.js";`,
      },
      {
        find: `                await abortable(Promise.resolve(options.openAuthorizationUrl
                    ? options.openAuthorizationUrl(authorizationUrl)
                    : open(authorizationUrl)), signal);`,
        replace: `                await abortable(Promise.resolve(options.openAuthorizationUrl
                    ? options.openAuthorizationUrl(authorizationUrl)
                    : omaPermits("browser-open") ? open(authorizationUrl) : Promise.reject(new Error("browser opening is disabled at the OMA boundary"))), signal);`,
      },
    ],
  },
  "elicitation-handler.js": {
    reason:
      "Browser-open gating for URL elicitation: the `open` package call " +
      "becomes conditional on the browser-open permit under OMA.",
    edits: [
      {
        find: `import open from "open";
import { abortable, throwIfAborted } from "./abort.js";`,
        replace: `import open from "open";
import { abortable, throwIfAborted } from "./abort.js";
import { omaPermits } from "./utils.js";`,
      },
      {
        find: `        await abortable(open(params.url), signal);`,
        replace: `        await abortable(omaPermits("browser-open") ? open(params.url) : Promise.reject(new Error("browser opening is disabled at the OMA boundary")), signal);`,
      },
    ],
  },
  "mcp-output-guard.js": {
    reason:
      "Output-spill containment: oversized tool results upstream spills to " +
      "os.tmpdir() land under the OMA policy's scratch root instead, so " +
      "spill files are created where OMA's lifecycle cleanup owns them. " +
      "Without a policy tmpdir() stands.",
    edits: [
      {
        find: `import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead, } from "@earendil-works/pi-coding-agent";`,
        replace: `import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead, } from "@earendil-works/pi-coding-agent";
import { omaAmbientEnv, omaTmpdir } from "./utils.js";`,
      },
      {
        find: `        const dir = await mkdtemp(join(tmpdir(), "pi-mcp-output-"));`,
        replace: `        const dir = await mkdtemp(join(omaTmpdir(), "pi-mcp-output-"));`,
      },
      {
        find: `    const value = process.env[name]?.trim().toLowerCase();`,
        replace: `    const value = omaAmbientEnv()[name]?.trim().toLowerCase();`,
      },
    ],
  },
});

/** Every upstream .ts module the runtime emits — upstream's whole flat
 * module set, no exclusions: index.ts is the extension entry the adapter
 * drives, and its (lazy) import graph covers the rest. A new upstream
 * module fails the emit-set check rather than being silently picked up. */
function runtimeModules() {
  return readdirSync(UPSTREAM_DIR)
    .filter(name => name.endsWith(".ts") && !name.endsWith(".d.ts"))
    .sort();
}

/** The expected emitted file set: one .js + one .d.ts per module plus the
 * verbatim asset copies (RUNTIME_ASSETS and skills/). A surprise file —
 * or a missing one — is a regeneration failure, not a partial runtime. */
function expectedEmit(modules) {
  const out = modules.flatMap(name => [name.replace(/\.ts$/, ".js"), name.replace(/\.ts$/, ".d.ts")]);
  out.push(...RUNTIME_ASSETS);
  const skillsDir = join(UPSTREAM_DIR, "skills");
  if (statSync(skillsDir, { throwIfNoEntry: false })?.isDirectory())
    for (const name of filesUnder(skillsDir)) out.push(`skills/${name}`);
  return out.sort();
}

const SPECIFIER_TS = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'])(\.{1,2}\/[^"']+)\.ts\2/g;

/** Upstream writes sibling imports as "./x.ts". Node's loader needs the
 * emitted "./x.js", and tsc will not emit .js while .ts specifiers stand
 * (allowImportingTsExtensions forbids emit), so the staged source copy
 * carries the rewrite before compile. Any "./x" that is not ".ts" — an
 * extensionless or directory specifier — fails here: the upstream import
 * convention changed and this rewrite must be re-derived, not guessed. */
function rewriteSourceSpecifiers(name, text) {
  const next = text.replace(SPECIFIER_TS, (_m, head, quote, spec) => `${head}${quote}${spec}.js${quote}`);
  const leftover = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'])(\.{1,2}\/(?![^"']+\.js["'])[^"']+)\2/;
  const bad = next.match(leftover);
  if (bad) throw new Error(`upstream ${name} holds a non-.ts relative specifier: ${bad[0]}`);
  return next;
}

/** Compile the vendored modules with the repository's own tsc under
 * ESNext/bundler resolution (upstream's tsconfig is NodeNext+noEmit —
 * typecheck-only — so bundler is the mode that actually emits), from a
 * staged copy whose ".ts" specifiers are already ".js". The staging dir
 * sits inside the bundle so module resolution finds the vendored
 * node_modules/ first and the repo root's host API (@earendil-works/*,
 * typebox) behind it. Diagnostics do not stop the emit — vendored-code
 * type mismatches against OMA's host versions are a warning surface,
 * while the emitted-set check below is the completeness proof. */
export function emitRuntime(outDir) {
  const require = createRequire(import.meta.url);
  const tsc = join(dirname(require.resolve("typescript/package.json")), "bin", "tsc");
  const modules = runtimeModules();
  const staged = mkdtempSync(join(BUNDLE_DIR, ".emit-stage-"));
  try {
    for (const name of modules)
      writeFileSync(join(staged, name), rewriteSourceSpecifiers(name, readFileSync(join(UPSTREAM_DIR, name), "utf8")));
    const result = spawnSync(process.execPath, [
      tsc, ...modules.map(name => join(staged, name)),
      "--outDir", outDir, "--rootDir", staged,
      "--declaration", "--target", "esnext", "--module", "esnext",
      "--moduleResolution", "bundler", "--strict", "--skipLibCheck",
      "--esModuleInterop", "--isolatedModules", "--types", "node",
    ], { cwd: root, encoding: "utf8", timeout: 240000, killSignal: "SIGKILL" });
    if (result.error) throw result.error;
    if (result.signal) throw new Error(`tsc killed by ${result.signal}`);
    // Upstream's non-.ts payload the emitted modules reach by URL/dirname —
    // verbatim copies, part of the emitted set.
    for (const name of RUNTIME_ASSETS)
      copyFileSync(join(UPSTREAM_DIR, name), join(outDir, name));
    const skillsDir = join(UPSTREAM_DIR, "skills");
    if (statSync(skillsDir, { throwIfNoEntry: false })?.isDirectory()) {
      const { mkdirSync } = require("node:fs");
      for (const name of filesUnder(skillsDir)) {
        mkdirSync(dirname(join(outDir, "skills", name)), { recursive: true });
        copyFileSync(join(skillsDir, name), join(outDir, "skills", name));
      }
    }
    const emitted = filesUnder(outDir);
    const expected = expectedEmit(modules);
    if (JSON.stringify(emitted) !== JSON.stringify(expected))
      throw new Error(`tsc emit mismatch: got [${emitted.join(", ")}]\nexpected [${expected.join(", ")}]\n${result.stdout ?? ""}${result.stderr ?? ""}`);
    if (result.status !== 0)
      process.stderr.write(`pi-mcp-adapter emit diagnostics (emit completed; the emitted set matched):\n${(result.stdout ?? "").slice(0, 4000)}\n`);
    applyDivergences(outDir, OMA_DIVERGENCES);
    return emitted;
  } finally {
    rmSync(staged, { recursive: true, force: true });
  }
}

function packageMetadata() {
  const pkg = JSON.parse(readFileSync(join(UPSTREAM_DIR, "package.json"), "utf8"));
  if (pkg.name !== EXPECTED_PACKAGE.name || pkg.version !== EXPECTED_PACKAGE.version)
    throw new Error(`upstream/package.json is not ${EXPECTED_PACKAGE.name}@${EXPECTED_PACKAGE.version}`);
  return {
    name: EXPECTED_PACKAGE.name,
    version: EXPECTED_PACKAGE.version,
    license: pkg.license ?? "MIT",
    repository: pkg.repository?.url ?? "git+https://github.com/nicobailon/pi-mcp-adapter.git",
    commit: EXPECTED_PACKAGE.commit,
    npm: {
      tarball: `https://registry.npmjs.org/pi-mcp-adapter/-/pi-mcp-adapter-${EXPECTED_PACKAGE.version}.tgz`,
      integrity: EXPECTED_PACKAGE.npmIntegrity,
      shasum: EXPECTED_PACKAGE.npmShasum,
    },
  };
}

/** The manifest's own words, compared against what this script would
 * declare today: the divergence table must equal OMA_DIVERGENCES (reason
 * text and edit count), package.* must equal the pinned upstream identity,
 * and the dependency table must equal DEPENDENCIES. A regenerated or
 * hand-edited manifest that drifted from the declared pins fails --check
 * even when every file record and the bundle digest still match. Exported
 * so the regression test can drive the same function the check runs. */
export function manifestMetadataProblems(manifest) {
  const problems = [...divergenceProblems(manifest, OMA_DIVERGENCES), ...vendorPackagingProblems(manifest, BUNDLE_DIR)];
  const expectedPackage = packageMetadata();
  if (canonical(manifest?.package) !== canonical(expectedPackage))
    problems.push("manifest package does not match the pinned upstream identity");
  if (canonical(manifest?.generated?.dependencies) !== canonical(DEPENDENCIES))
    problems.push("manifest generated.dependencies does not match the pinned dependency closure");
  return problems;
}

/** The vendored dependency closure's identity half: every declared
 * package's vendored package.json must carry the pinned version (and a
 * package name equal to the leaf of its vendored path). (Bytes are bound
 * by manifest.files + bundleSha256; this guards the pin table itself.) */
function dependencyProblems() {
  const problems = [];
  for (const [path, pin] of Object.entries(DEPENDENCIES)) {
    const segments = path.split("/");
    const leaf = segments[segments.length - 1];
    const expectedName = segments.length > 1 && segments[segments.length - 2].startsWith("@")
      ? `${segments[segments.length - 2]}/${leaf}` : leaf;
    const pkgPath = join(BUNDLE_DIR, "node_modules", ...segments, "package.json");
    let pkg;
    try { pkg = JSON.parse(readFileSync(pkgPath, "utf8")); }
    catch { problems.push(`vendored dependency ${path} is missing package.json`); continue; }
    if (pkg.version !== pin.version)
      problems.push(`vendored dependency ${path} is ${pkg.name}@${pkg.version}; expected ${pin.version}`);
    if (pkg.name !== expectedName)
      problems.push(`vendored dependency ${path} is named ${pkg.name}; expected ${expectedName}`);
  }
  return problems;
}

/** Derived compatibility data, never a second hand-maintained SDK policy.
 * Read both platform branches and require ESM/CJS agreement. OMA's independent
 * allowlists still decide which of these names may survive at spawn. */
export function sdkStdioEnvironmentSource(bundleDir = BUNDLE_DIR) {
  const lists = ["stdio.mjs", "stdio.cjs"].map(file => {
    const source = ts.createSourceFile(file, readFileSync(join(bundleDir, "node_modules", "@modelcontextprotocol", "client", "dist", file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    let declaration;
    const visit = node => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "DEFAULT_INHERITED_ENV_VARS") {
        if (declaration) throw new Error("SDK environment export is ambiguous");
        declaration = node;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    const value = declaration?.initializer;
    if (!value || !ts.isConditionalExpression(value)) throw new Error("SDK environment export must declare both platform lists");
    return [value.whenTrue, value.whenFalse].map(branch => {
      if (!ts.isArrayLiteralExpression(branch) || branch.elements.some(item => !ts.isStringLiteral(item)))
        throw new Error("SDK environment list contains a nonliteral name");
      return branch.elements.map(item => item.text);
    });
  });
  if (JSON.stringify(lists[0]) !== JSON.stringify(lists[1])) throw new Error("SDK ESM/CJS environment lists diverged");
  const names = [...new Set(lists[0].flat())].sort();
  return `/** Generated by scripts/vendor-pi-mcp-adapter.mjs from the pinned SDK. */\nexport const SDK_STDIO_ENV_UNDERLAY: readonly string[] = Object.freeze(${JSON.stringify(names, null, 2)});\n`;
}
const sdkMetadataPath = join(root, "packages/tool-mcp/src/mcp-sdk-env.ts");

function writeRuntime() {
  writeRuntimeTree(RUNTIME_DIR, emitRuntime, "oma-mcp-adapter-emit-");
}

function writeManifest() {
  preserveNpmMetadata(BUNDLE_DIR);
  const records = bundleRecords(BUNDLE_DIR);
  const manifest = {
    kind: "oma-vendored-bundle-v1",
    package: packageMetadata(),
    generated: {
      runtime:
        "tsc emit of every upstream root-level .ts module (index.ts is the " +
        "extension entry whose createMcpAdapter export the OMA adapter " +
        "drives — no exclusions), compiled under ESNext/bundler resolution " +
        "from a staged copy whose relative .ts specifiers were mechanically " +
        "rewritten to .js, plus verbatim copies of the non-.ts payload the " +
        "emitted modules reach by URL (mcp-script-worker.mjs, " +
        "mcp-keyring-helper.cjs, app-bridge.bundle.js, package.json, " +
        "skills/), then OMA divergence splices applied",
      tool: "scripts/vendor-pi-mcp-adapter.mjs",
      divergences: divergenceMetadata(OMA_DIVERGENCES),
      dependencies: DEPENDENCIES,
      packaging: NPM_METADATA_PACKAGING,
      upstreamTests:
        "upstream-tests/ is the repository's test surface at the vendored " +
        "commit (the npm tarball ships no tests): __tests__/ wholesale, the " +
        "root *.test.ts/*.test.mjs files, test-runner.mjs, vitest.config.ts, " +
        "the conformance/ driver and the tsconfigs the suite compiles " +
        "under; kept for provenance and porting, not wired into npm test — " +
        "upstream's suite needs vitest, the upstream repo layout and for " +
        "most suites the network",
    },
    files: records,
    bundleSha256: bundleDigest(records),
  };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function check() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const problems = bundleRecordProblems(manifest, BUNDLE_DIR);
  const pkg = JSON.parse(readFileSync(join(UPSTREAM_DIR, "package.json"), "utf8"));
  if (manifest.package?.name !== pkg.name || manifest.package?.version !== pkg.version)
    problems.push("manifest package identity does not match upstream/package.json");
  if (!statSync(UPSTREAM_TESTS_DIR, { throwIfNoEntry: false })?.isDirectory())
    problems.push("upstream-tests/ is missing (the vendored commit's test tree belongs here)");
  problems.push(...dependencyProblems());
  if (!existsSync(sdkMetadataPath) || readFileSync(sdkMetadataPath, "utf8") !== sdkStdioEnvironmentSource())
    problems.push("MCP SDK environment metadata is stale; regenerate with --write-sdk-metadata");
  // The manifest's own metadata is verified too: the divergence table must
  // equal this script's OMA_DIVERGENCES, package.* the pinned identity and
  // generated.dependencies the pinned closure, so a regenerated manifest
  // cannot launder a drifted splice or dependency set.
  problems.push(...manifestMetadataProblems(manifest));
  // The emitted runtime must be exactly what tsc produces from the vendored
  // sources plus the specifier rewrite and the declared OMA divergence
  // splices -- a hand-edited runtime/ file fails here even if someone
  // regenerated the manifest to match it, and so does a runtime missing a
  // declared splice.
  const scratch = mkdtempSync(join(tmpdir(), "oma-mcp-adapter-check-"));
  try {
    problems.push(...emittedRuntimeProblems(scratch, emitRuntime(scratch), RUNTIME_DIR));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (problems.length > 0) throw new Error(`vendored pi-mcp-adapter bundle is inconsistent:\n${problems.map(p => `  - ${p}`).join("\n")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const write = process.argv.slice(2).includes("--write");
    if (process.argv.includes("--write-sdk-metadata") || process.argv.includes("--check-sdk-metadata")) {
      const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
      const problems = bundleRecordProblems(manifest, BUNDLE_DIR);
      if (problems.length) throw new Error(problems.join("\n"));
      const expected = sdkStdioEnvironmentSource();
      if (process.argv.includes("--write-sdk-metadata")) {
        writeFileSync(sdkMetadataPath, expected);
        console.log("MCP_SDK_METADATA_WRITTEN");
      } else {
        if (readFileSync(sdkMetadataPath, "utf8") !== expected) throw new Error("MCP SDK environment metadata is stale");
        console.log("MCP_SDK_METADATA_CURRENT (bundle bytes and derived names only; no re-emit)");
      }
    } else
    if (write) { writeRuntime(); writeFileSync(sdkMetadataPath, sdkStdioEnvironmentSource()); const manifest = writeManifest(); console.log(JSON.stringify({ status: "BUNDLE_WRITTEN", files: manifest.files.length, bundleSha256: manifest.bundleSha256 })); }
    else { check(); console.log(JSON.stringify({ status: "BUNDLE_CURRENT", files: bundleRecords(BUNDLE_DIR).length })); }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
