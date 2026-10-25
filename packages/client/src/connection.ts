/** P0-4/P0-5: a finite endpoint observation owns its socket until connected
 * or closed. An answered absence is about this endpoint, never process death. */
import { Socket } from "node:net";
import { StoreError } from "@oma/domain/errors";

export function connectEndpoint(path: string, deadlineMs: number, signal?: AbortSignal): Promise<Socket> {
  return new Promise((resolve, reject) => {
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 2_147_483_647)
      throw new RangeError("connection timeout must be a positive timer-safe integer");
    const unavailable = (message: string, cause?: unknown): StoreError => new StoreError("BROKER_UNAVAILABLE", message, { cause });
    if (signal?.aborted) { reject(unavailable("the connection attempt was cancelled")); return; }
    const socket = new Socket();
    let settled = false;
    const timer = setTimeout(() => finish(unavailable("the connection did not open before its deadline")), deadlineMs);
    timer.unref();
    const finish = (error: Error | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off("connect", onConnect); socket.off("error", onError); socket.off("close", onClose);
      signal?.removeEventListener("abort", onAbort);
      if (error === null) { resolve(socket); return; }
      // destroy may finish an in-flight connect with a later error. The owner
      // stays through close, without letting that error escape the process.
      if (!socket.closed) {
        const ignored = (): void => {};
        socket.on("error", ignored);
        socket.once("close", () => { socket.off("error", ignored); });
      }
      socket.destroy();
      reject(error);
    };
    const onConnect = (): void => finish(null);
    const onError = (cause: Error): void => finish(unavailable("the connection could not be opened", cause));
    const onClose = (): void => finish(unavailable("the connection closed before it opened"));
    const onAbort = (): void => finish(unavailable("the connection attempt was cancelled"));
    socket.once("connect", onConnect); socket.once("error", onError); socket.once("close", onClose);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    if (!settled) { try { socket.connect(path); } catch (cause) { finish(unavailable("the connection could not be opened", cause)); } }
  });
}

/** False means only ENOENT/ECONNREFUSED. Silence, resource exhaustion and
 * permission/I/O failures reject, so they cannot authorize replacement. */
export async function endpointListening(path: string, deadlineMs = 500): Promise<boolean> {
  try { const socket = await connectEndpoint(path, deadlineMs); socket.destroy(); return true; }
  catch (error) {
    const cause = error instanceof StoreError ? error.cause as NodeJS.ErrnoException | undefined : undefined;
    if (cause?.code === "ENOENT" || cause?.code === "ECONNREFUSED") return false;
    throw error;
  }
}
