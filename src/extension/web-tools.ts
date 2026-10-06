/** web_research: the bundled pi-web-access extension (vendored byte-pinned
 * under `src/extension/vendor/pi-web-access/`) exposed as exactly four OMA
 * tools -- `web_search`, `source_check`, `fetch_content`,
 * `get_search_content` -- inside OMA's authority model rather than
 * upstream's "host pi extension" model.
 *
 * What OMA owns, and where it lives:
 *
 * - Integrity: `verifyVendorBundle` runs at registration, and only after it
 *   passes is any vendored module evaluated -- every runtime import here is
 *   a dynamic `await import()` behind that check (this module itself only
 *   type-imports vendored declarations, which erase at compile). A tampered
 *   or incomplete payload refuses the session, it does not degrade.
 * - Surface: OMA drives upstream's own extension factory through a facade
 *   ExtensionAPI. The facade forwards `registerTool` only for the four
 *   pinned names -- a renamed, extra or missing registration fails startup
 *   -- and forwards the session-lifecycle hooks (`on`), in-session result
 *   storage (`appendEntry`) and session messaging (`sendMessage`) upstream
 *   itself asks for. `registerCommand` and `registerShortcut` are dropped
 *   by policy: upstream pins all four slash commands off under the overlay,
 *   and the two curator/activity shortcuts drive surfaces OMA does not
 *   expose, so they are recorded, not registered. `exec` is refused: the
 *   only call site is the browser-open path OMA never reaches. There is no
 *   `registerProvider`, no dynamic tool loader, no curator server and no
 *   browser opening -- `web_enable` cannot appear because the overlay pins
 *   eager activation.
 * - Policy seam: before the factory runs, `omaInstallWebPolicy` installs
 *   the Society contract inside the vendored runtime. Every ambient-
 *   discovery escape upstream carries is a deny-by-default flag that stays
 *   closed: `!command` credential sources refuse before any shell runs;
 *   browser-cookie access (and the Keychain/secret-tool decryptor spawns
 *   behind it) reports unavailable regardless of env or config; `gh` is
 *   reported missing so every GitHub path takes upstream's anonymous
 *   REST/git fallbacks; the git/gh clone path refuses outright; the host's
 *   Google ADC file is never probed; yt-dlp/ffmpeg/ffprobe paths are off;
 *   local file and file:// fetches refuse; curator workflows resolve to
 *   none; and the init-config overlay pins the four default tool names,
 *   eager registration, readable+raw fetch modes (no answer-mode model
 *   call) and all four tools on. Literal, $ENV and file credentials keep
 *   upstream's semantics -- what they can see is the engine's own
 *   allowlisted environment and the OMA-owned web-search.json.
 * - Egress: when the Resident sandbox's egress wiring is present, the only
 *   proxy value a tool param or web-search.json may carry is the pin --
 *   `http://127.0.0.1:<OMA_EGRESS_PROXY_PORT>`, the loopback CONNECT
 *   forwarder the spawn plan already names in the env proxies -- enforced
 *   inside vendored `normalizeProxyUrl`. The adapter then installs the
 *   vendored undici's `EnvHttpProxyAgent` as the global fetch dispatcher,
 *   so upstream's every `fetch` rides the env proxies to the pin; the
 *   inference relay keeps working because the pinned `no_proxy` covers
 *   loopback. Upstream's curl-backed proxy transport is never installed
 *   under the policy (a divergence), so no curl subprocess or tmp files
 *   ever appear. With no egress wiring there is no pin and no dispatcher
 *   -- a host engine fetches directly under upstream's own SSRF rules.
 * - SSRF/redirect/output bounds: unchanged upstream -- scheme, hostname,
 *   domain policy and resolved-address checks in ssrf-protection.js,
 *   redirect revalidation, and the byte limits config clamps are all kept.
 *   The one divergence is preflight: with the pin installed the remote-DNS
 *   proxy skip applies to the pin itself, because inside a sandbox no local
 *   resolver exists and the CONNECT allowlist is the authoritative screen.
 * - Filesystem: the config path resolves through `PI_CODING_AGENT_DIR`,
 *   which OMA sets to the OMA-owned agent directory for every engine; the
 *   fetch cache lives under it (`web-search-cache/`), and session results
 *   live in the session's own entries through `appendEntry`. The clone
 *   root, cookie stores and ADC paths are all closed by the policy seam.
 * - Lifecycle: upstream's own `session_start`/`session_tree`/
 *   `session_shutdown` hooks are forwarded, so per-session state -- pending
 *   fetches, stored results, curator/clone caches, the activity monitor --
 *   resets and drains exactly as upstream intends; the run-lifecycle
 *   resets it registers are inert under the workflow pin.
 * - Dependencies: the bundle's own `node_modules` resolves every vendored
 *   dependency import; nothing reaches a user-installed package, and the
 *   undici that supplies the dispatcher is itself a literal specifier
 *   inside the verified bundle.
 */
