/** The trusted Pi extension OMA loads into every engine it starts (PI-001).
 *
 * This file only composes; each responsibility lives in `src/extension/`. The
 * whole extension imports no OMA runtime module — only Node built-ins, the
 * engine's extension types and its schema library — so the same compiled
 * files run on the host and inside a Resident's sandbox. The architecture
 * checker holds that closure (`extension-closure`).
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerDelivery } from "./extension/delivery.js";
import { startEgressBridge } from "./extension/egress-bridge.js";
import { startInferenceBridge } from "./extension/inference-bridge.js";
import { omaToolNames, registerOmaTools } from "./extension/mail-tools.js";
import { integerEnv } from "./extension/shared.js";
import { PrincipalChannel } from "./extension/principal-channel.js";
import { createToolProvenance, verifiedExtensionPaths, VERIFIED_EXTENSIONS_ENV } from "./extension/provenance.js";
import { registerPromptBoundary } from "./extension/prompt-boundary.js";
import { registerToolSurface } from "./extension/tool-surface.js";
import { TOOL_SCOPE_ENV, TOOL_SCOPE_SANDBOX, PACKAGE_STORE_ENV, guardWorkspaceTools } from "./extension/workspace-guard.js";
import { containWorkspaceTools, createContainedWriter } from "./extension/contained-tools.js";
import { registerLspTools } from "./extension/lsp-tools.js";
import { registerHashlineTools } from "./extension/hashline-tools.js";
import { registerAskUserQuestion } from "./extension/ask-user-question.js";

export { decodeBatchViewText, readBatchView } from "./extension/batch-view.js";
export { OMA_TOOL_NAMES, cliEnvironment, registerOmaTools } from "./extension/mail-tools.js";
export { PrincipalChannel, PRINCIPAL_CHANNEL_ENV, PRINCIPAL_CHANNEL_FD } from "./extension/principal-channel.js";
export { SOCIETY_FENCE_ENV, SOCIETY_FENCE_FD } from "./client/fence.js";
export { PI_ADAPTER_REVISION, PI_BOUNDARY_PREFIX } from "./extension/delivery.js";
export { createToolProvenance, verifiedExtensionPaths, VERIFIED_EXTENSIONS_ENV } from "./extension/provenance.js";
export { registerPromptBoundary } from "./extension/prompt-boundary.js";
export {
  expandedActiveTools, initialActiveTools, parseSurfacePlan, registerToolSurface, type SurfaceFence,
} from "./extension/tool-surface.js";

export default async function extension(pi: ExtensionAPI) {
  const workspace = realpathSync(process.cwd());
  // Holds nothing unless the product attached its private channel, which it
  // does only for the Principal's engine.
  const channel = PrincipalChannel.open();
  const sandboxed = process.env[TOOL_SCOPE_ENV] === TOOL_SCOPE_SANDBOX;
  const waitRequested = registerOmaTools(pi, workspace, channel);
  const ownTools = omaToolNames(channel.attached);
  // D25: what may run is decided by where a tool came from -- a builtin, or an
  // extension file this engine was spawned with after digest verification --
  // never by the name it answers to. The tools this file registers are proven
  // by its own path, so OMA's tools stay authorized even when the verified
  // list is missing, and a shadow of an OMA name is not OMA's tool.
  const verified = verifiedExtensionPaths(process.env[VERIFIED_EXTENSIONS_ENV]);
  const provenance = createToolProvenance(
    () => pi.getAllTools(),
    fileURLToPath(import.meta.url),
    verified.paths,
  );
  // A verified-path list that was written but cannot be read is a policy the
  // engine is holding without being able to prove: the surface cannot be
  // trusted, so the session must not start.
  if (verified.malformed)
    pi.on("session_start", () => {
      try { process.stderr.write(`${VERIFIED_EXTENSIONS_ENV} is malformed; the verified extension set cannot be proven\n`); } catch { /* best effort */ }
      process.exit(1);
    });
  // Society's prompt policy: the role prompt owns identity, append channels
  // stay closed, the Principal's context files stay inside its workspace, and
  // the active tools' guidance reaches the prompt Pi's own composition omits.
  registerPromptBoundary(pi, workspace, channel.attached);
  registerToolSurface(pi, ownTools, { permitted: provenance.permitted, own: provenance.own });
  // C18: the environment names the installed-package store's real root, which
  // the engine's argv advertised resources under. A read may reach it; one
  // that cannot be resolved permits nothing, so the guard fails closed. The
  // same roots go to the contained read tools, so a path the guard admitted
  // under the store is the path the read effect reaches there.
  const readableRoots: string[] = [];
  const packageStore = process.env[PACKAGE_STORE_ENV];
  if (packageStore !== undefined) {
    try { readableRoots.push(realpathSync(packageStore)); } catch { /* an unobservable store root permits no reads */ }
  }
  guardWorkspaceTools(pi, workspace, sandboxed, channel.attached, provenance.permitted, readableRoots);
  // One serialized writer serves every mutation path: the contained write
  // and edit tools, and lsp_fix's contained application of server-computed
  // edits. The quota is decided inside that serialization.
  const workspaceWriter = createContainedWriter(workspace, integerEnv("OMA_WORKSPACE_BYTES"));
  containWorkspaceTools(pi, workspace, integerEnv("OMA_WORKSPACE_BYTES"), sandboxed, channel.attached, readableRoots, workspaceWriter);
  // The bundled pi-lsp extension: vendored bytes verified before tools are
  // registered -- and before any vendored module evaluates, so the await is
  // load-bearing -- code_intel's three tools behind it, lsp_fix reaching
  // the filesystem only through the shared contained writer.
  await registerLspTools(pi, { workspace, readOnly: channel.attached, write: workspaceWriter });
  // BL3: the bundled pi-hashline-edit-pro extension -- same fail-closed
  // verification before any vendored module evaluates. It registers the
  // anchored `read` (replacing the contained read under the same name) and,
  // for a role that may write, the file_edit group (replace,
  // replace_within, insert) whose commits reach the filesystem only
  // through the shared contained writer. Registered after the contained
  // tools so its `read` is the effective registration.
  await registerHashlineTools(pi, {
    workspace,
    readableRoots,
    sandboxed,
    readOnly: channel.attached,
    write: workspaceWriter,
  });
  // BL2: ask_user_question exists only where a human sits at the terminal.
  // The Principal's engine (channel attached) registers it here; Personal
  // loads the same file as its own `-e` extension; Residents and Workers
  // never load it, and no surface plan names it for them.
  if (channel.attached) registerAskUserQuestion(pi);
  registerDelivery(pi, waitRequested);
  await startInferenceBridge(pi);
  await startEgressBridge(pi);
}
