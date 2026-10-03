/** The trusted Pi extension OMA loads into every engine it starts (PI-001).
 *
 * This file only composes; each responsibility lives in `src/extension/`. The
 * whole extension imports no OMA runtime module — only Node built-ins, the
 * engine's extension types and its schema library — so the same compiled
 * files run on the host and inside a Resident's sandbox. The architecture
 * checker holds that closure (`extension-closure`).
 */
import { realpathSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerDelivery } from "./extension/delivery.js";
import { startInferenceBridge } from "./extension/inference-bridge.js";
import { omaToolNames, registerOmaTools } from "./extension/mail-tools.js";
import { integerEnv } from "./extension/shared.js";
import { PrincipalChannel } from "./extension/principal-channel.js";
import { parseSurfacePlan, registerToolSurface } from "./extension/tool-surface.js";
import { TOOL_SCOPE_ENV, TOOL_SCOPE_SANDBOX, guardWorkspaceTools } from "./extension/workspace-guard.js";
import { containWorkspaceTools } from "./extension/contained-tools.js";

export { decodeBatchViewText, readBatchView } from "./extension/batch-view.js";
export { OMA_TOOL_NAMES, cliEnvironment, registerOmaTools } from "./extension/mail-tools.js";
export { PrincipalChannel, PRINCIPAL_CHANNEL_ENV, PRINCIPAL_CHANNEL_FD } from "./extension/principal-channel.js";
export { SOCIETY_FENCE_ENV, SOCIETY_FENCE_FD } from "./extension/cli-process.js";
export { PI_ADAPTER_REVISION, PI_BOUNDARY_PREFIX } from "./extension/delivery.js";
export {
  expandedActiveTools, initialActiveTools, parseSurfacePlan, registerToolSurface,
} from "./extension/tool-surface.js";

export default async function extension(pi: ExtensionAPI) {
  const workspace = realpathSync(process.cwd());
  // Holds nothing unless the product attached its private channel, which it
  // does only for the Principal's engine.
  const channel = PrincipalChannel.open();
  const sandboxed = process.env[TOOL_SCOPE_ENV] === TOOL_SCOPE_SANDBOX;
  const waitRequested = registerOmaTools(pi, workspace, channel);
  const ownTools = omaToolNames(channel.attached);
  const surface = parseSurfacePlan(process.env.OMA_TOOL_SURFACE);
  const principalTools = new Set([...ownTools, "read", "grep", "find", "ls",
    ...(surface.state === "plan" ? surface.plan.groups.map(group => group.name) : [])]);
  const permitted = channel.attached ? (name: string) => principalTools.has(name) : undefined;
  registerToolSurface(pi, ownTools, permitted);
  guardWorkspaceTools(pi, workspace, sandboxed, channel.attached, permitted);
  containWorkspaceTools(pi, workspace, integerEnv("OMA_WORKSPACE_BYTES"), sandboxed, channel.attached);
  registerDelivery(pi, waitRequested);
  await startInferenceBridge(pi);
}
