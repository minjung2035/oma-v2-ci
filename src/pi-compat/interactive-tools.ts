import { getToolPath } from "@earendil-works/pi-coding-agent/dist/utils/tools-manager.js";

/** UI initialization observes existing tools; installing one belongs to the
 * first tool request, whose upstream module still imports the real manager. */
export async function ensureTool(tool: "fd" | "rg"): Promise<string | undefined> {
  return getToolPath(tool) ?? undefined;
}
