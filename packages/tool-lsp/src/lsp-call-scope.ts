/** Per-call resources around the vendored LSP session scope. Session and
 * child ownership remain upstream; scratch and silence observation end here. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function withLspScratch<T>(fn: (scratch: string) => Promise<T>): Promise<T> {
  const scratch = mkdtempSync(join(tmpdir(), "oma-lsp-"));
  try { return await fn(scratch); }
  finally { rmSync(scratch, { recursive: true, force: true }); }
}

/** Only frames belonging to this call restart the silence window. A
 * caller's request timeout is never shortened by the session's default. */
export function observeLspCall<A>(tool: string, ownedSignal: AbortSignal,
    timeoutMs: number, silenceMs: number, adapters: ReadonlySet<A>,
    subscribe: (listener: (adapter: A) => void) => () => void) {
  const ms = Math.max(silenceMs, timeoutMs);
  const controller = new AbortController();
  const message = `${tool} saw no LSP server activity for ${ms}ms -- the server is stalled or dead`;
  const fire = () => controller.abort(new Error(message));
  let stopped = false;
  let timer = setTimeout(fire, ms);
  let unsubscribe: () => void;
  try {
    unsubscribe = subscribe(adapter => {
      if (!stopped && !controller.signal.aborted && adapters.has(adapter)) {
        clearTimeout(timer);
        timer = setTimeout(fire, ms);
      }
    });
  } catch (error) { clearTimeout(timer); throw error; }
  return {
    signal: AbortSignal.any([ownedSignal, controller.signal]),
    message,
    fired: () => controller.signal.aborted && !ownedSignal.aborted,
    stop() { if (stopped) return; stopped = true; clearTimeout(timer); unsubscribe(); },
    rethrow(error: unknown): never {
      if (controller.signal.aborted && !ownedSignal.aborted) throw new Error(message);
      throw error;
    },
  };
}