import { isAbsolute } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { vendoredBundleDir, verifyVendorBundle } from "./vendor-bundle.js";
// Type-only: erased at compile, so this never evaluates the vendored
// module before verification (PI-001 keeps runtime imports out too).
import type { OmaWebPolicy } from "./vendor/pi-web-access/runtime/utils.js";

/** The web_research group, verbatim: the tool names the surface plan and
 * the facade both pin. Order is upstream's own registration order. */
export const WEB_RESEARCH_TOOL_NAMES = Object.freeze([
  "web_search",
  "source_check",
  "fetch_content",
  "get_search_content",
] as const);

export interface WebToolsOptions {
  /** The bundle root to verify -- defaults to the deployed vendored copy
   * beside this module. Tests point it at a copy they may corrupt. */
  readonly bundleDir?: string | undefined;
}

/** Registrations the facade refused, in order: every slash command
 * upstream would register (zero under the overlay) and every shortcut
 * (the two curator/activity ones upstream registers unconditionally).
 * Exported read-only for the boundary tests; reset on each registration. */
export const webFacadeDropped: ReadonlyArray<{ kind: "command" | "shortcut"; name: string }> = [];
const dropped = webFacadeDropped as { kind: "command" | "shortcut"; name: string }[];

/** The deployment's egress pin -- the Resident sandbox's loopback CONNECT
 * forwarder -- derived exactly as the spawn plan derives the env proxies:
 * a pin exists only beside `OMA_EGRESS_PROXY_SOCKET` (an absolute path)
 * and `OMA_EGRESS_PROXY_PORT` (a port). A host engine, or an env carrying
 * only part of the wiring, derives no pin: no proxy value is then
 * permitted at all (per-call or configured), and no dispatcher is
 * installed -- upstream's direct-fetch path and its SSRF preflight keep
 * their own semantics. */
function egressPinnedProxy(): string | null {
  const socket = process.env.OMA_EGRESS_PROXY_SOCKET;
  const port = process.env.OMA_EGRESS_PROXY_PORT;
  if (socket === undefined || !isAbsolute(socket) ||
    port === undefined || !/^\d+$/.test(port)) return null;
  return `http://127.0.0.1:${Number(port)}`;
}

interface VendoredExtension {
  default(pi: ExtensionAPI): void;
}
interface VendoredUtils {
  omaInstallWebPolicy(policy: OmaWebPolicy | undefined): void;
  /** The egress dispatcher surface the utils.js OMA seam re-exports from
   * the bundle's vendored undici, so this adapter's only dynamic
   * specifiers are runtime/ paths inside the verified payload. */
  EnvHttpProxyAgent: new () => unknown;
  setGlobalDispatcher(dispatcher: unknown): void;
}

/** The ExtensionAPI upstream's factory is allowed to see. Tools are the
 * only surface forwarded wholesale -- and only the four pinned names.
 * Commands and shortcuts are dropped (recorded for the tests); exec is
 * refused, not dropped: the only caller is the browser-open path, which
 * must never run, and a silent drop would hide a real attempt to reach
 * it. Everything else upstream calls -- `on`, `appendEntry`,
 * `sendMessage` -- is session plumbing OMA wants kept. */
