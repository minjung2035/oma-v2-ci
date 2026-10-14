import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const cached = new Map();
function resolveQuickJsWasmPath() {
    return createRequire(import.meta.url).resolve("quickjs-wasi/quickjs.wasm");
}
/**
 * Resolve the quickjs-wasi entry on the host thread. The worker imports this
 * file URL because Bun-compiled executables cannot resolve bare package names
 * from a worker file loaded from disk.
 * Those executables also fail to resolve the bare `quickjs-wasi` root on the
 * host thread, while package subpaths resolve. So the entry is located next to
 * the wasm file, which is how quickjs-wasi's `"."` export lays it out.
 */
export function resolveMcpScriptQuickJsUrl() {
    return new URL("./dist/index.js", pathToFileURL(resolveQuickJsWasmPath())).href;
}
/** Load and compile the packaged QuickJS runtime once per host process. */
export function loadMcpScriptWasm(path = resolveQuickJsWasmPath()) {
    let module = cached.get(path);
    if (!module) {
        const webAssembly = globalThis.WebAssembly;
        module = readFile(path)
            .then((bytes) => webAssembly.compile(bytes))
            .catch((error) => {
            cached.delete(path);
            throw error;
        });
        cached.set(path, module);
    }
    return module;
}
