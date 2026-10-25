/** DR27/P0-4: each /resume observation owns its reply, timer and cancellation.
 * A slow parent's answer belongs to that request, never to the next selector. */
import { alarm, type Timer } from "@oma/protocol/alarm";
import type { PiEvent } from "@oma/protocol/jsonl";

interface HistorySnapshot { readonly dirs: string[]; readonly error?: string }

export class ProjectSessionDirectories {
  private sequence = 0;
  private closed = false;
  private readonly pending = new Map<string, { answer(dirs: string[], error?: string): void; cancel(): void }>();
  constructor(private readonly own: string, private readonly waitSeconds: number, private readonly send: (event: PiEvent) => void) {}

  read(signal?: AbortSignal): Promise<string[]> {
    return this.snapshot(signal).then(value => value.dirs);
  }
  snapshot(signal?: AbortSignal): Promise<HistorySnapshot> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.closed) return Promise.resolve({ dirs: [this.own] });
    const id = `sessions-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      let timer: Timer | undefined;
      let settled = false;
      const release = (): boolean => {
        if (settled) return false;
        settled = true;
        this.pending.delete(id);
        timer?.cancel();
        signal?.removeEventListener("abort", abort);
        return true;
      };
      const answer = (dirs: string[], error?: string): void => {
        if (release()) resolve({ dirs: [...new Set([this.own, ...dirs])], ...(error === undefined ? {} : { error }) });
      };
      const abort = (): void => { if (release()) reject(signal?.reason); };
      this.pending.set(id, { answer, cancel: () => answer([]) });
      try {
        timer = alarm(this.waitSeconds, () => answer([], "Session histories could not be observed in time"), true);
        signal?.addEventListener("abort", abort, { once: true });
        this.send({ type: "sessions_request", id });
      } catch (error) { if (release()) reject(error); }
    });
  }

  accept(event: PiEvent): void {
    if (event.type !== "session_dirs" || typeof event.id !== "string" ||
        !Array.isArray(event.dirs) || !event.dirs.every(dir => typeof dir === "string")) return;
    this.pending.get(event.id)?.answer(event.dirs as string[], typeof event.error === "string" ? event.error : undefined);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const query of this.pending.values()) query.cancel();
  }
}
