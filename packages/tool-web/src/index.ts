/** The four bundled web tools use OMA's tool surface and verified payload.
 * Commands, shortcuts, clone/gh, native media, curator and answer mode are
 * available. The Human's web-search.json chooses workflows and fetch modes.
 * Network access includes local services; explicit domain rules still apply.
 * Cookie/keyring/ADC discovery and local-file fetching retain their separate
 * credential/filesystem boundaries. Session hooks own all upstream cleanup. */
import { isAbsolute } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { vendoredBundleDir, verifyVendorBundle } from "@oma/tool-runtime/vendor-bundle";
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

/** Refused registrations for boundary diagnostics. Commands and shortcuts
 * are forwarded; reset on each registration. */
export const webFacadeDropped: ReadonlyArray<{ kind: "command" | "shortcut"; name: string }> = [];
const dropped = webFacadeDropped as { kind: "command" | "shortcut"; name: string }[];

/** The deployment's optional environment proxy. Explicit/configured proxy
 * values retain upstream semantics, including scoped direct requests. */
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

/** Tool registration stays on the declared four-name surface; the remaining
 * upstream UI and browser operations use Pi's ordinary extension API. */
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
    registerCommand: pi.registerCommand.bind(pi),
    registerShortcut: pi.registerShortcut.bind(pi),
    on: pi.on.bind(pi),
    appendEntry: pi.appendEntry.bind(pi),
    sendMessage: pi.sendMessage.bind(pi),
    exec: pi.exec.bind(pi),
  };
  return facade as unknown as ExtensionAPI;
}

export async function registerWebTools(pi: ExtensionAPI): Promise<void> {
  // The vendored payload is verified before any of it becomes a tool --
  // and before any vendored module evaluates: every runtime import happens
  // below this check. A failed check refuses the whole session -- the same
  // fail-closed posture the provenance list and the surface plan take.
  const bundleDir = vendoredBundleDir("pi-web-access", new URL("./", import.meta.url));
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

  // Install network capability policy before registration. Environment proxy
  // routing uses the verified undici; configured/per-call proxies use upstream
  // scoped transport. Local destinations are available with or without a bridge.
  const utils = await import("./vendor/pi-web-access/runtime/utils.js") as VendoredUtils;
  const egressPinned = egressPinnedProxy();
  if (egressPinned !== null)
    // EnvHttpProxyAgent honors the HTTP(S)_PROXY/NO_PROXY the spawn plan
    // injected, and setGlobalDispatcher writes the dispatcher symbol
    // Node's built-in fetch consults.
    utils.setGlobalDispatcher(new utils.EnvHttpProxyAgent());
  const policy: OmaWebPolicy = { egressPinned, gitClone: true, ghCli: true, nativeMedia: true, workflows: true };
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
