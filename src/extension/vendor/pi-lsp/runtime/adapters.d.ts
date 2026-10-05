import type { InternalLspServer, LspConfig, LspServerAdapter } from "./types.js";
export declare const DEFAULT_SERVER_CONFIGS: InternalLspServer[];
export interface LspConfigLoadOptions {
    projectTrusted?: boolean;
}
export declare function loadRuntime(cwd?: string, options?: LspConfigLoadOptions): {
    adapters: LspServerAdapter[];
    timeoutMs: number;
};
export declare function loadConfig(cwd?: string, options?: LspConfigLoadOptions): LspConfig;
export declare function consumeLspConfigNotice(): string | undefined;
