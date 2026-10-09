/** Pi 1.0.1 compatibility boundary; the scoped preload resolves this module
 * inside the same pinned installation as the interactive entry. */
declare module "@earendil-works/pi-coding-agent/dist/utils/tools-manager.js" {
  export function getToolPath(tool: "fd" | "rg"): string | null;
}

/** The same public file-lock primitive used by the pinned Pi storage. */
declare module "proper-lockfile" {
  export function lockSync(path: string, options: { realpath: false }): () => void;
}
