/** The guest Human session's one private host-history observation channel. */
import { Socket } from "node:net";
import { FrameParser, encodeFrame } from "@oma/protocol/frame";
import { StoreError } from "@oma/domain/errors";
import type { SessionMode } from "@oma/domain/session-mode";
import { checkedHostHistoryPage, parseHostHistoryReference, type HostHistoryQuery, type HostHistoryPage } from "@oma/protocol/host-history";
import { TERMINAL_FRAME_BYTES, checkedResumeHistoryReference } from "@oma/protocol/host-guest";
import { HOST_SESSION_HANDOFF_ENV, HOST_SESSION_HANDOFF_FD } from "@oma/protocol/session-handoff";
import { alarm, type Timer } from "./pi-rpc.js";

export class HostHistoryChannel {
  private sequence = 0;
  private closed = false;
  private readonly pending = new Map<string, { resolve(value: Record<string, unknown>): void; reject(error: unknown): void }>();
  constructor(private readonly socket: Socket, private readonly waitSeconds: number) {
    const parser = new FrameParser(TERMINAL_FRAME_BYTES - 1);
    socket.on("data", (bytes: Buffer) => {
      try {
        for (const { raw } of parser.feed(bytes)) {
          if (typeof raw.id !== "string" || Object.keys(raw).sort().join(",") !== (raw.error === undefined ? "id,result" : "error,id")) throw new Error();
          const pending = this.pending.get(raw.id);
          if (raw.error !== undefined) {
            if (typeof raw.error !== "string" || raw.error.length > 160) throw new Error();
            pending?.reject(new StoreError("BROKER_UNAVAILABLE", raw.error));
          } else if (!raw.result || typeof raw.result !== "object" || Array.isArray(raw.result)) throw new Error();
          else pending?.resolve(raw.result as Record<string, unknown>);
        }
      } catch { this.close(); }
    });
    socket.once("end", () => { try { parser.finish(); } catch { /* partial reply remains unavailable */ } finally { this.close(); } });
    socket.on("error", () => this.close());
    socket.once("close", () => this.close());
  }
  static open(waitSeconds: number): HostHistoryChannel | null {
    if (process.env[HOST_SESSION_HANDOFF_ENV] === undefined) return null;
    if (process.env[HOST_SESSION_HANDOFF_ENV] !== String(HOST_SESSION_HANDOFF_FD)) throw new Error("Invalid host session handoff descriptor");
    return new HostHistoryChannel(new Socket({ fd: HOST_SESSION_HANDOFF_FD, readable: true, writable: true }), waitSeconds);
  }
  private query(method: "list" | "inspect", fields: { after?: string; reference?: string }, signal?: AbortSignal): Promise<Record<string, unknown>> {
    signal?.throwIfAborted();
    if (this.closed) return Promise.reject(new StoreError("BROKER_UNAVAILABLE", "Host history connection is closed"));
    const query: HostHistoryQuery = { id: `host-history-${++this.sequence}`, method, ...fields };
    return new Promise((resolve, reject) => {
      let timer: Timer | undefined, settled = false;
      const release = (): boolean => {
        if (settled) return false;
        settled = true; this.pending.delete(query.id); timer?.cancel(); signal?.removeEventListener("abort", abort); return true;
      };
      const fail = (error: unknown): void => { if (release()) reject(error); };
      const abort = (): void => fail(signal?.reason);
      this.pending.set(query.id, { resolve: value => { if (release()) resolve(value); }, reject: fail });
      timer = alarm(this.waitSeconds, () => fail(new StoreError("BROKER_UNAVAILABLE", "Host histories could not be observed in time")), true);
      signal?.addEventListener("abort", abort, { once: true });
      this.socket.write(encodeFrame(query), error => { if (error) fail(error); });
    });
  }
  async pages(accept: (page: HostHistoryPage) => void, signal?: AbortSignal): Promise<void> {
    let after: string | undefined;
    do {
      const page = checkedHostHistoryPage(await this.query("list", after === undefined ? {} : { after }, signal));
      for (const info of page.sessions) {
        if (after !== undefined && info.reference.localeCompare(after, "en") <= 0) throw new StoreError("BROKER_UNAVAILABLE", "Host history pagination did not advance");
      }
      accept(page);
      after = page.after ?? undefined;
    } while (after !== undefined);
  }
  async inspect(reference: string): Promise<void> {
    parseHostHistoryReference(reference);
    const result = await this.query("inspect", { reference });
    if (Object.keys(result).sort().join(",") !== "mode,reference" || result.reference !== reference || result.mode !== "personal")
      throw new StoreError("BROKER_UNAVAILABLE", "Selected host history could not be observed");
  }
  async finish(reference: string | null, mode?: SessionMode): Promise<void> {
    if (reference !== null && mode !== undefined) throw new StoreError("INVALID_REQUEST", "A mode switch cannot resume a history");
    if (reference !== null) checkedResumeHistoryReference(reference);
    if (this.closed) throw new StoreError("BROKER_UNAVAILABLE", "Host history connection is closed");
    await new Promise<void>((resolve, reject) => this.socket.end(encodeFrame(reference === null
      ? { next: "new", ...(mode === undefined ? {} : { mode }) } : { next: "resume", history: reference }), () => {
      if (this.closed) reject(new StoreError("BROKER_UNAVAILABLE", "Host handoff was lost")); else resolve();
    }));
    this.close();
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) pending.reject(new StoreError("BROKER_UNAVAILABLE", "Host history connection ended"));
    this.socket.destroy();
  }
}
