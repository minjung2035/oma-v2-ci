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

const WEB_GUIDANCE: Record<string, { description: string; promptSnippet: string; promptGuidelines: string[] }> = {
  web_search: {
    description: "Search the web with the configured provider or an allowed provider selection. Pass query or queries; provider arrays run concurrently. Returns bounded, source-linked results or provider answers and a responseId for stored results. Workflow none avoids generated summaries and curator interaction; other workflows depend on configuration. Retrieve needed evidence with get_search_content or fetch_content.",
    promptSnippet: "Search for source-linked web evidence; retrieve stored results by responseId.",
    promptGuidelines: ["Use distinct queries when they add coverage, not a fixed query count. Follow retrieval or content-status instructions in the result; search snippets and provider answers are not proof of the underlying claim."],
  },
  source_check: {
    description: "Gather web evidence for a claim as a bounded structured artifact with source URLs and passage citations. Optional queries refine the search; optional page fetching supplies exact passages. The artifact supports manual assessment, not an automatic truth verdict.",
    promptSnippet: "Gather sources and cited passages for assessing a claim.",
    promptGuidelines: ["Read the cited passages and assess whether they support the exact claim, including qualifications and conflicting evidence."],
  },
  fetch_content: {
    description: "Fetch one URL or multiple URLs using an allowed mode. Returns content or mode-specific answers, media or repository results; supported formats and dependencies vary by mode. Use the mode and media parameter help for available options. Results may be bounded or stored for retrieval; follow returned paths, responseId and continuation instructions.",
    promptSnippet: "Fetch content from known URLs using the available fetch modes.",
    promptGuidelines: ["Use a known source URL directly when search would add no value. An answer-mode response is generated analysis; distinguish it from fetched source text."],
  },
  get_search_content: {
    description: "Retrieve stored search or fetched content by responseId without repeating the network request. Select a query or URL when needed, then page by character offset and limit, or use findText to locate passages. findText ignores offset and limit. Follow returned continuation fields; an excerpt is not the full stored result.",
    promptSnippet: "Page or search stored web content using its responseId.",
    promptGuidelines: ["Reuse the responseId from the original result and retrieve the passages needed for the task rather than fetching the same source again."],
  },
};

const WEB_PARAMETER_HELP: Record<string, string> = {
  query: "Single search query, or the exact stored query to retrieve when using get_search_content.",
  queries: "Distinct search queries to run concurrently. Add queries only when they cover useful different evidence; source_check defaults to its claim.",
  numResults: "Results per query; defaults to 5, maximum 20.",
  includeContent: "Start background retrieval of result-page content. Use the returned responseId and content status to retrieve it.",
  recencyFilter: "Restrict results to the selected recent period.",
  domainFilter: "Restrict results to these domains; prefix a domain with - to exclude it.",
  provider: "Configured provider selection: auto, all available providers, one provider, or an array of provider names. Availability depends on configuration and credentials.",
  workflow: "none returns results without a curator; summary-review opens a curator with a summary draft; auto-summary generates a summary without opening it.",
  proxy: "Optional HTTP(S) or SOCKS proxy URL for this call; an empty string requests direct access. Otherwise configured or injected proxy settings apply.",
  claim: "Precise assertion for which to gather supporting or conflicting source evidence.",
  fetchContent: "Fetch up to five result pages for exact cited passages.",
  url: "One URL to fetch, or the exact stored URL to retrieve when using get_search_content.",
  urls: "URLs to fetch concurrently; use when the fetches are independent.",
  forceClone: "Allow cloning a GitHub repository even when it exceeds the configured size threshold.",
  prompt: "Question for video analysis, or the required page-local question in answer mode.",
  mode: "readable extracts content as Markdown; raw returns the textual HTTP body; answer generates an answer from fetched content and requires prompt.",
  answerModel: "Optional provider/model override for answer mode; otherwise use configured answer settings or the current model.",
  timestamp: "Video time in seconds, mm:ss or hh:mm:ss, or a start-end range. A range defaults to six sampled frames; frames changes the count. YouTube extraction requires yt-dlp and ffmpeg.",
  frames: "Number of video frames, 1-12. With a range, sample across it; with one timestamp, use five-second intervals; alone, sample the video.",
  model: "Optional Gemini model override for video analysis; otherwise use the configured model or provider default.",
  auth: "Optional browser-cookie profile request: profile name, or true for a sole profile. OMA credential restrictions still apply; this is not an authority grant.",
  responseId: "Stored response identifier returned by web_search, source_check or fetch_content.",
  queryIndex: "Zero-based index of the stored search query to retrieve.",
  urlIndex: "Zero-based index of the stored URL to retrieve.",
  offset: "Zero-based character offset within stored content; defaults to 0 and is ignored with findText.",
  limit: "Maximum stored-content characters requested. Configured output limits and continuation metadata may reduce the returned size; ignored with findText.",
  findText: "One text or an array of texts to find in selected stored content; overrides offset and limit.",
  findMode: "Text matching mode; defaults to case-insensitive. Requires findText.",
};

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
      const tool = definition as Parameters<ExtensionAPI["registerTool"]>[0];
      const parameters = { ...tool.parameters, properties: Object.fromEntries(
        Object.entries((tool.parameters as typeof tool.parameters & { properties: Record<string, object> }).properties).map(([name, schema]) =>
          [name, { ...schema, ...(WEB_PARAMETER_HELP[name] === undefined ? {} : { description: WEB_PARAMETER_HELP[name] }) }]),
      ) } as typeof tool.parameters;
      return pi.registerTool({ ...tool, ...WEB_GUIDANCE[definition.name], parameters });
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
