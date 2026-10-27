/** Worker-specific recipe. Shared TS owns actor/root/access/environment
 * policy; Seatbelt applies it without creating a mount or process namespace.
 * A recipe establishes no kernel scope or execution/file binding proof. */
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { SandboxHost, SandboxDirectories, SandboxEndpoints } from "@oma/contracts/runtime";
import { StoreError } from "@oma/domain/errors";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
import { residentDirectoryPolicy, residentEnvironment, nodeToolchainMounts } from "@oma/domain/resident-paths";
import { assertResidentContext, assertSandboxInstallation } from "@oma/protocol/resident-context";
import { trustedAbsolutePath, type ValidatedRunLease } from "@oma/protocol/run-lease";
import { prepareSeatbelt, type SeatbeltPath } from "./seatbelt.js";
import { machRendezvousName } from "./mach-address.js";
import { decodeMacDeveloperTools, type MacDeveloperTools } from "@oma/protocol/mac-developer-tools";
import { developerToolDirectories } from "./developer-tools.js";

const ENGINE_KEYS = ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL",
  "OMA_ACTOR", "OMA_SOCIETY", "OMA_SOCKET", "OMA_BATCH_VIEW", "OMA_FRAME_BYTES", "OMA_BATCH_MAX_MESSAGES",
  "OMA_MAIL_BYTES", "OMA_MAIL_ADDRESSES", "OMA_CONTEXT_BYTES", "OMA_BUNDLE_BYTES", "OMA_MAIL_ARCHIVE",
  "OMA_WORKER_ARCHIVE", "OMA_PROJECT_GIT", "OMA_AGENT_HOME", "OMA_PACKAGE_STORE", "OMA_TOOL_SURFACE",
  "OMA_VERIFIED_EXTENSIONS", "OMA_TOOL_SCOPE", "NODE_OPTIONS", "PI_CODING_AGENT_DIR",
  "OMA_INFERENCE_SOCKET", "OMA_INFERENCE_PROVIDER", "OMA_INFERENCE_PORT", "OMA_INFERENCE_KEY",
  "OMA_EGRESS_PROXY_SOCKET", "OMA_EGRESS_PROXY_PORT", "HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy",
  "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy"];
const directory = (path: string): SeatbeltPath => ({ path, kind: "directory" });
const beneath = (value: string, root: string): boolean => value === root || value.startsWith(`${root}/`);
export function residentSeatbelt(host: SandboxHost, lease: ValidatedRunLease, directories: SandboxDirectories,
  toolsInput: MacDeveloperTools, environment: Readonly<Record<string, string>> = {}, endpoints: SandboxEndpoints = {}): ReturnType<typeof prepareSeatbelt> {
  assertSandboxInstallation(host); assertResidentContext(host, lease, directories);
  const tools = decodeMacDeveloperTools(toolsInput), developerBins = developerToolDirectories(tools);
  if (!beneath(host.pi, host.libdir))
    throw new StoreError("UNSUPPORTED_PROFILE", "Mac Worker Pi entry must be inside the trusted installation");
  for (const endpoint of [endpoints.inference, endpoints.egress])
    if (endpoint !== undefined && !trustedAbsolutePath(endpoint))
      throw new StoreError("UNSUPPORTED_PROFILE", "Mac Worker endpoints require trusted absolute paths");
  const roots = residentDirectoryPolicy(host, directories);
  const readable = roots.filter(root => !root.writable).map(root => directory(root.path));
  const writable = roots.filter(root => root.writable).map(root => directory(root.path));
  const toolchain = nodeToolchainMounts(host.node).map(([source]) => directory(source));
  readable.push(...toolchain, directory(tools.contents));
  // A broad installation/package root must never expose the complete state
  // or overlap a writable actor root. These are lexical recipe checks; actual
  // aliases/renames still require G-FILES and cannot be certified by this map.
  for (const root of [host.libdir, host.packages, tools.contents, ...toolchain.map(entry => entry.path)].filter((value): value is string => value !== undefined))
    if (beneath(host.stateRoot!, root) || beneath(root, host.stateRoot!) || writable.some(entry => beneath(root, entry.path) || beneath(entry.path, root)))
      throw new StoreError("UNSUPPORTED_PROFILE", "Mac Worker installation roots overlap private state");
  const base = { ...residentEnvironment({ libdir: host.libdir, node: host.node, home: directories.home, temporary: directories.home }, developerBins),
    GIT_EXEC_PATH: tools.execPath };
  const allowed = new Set([...Object.keys(base), ...ENGINE_KEYS]);
  for (const [key, value] of Object.entries(environment))
    if (!allowed.has(key) || typeof value !== "string" || value.includes("\0"))
      throw new StoreError("UNSUPPORTED_PROFILE", "Mac Worker environment contains an unapproved entry");
  const preload = join(host.libdir, DEPLOYMENT_LAYOUT.clientPreload), nodeOptions = `--import=${pathToFileURL(preload).href}`;
  if (environment.NODE_OPTIONS !== undefined && environment.NODE_OPTIONS !== nodeOptions)
    throw new StoreError("UNSUPPORTED_PROFILE", "Mac Worker requires its exact trusted client preload");
  const env = { ...environment, ...base, NODE_OPTIONS: nodeOptions, OMA_ACTOR: lease.actor,
    OMA_FRAME_BYTES: String(host.limits!.frameBytes), OMA_BATCH_MAX_MESSAGES: String(host.limits!.batchMaxMessages) };
  return prepareSeatbelt({ executable: host.node, argv: [host.pi, ...host.piModeArgs], cwd: directories.workspace, env,
    timeoutMs: null, stdoutBytes: 0, stderrBytes: 0 }, {
    readable, writable,
    denied: (host.hidden ?? []).map(entry => ({ path: join(host.libdir, entry.path), kind: entry.kind === "dir" ? "directory" : "file" })),
    executable: [{ path: host.node, kind: "file" }, directory(host.libdir),
      ...(host.packages === undefined ? [] : [directory(host.packages)]), ...toolchain, ...writable,
      { path: tools.git, kind: "file" }, directory(tools.execPath), ...developerBins.map(directory)],
    mapped: [directory(tools.contents)],
    unixSockets: [endpoints.inference, endpoints.egress].filter((value): value is string => value !== undefined),
    machServices: [machRendezvousName(lease.socketHostPath)], environmentKeys: [...allowed], nodePreload: preload,
  });
}
