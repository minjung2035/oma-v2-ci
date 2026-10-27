export type McpScriptWasmModule = object;
/**
 * Resolve the quickjs-wasi entry on the host thread. The worker imports this
 * file URL because Bun-compiled executables cannot resolve bare package names
 * from a worker file loaded from disk.
 * Those executables also fail to resolve the bare `quickjs-wasi` root on the
 * host thread, while package subpaths resolve. So the entry is located next to
 * the wasm file, which is how quickjs-wasi's `"."` export lays it out.
 */
export declare function resolveMcpScriptQuickJsUrl(): string;
/** Load and compile the packaged QuickJS runtime once per host process. */
export declare function loadMcpScriptWasm(path?: string): Promise<McpScriptWasmModule>;
