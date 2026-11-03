/** DR27/P0-4: each /resume observation owns its reply, timer and cancellation.
 * A slow parent's answer belongs to that request, never to the next selector.
 *
 * ACC: a catalog too large for one control frame arrives as a run of ordered
 * `session_dirs` frames, every one but the last carrying `more: true`. The
 * observer accumulates the run and settles once on the frame that ends it --
 * absent or false `more`, or an explicit error, which stays terminal so a
 * partial catalog is never silently returned as a whole one. A frame whose
 * `more` is neither boolean nor absent is malformed and ignored whole, the
 * same class as the malformed frames beside it. */
import { alarm, type Timer } from "@oma/protocol/alarm";
import type { PiEvent } from "@oma/protocol/jsonl";

interface HistorySnapshot { readonly dirs: string[]; readonly error?: string }
interface Observation {
  /** ACC: a `more: true` frame's directories join the request's accumulation. */
  append(dirs: string[]): void;
  answer(dirs: string[], error?: string): void;
  cancel(): void;
}

export class ProjectSessionDirectories {
  private sequence = 0;
  private closed = false;
  private readonly pending = new Map<string, Observation>();
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
      const accumulated: string[] = [];
      const release = (): boolean => {
        if (settled) return false;
        settled = true;
        this.pending.delete(id);
        timer?.cancel();
        signal?.removeEventListener("abort", abort);
        return true;
      };
      const answer = (dirs: string[], error?: string): void => {
        if (release()) resolve({ dirs: [...new Set([this.own, ...accumulated, ...dirs])], ...(error === undefined ? {} : { error }) });
      };
      const abort = (): void => { if (release()) reject(signal?.reason); };
      this.pending.set(id, { append: dirs => { accumulated.push(...dirs); }, answer, cancel: () => answer([]) });
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
    if ("more" in event && typeof event.more !== "boolean") return;
    const observation = this.pending.get(event.id);
    if (observation === undefined) return;
    const error = typeof event.error === "string" ? event.error : undefined;
    // An error ends the run wherever it appears: what arrived before it is
    // kept and reported with it, never presented as the complete catalog.
    if (error === undefined && event.more === true) observation.append(event.dirs as string[]);
    else observation.answer(event.dirs as string[], error);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const query of this.pending.values()) query.cancel();
  }
}
