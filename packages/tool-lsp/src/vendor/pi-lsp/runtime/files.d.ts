import type { LspServerAdapter } from "./types.js";
export declare function resolveRoot(root?: string): string;
export declare function directoryUri(directory: string): string;
export declare function resolveSupportedFile(adapter: LspServerAdapter, root: string, filePath: string): string;
export declare function collectSupportedFiles(adapter: LspServerAdapter, root: string, requestedPaths: string[] | undefined, limit: number): string[];
