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
import { startInferenceBridge } from "./extension/inference-bridge.js";
import { omaToolNames, registerOmaTools } from "./extension/mail-tools.js";
import { integerEnv } from "./extension/shared.js";
import { PrincipalChannel } from "./extension/principal-channel.js";
import { createToolProvenance, verifiedExtensionPaths, VERIFIED_EXTENSIONS_ENV } from "./extension/provenance.js";
import { registerPromptBoundary } from "./extension/prompt-boundary.js";
import { registerToolSurface } from "./extension/tool-surface.js";
import { TOOL_SCOPE_ENV, TOOL_SCOPE_SANDBOX, guardWorkspaceTools } from "./extension/workspace-guard.js";
import { containWorkspaceTools } from "./extension/contained-tools.js";

export { decodeBatchViewText, readBatchView } from "./extension/batch-view.js";
export { OMA_TOOL_NAMES, cliEnvironment, registerOmaTools } from "./extension/mail-tools.js";
export { PrincipalChannel, PRINCIPAL_CHANNEL_ENV, PRINCIPAL_CHANNEL_FD } from "./extension/principal-channel.js";
export { CLI_CREDENTIAL_FD_ENV, SOCIETY_FENCE_ENV, SOCIETY_FENCE_FD, runCliProcess } from "./extension/cli-process.js";
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
  guardWorkspaceTools(pi, workspace, sandboxed, channel.attached, provenance.permitted);
  containWorkspaceTools(pi, workspace, integerEnv("OMA_WORKSPACE_BYTES"), sandboxed, channel.attached);
  registerDelivery(pi, waitRequested);
  await startInferenceBridge(pi);
}
