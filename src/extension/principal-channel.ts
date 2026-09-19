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
 * The extension may not import OMA's protocol module (PI-001), so the channel's
 * descriptor, marker and credential line are mirrored here. A test holds the
 * mirror to the original, so the two cannot drift.
 */
import { fstatSync } from "node:fs";
import { Socket } from "node:net";

/** Mirrors `HOST_CHANNEL_ENV` and `HOST_CHANNEL_FD` in src/protocol/host-channel.ts. */
export const PRINCIPAL_CHANNEL_ENV = "OMA_HOST_CHANNEL";
export const PRINCIPAL_CHANNEL_FD = 3;
/** Mirrors the credential message of the host channel grammar. */
const CREDENTIAL_LINE = /^credential ([0-9a-f]{64}) ([0-9a-f]{32})$/;
const LINE_BYTES = 128;

export interface PrincipalGrant {
  readonly credential: string;
  readonly sessionHandle: string;
}

/** Holds the latest credential the host granted, or nothing. */
export class PrincipalChannel {
  private grant: PrincipalGrant | null = null;
  private pending = "";
  private broken = false;

  /** For code that holds a grant another way, and for tests. */
  static detached(): PrincipalChannel { return new PrincipalChannel(); }

  /** Listens on the descriptor the product attached, or holds nothing when
   * this engine was not started with one -- a Resident's never is. A
   * descriptor that is not a socket is not trusted as the channel. */
  static open(env: NodeJS.ProcessEnv = process.env): PrincipalChannel {
    const channel = new PrincipalChannel();
    if (env[PRINCIPAL_CHANNEL_ENV] !== String(PRINCIPAL_CHANNEL_FD)) return channel;
    try { if (!fstatSync(PRINCIPAL_CHANNEL_FD).isSocket()) return channel; }
    catch { return channel; }
    const socket = new Socket({ fd: PRINCIPAL_CHANNEL_FD, readable: true, writable: false });
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

  push(chunk: Buffer | string): void {
    if (this.broken) return;
    this.pending += typeof chunk === "string" ? chunk : chunk.toString("latin1");
    for (;;) {
      const end = this.pending.indexOf("\n");
      if (end < 0) break;
      const line = this.pending.slice(0, end);
      this.pending = this.pending.slice(end + 1);
      const match = line.length <= LINE_BYTES ? CREDENTIAL_LINE.exec(line) : null;
      // Anything else on this channel means it is not the channel it should
      // be; no credential from it is trusted afterwards.
      if (match === null) { this.broken = true; this.clear(); return; }
      this.grant = Object.freeze({ credential: match[1]!, sessionHandle: match[2]! });
    }
    if (this.pending.length > LINE_BYTES) { this.broken = true; this.clear(); }
  }

  private clear(): void { this.grant = null; this.pending = ""; }
}
