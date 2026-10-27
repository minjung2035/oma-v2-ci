/** PR-001: the Principal credential as the trusted extension holds it.
 *
 * The product hands its engine the credential on a private socket after the
 * engine is running, and hands a new one whenever the broker it talks to is
 * replaced. The credential is never in this process's environment -- that is
 * readable by any process of this user through /proc/<pid>/environ -- and the
 * socket cannot be reopened through /proc the way a pipe can. It lives only
 * in this module's memory, which a process that is not this one's ancestor
 * cannot read under the kernel's ptrace restriction.
 *
 * The protocol owns channel framing and credential grammar. This module
 * owns the attached descriptor and the lifetime of its current grant.
 */
import { fstatSync } from "node:fs";
import { Socket } from "node:net";
import { decodeCredential, type PrincipalGrant } from "@oma/protocol/client-codecs";
import { HOST_CHANNEL_ENV, HOST_CHANNEL_FD, HOST_CHANNEL_LINE_BYTES } from "@oma/protocol/host-channel";

/** Where this process keeps its one channel, across module instances. */
const PROCESS_CHANNEL = Symbol.for("oma.principal-channel");

/** Holds the latest credential the host granted, or nothing. */
export class PrincipalChannel {
  private grant: PrincipalGrant | null = null;
  private pending = "";
  private broken = false;
  private opened = false;
  private ended = false;
  private readonly waiting = new Set<() => void>();

  /** For code that holds a grant another way, and for tests. */
  static detached(): PrincipalChannel { return new PrincipalChannel(); }

  /** Listens on the descriptor the product attached, or holds nothing when
   * this engine was not started with one -- a Resident's never is. A
   * descriptor that is not a socket is not trusted as the channel.
   *
   * The descriptor is the process's, not one extension load's: an interactive
   * engine loads its extensions again for every new, resumed or forked
   * session, and a descriptor can be wrapped only once. Every load in this
   * process shares the one channel. */
  static open(env: NodeJS.ProcessEnv = process.env): PrincipalChannel {
    const shared = globalThis as { [PROCESS_CHANNEL]?: PrincipalChannel };
    if (env === process.env && shared[PROCESS_CHANNEL]) return shared[PROCESS_CHANNEL];
    const channel = new PrincipalChannel();
    if (env === process.env) shared[PROCESS_CHANNEL] = channel;
    if (env[HOST_CHANNEL_ENV] !== String(HOST_CHANNEL_FD)) return channel;
    try { if (!fstatSync(HOST_CHANNEL_FD).isSocket()) return channel; }
    catch { return channel; }
    channel.opened = true;
    const socket = new Socket({ fd: HOST_CHANNEL_FD, readable: true, writable: false });
    socket.on("data", chunk => channel.push(chunk));
    socket.on("error", () => { channel.clear(); });
    // The product is gone: whatever credential it granted named a broker that
    // is going with it.
    socket.once("close", () => { channel.clear(); });
    // The engine must not be kept alive by waiting on this channel.
    socket.unref();
    return channel;
  }

  /** The credential to present right now, or null. Read at each call rather
   * than once, because a restarted broker replaces it. */
  current(): PrincipalGrant | null { return this.grant; }
  /** Whether this engine was started with the product's credential channel:
   * the Principal's always is, a Resident's never is. */
  get attached(): boolean { return this.opened; }

  /** The private conversation may start before repository preparation. Its
   * first request waits for registration before freezing or sending work.
   * Cancellation and channel death release every listener; no polling timer. */
  waitForGrant(signal?: AbortSignal): Promise<void> {
    if (!this.attached || this.grant !== null) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const changed = (): void => {
        if (!signal?.aborted && !this.ended && this.grant === null) return;
        this.waiting.delete(changed); signal?.removeEventListener("abort", changed);
        if (signal?.aborted) reject(new Error("Society request cancelled before registration"));
        else if (this.ended) reject(new Error("Society preparation ended before Principal registration"));
        else resolve();
      };
      this.waiting.add(changed); signal?.addEventListener("abort", changed, { once: true }); changed();
    });
  }

  push(chunk: Buffer | string): void {
    if (this.broken || this.ended) return;
    this.pending += typeof chunk === "string" ? chunk : chunk.toString("latin1");
    for (;;) {
      const end = this.pending.indexOf("\n");
      if (end < 0) break;
      const line = this.pending.slice(0, end);
      this.pending = this.pending.slice(end + 1);
      const match = line.length <= HOST_CHANNEL_LINE_BYTES ? decodeCredential(line) : null;
      // Anything else on this channel means it is not the channel it should
      // be; no credential from it is trusted afterwards.
      if (match === null) { this.broken = true; this.clear(); return; }
      this.grant = Object.freeze(match);
      for (const changed of this.waiting) changed();
    }
    if (this.pending.length > HOST_CHANNEL_LINE_BYTES) { this.broken = true; this.clear(); }
  }

  private clear(): void {
    this.grant = null; this.pending = ""; this.ended = true;
    for (const changed of this.waiting) changed();
  }
}