function webFacade(pi: ExtensionAPI, registered: Set<string>): ExtensionAPI {
  const facade = {
    registerTool(definition: { name: string }) {
      if (!(WEB_RESEARCH_TOOL_NAMES as readonly string[]).includes(definition.name))
        throw new Error(`[E_OMA_WEB_SURFACE] vendored pi-web-access tried to register unlisted tool ${JSON.stringify(definition.name)}`);
      if (registered.has(definition.name))
        throw new Error(`[E_OMA_WEB_SURFACE] vendored pi-web-access registered ${definition.name} twice`);
      registered.add(definition.name);
      return pi.registerTool(definition as Parameters<ExtensionAPI["registerTool"]>[0]);
    },
    registerCommand(name: string) { dropped.push({ kind: "command", name }); },
    registerShortcut(name: string) { dropped.push({ kind: "shortcut", name: String(name) }); },
    on: pi.on.bind(pi),
    appendEntry: pi.appendEntry.bind(pi),
    sendMessage: pi.sendMessage.bind(pi),
    exec() {
      throw new Error("[E_OMA_SUBPROCESS] vendored pi-web-access asked for pi.exec -- the only call site is browser opening, which OMA does not expose");
    },
  };
  return facade as unknown as ExtensionAPI;
}

export async function registerWebTools(pi: ExtensionAPI, options?: WebToolsOptions): Promise<void> {
  // The vendored payload is verified before any of it becomes a tool --
  // and before any vendored module evaluates: every runtime import happens
  // below this check. A failed check refuses the whole session -- the same
  // fail-closed posture the provenance list and the surface plan take.
  const bundleDir = options?.bundleDir ?? vendoredBundleDir("pi-web-access");
  try {
    verifyVendorBundle(bundleDir);
  } catch (error) {
    pi.on("session_start", () => {
      try {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`bundled pi-web-access payload failed integrity verification; refusing session: ${message}\n`);
      } catch { /* best effort */ }
      process.exit(1);
    });
    return;
  }

  // The egress pin decides the policy's proxy half before the policy is
  // installed: with the wiring present the pin is the only proxy value
  // vendored code may carry, and the vendored undici becomes global
  // fetch's dispatcher so the env proxies route it. Without the wiring
  // there is no pin and no dispatcher -- no proxy value at all is then
  // permitted, and upstream's own direct-fetch SSRF rules stand.
  const utils = await import("./vendor/pi-web-access/runtime/utils.js") as VendoredUtils;
  const egressPinned = egressPinnedProxy();
  if (egressPinned !== null)
    // EnvHttpProxyAgent honors the HTTP(S)_PROXY/NO_PROXY the spawn plan
    // injected, and setGlobalDispatcher writes the dispatcher symbol
    // Node's built-in fetch consults.
    utils.setGlobalDispatcher(new utils.EnvHttpProxyAgent());
  // The Society contract: only egressPinned is set; every ambient-
  // discovery permit stays unset (deny-by-default), so credential
  // commands, browser cookies, the gh/git subprocesses, the host ADC
  // probe, native media, local files and curator workflows all refuse.
  const policy: OmaWebPolicy = { egressPinned };
  utils.omaInstallWebPolicy(policy);

  const vendored = await import("./vendor/pi-web-access/runtime/index.js") as VendoredExtension;
  dropped.length = 0;
  const registered = new Set<string>();
  vendored.default(webFacade(pi, registered));

  // The surface contract, asserted after the factory ran: exactly the
  // four pinned names, once each, in upstream's own registration order --
  // a renamed, missing, extra or reordered registration is an adapter
  // bug, not a configuration, so it fails the extension load rather than
  // registering half a surface.
  const names = [...registered];
  if (names.length !== WEB_RESEARCH_TOOL_NAMES.length ||
    !WEB_RESEARCH_TOOL_NAMES.every(name => registered.has(name)))
    throw new Error(`[E_OMA_WEB_SURFACE] vendored pi-web-access registered [${names.join(", ")}]; expected exactly [${WEB_RESEARCH_TOOL_NAMES.join(", ")}]`);
}
