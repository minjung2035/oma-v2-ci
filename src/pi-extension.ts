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
import { OMA_TOOL_NAMES, registerOmaTools } from "./extension/mail-tools.js";
import { integerEnv } from "./extension/shared.js";
import { PrincipalChannel } from "./extension/principal-channel.js";
import { registerToolSurface } from "./extension/tool-surface.js";
import { guardWorkspaceTools } from "./extension/workspace-guard.js";

export { decodeBatchViewText, readBatchView } from "./extension/batch-view.js";
export { OMA_TOOL_NAMES, cliEnvironment, registerOmaTools } from "./extension/mail-tools.js";
export { PrincipalChannel, PRINCIPAL_CHANNEL_ENV, PRINCIPAL_CHANNEL_FD } from "./extension/principal-channel.js";
export { CLI_CREDENTIAL_FD_ENV, runCliProcess } from "./extension/cli-process.js";
export { PI_ADAPTER_REVISION, PI_BOUNDARY_PREFIX } from "./extension/delivery.js";
export {
  expandedActiveTools, initialActiveTools, parseSurfacePlan, registerToolSurface,
} from "./extension/tool-surface.js";

export default function extension(pi: ExtensionAPI) {
  const workspace = realpathSync(process.cwd());
  // Holds nothing unless the product attached its private channel, which it
  // does only for the Principal's engine.
  registerOmaTools(pi, workspace, PrincipalChannel.open());
  registerToolSurface(pi, OMA_TOOL_NAMES);
  startInferenceBridge(pi);
  guardWorkspaceTools(pi, workspace, integerEnv("OMA_WORKSPACE_BYTES"));
  registerDelivery(pi);
}
