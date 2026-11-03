/** The only live Society surface is an explicit, authenticated collaboration plan.
 * Retired selectors and session entries are never executed or converted here. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parseSurfacePlan, requireCollaborationSurface, type CollaborationRole } from "@oma/domain/collaboration-surface";
import { registerCollaborationGroups } from "./collaboration-groups.js";
export { parseSurfacePlan, type SurfaceParse } from "@oma/domain/collaboration-surface";

export interface SurfaceFence {
  readonly role?: CollaborationRole | undefined;
  readonly permitted?: ((name: string) => boolean) | undefined;
  readonly own?: ((name: string) => boolean) | undefined;
  readonly fatal?: ((message: string) => never) | undefined;
}
function defaultFatal(message: string): never {
  try { process.stderr.write(`${message}\n`); } catch { /* best-effort diagnostic */ }
  process.exit(1);
}

export function registerToolSurface(pi: ExtensionAPI, owned: readonly string[], fence: SurfaceFence = {}): void {
  const { permitted = () => true,
    own = name => owned.includes(name) || name === "lsp_tools" || name === "web_tools", fatal = defaultFatal } = fence;
  const raw = process.env.OMA_TOOL_SURFACE;
  let plan: ReturnType<typeof requireCollaborationSurface>;
  let reason: string;
  try { plan = requireCollaborationSurface(raw, fence.role); }
  catch (error) {
    reason = error instanceof Error ? error.message : String(error);
    if (parseSurfacePlan(raw).state === "plan") return fatal(reason);
    const refuse = (): never => {
      try { pi.setActiveTools([]); } catch { /* the effect hook remains closed */ }
      return fatal(reason);
    };
    // Host launch admission must run before SDK session construction. These
    // hooks additionally close extension-only entry, reload and provider paths.
    pi.on("tool_call", () => ({ block: true, reason }));
    pi.on("session_start", refuse);
    pi.on("session_tree", refuse);
    pi.on("before_agent_start", refuse);
    pi.on("before_provider_request", refuse);
    return;
  }
  registerCollaborationGroups(pi, plan, owned, { permitted, own, fatal });
}
