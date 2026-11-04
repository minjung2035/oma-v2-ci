/** Shared nonblocking Mach readiness turns. No thread is parked per channel;
 * native receive/send calls always have zero timeout. A tick is not liveness.
 */
interface Watch { enabled: boolean; closed: boolean; readonly ready: () => void; readonly failure: (error: Error) => void }
const watches = new Set<Watch>();
let timer: ReturnType<typeof setTimeout> | undefined;
function schedule(): void {
  if (timer !== undefined || ![...watches].some(watch => watch.enabled && !watch.closed)) return;
  timer = setTimeout(() => {
    timer = undefined;
    for (const watch of [...watches]) {
      if (!watch.enabled || watch.closed) continue;
      try { watch.ready(); }
      catch (error) { watch.failure(error instanceof Error ? error : new Error("Mach readiness failed", { cause: error })); }
    }
    schedule();
  }, 4);
}
export function machPoll(ready: () => void, failure: (error: Error) => void): { request(enabled: boolean): void; close(): void } {
  const watch: Watch = { enabled: false, closed: false, ready, failure }; watches.add(watch);
  return {
    request(enabled) { if (!watch.closed) { watch.enabled = enabled; schedule(); } },
    close() {
      if (watch.closed) return;
      watch.closed = true; watches.delete(watch);
      if (![...watches].some(value => value.enabled && !value.closed) && timer !== undefined) { clearTimeout(timer); timer = undefined; }
    },
  };
}
