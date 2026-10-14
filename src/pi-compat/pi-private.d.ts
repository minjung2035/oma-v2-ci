/** Pi 1.0.1 compatibility boundary; the scoped preload resolves this module
 * inside the same pinned installation as the interactive entry. */
declare module "@earendil-works/pi-coding-agent/dist/utils/tools-manager.js" {
  export function getToolPath(tool: "fd" | "rg"): string | null;
  export interface ToolStatus { type: "info" | "warning"; message: string }
  export function ensureTool(tool: "fd" | "rg", onStatus?: (status: ToolStatus) => void): Promise<string | undefined>;
}

/** The same public file-lock primitive used by the pinned Pi storage. */
declare module "proper-lockfile" {
  export function lockSync(path: string, options: { realpath: false }): () => void;
}
