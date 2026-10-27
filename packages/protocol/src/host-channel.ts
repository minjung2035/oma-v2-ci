/** PR-001/LIFE-006: the supervision channel between the product and the broker
 * it started, and between the product and its Principal engine.
 *
 * It is a socketpair the parent opens at spawn and nobody else holds. Three
 * things travel on it and nothing else: the broker saying its endpoints are
 * listening, the host naming the Principal session it started, and a
 * credential for that session (or its refusal). A socket rather than a file or an environment
 * entry, because those are exactly what another process of the same user can
 * read: an environment through /proc/<pid>/environ, an inherited pipe by
 * reopening /proc/<pid>/fd/N. A socket can be neither read nor reopened that
 * way. The channel closing is itself a message: the other end is gone.
 *
 * This module is the codec both ends use, so neither can drift from what the
 * other accepts. It takes no I/O capability of its own.
 */
import { isPrincipalSessionHandle } from "./principal-credential.js";
import { decodeCredential, encodeCredential } from "./client-codecs.js";

/** The descriptor the channel is attached at in the child. */
export const HOST_CHANNEL_FD = 3;
/** Set in the child's environment to say a channel is attached. It names the
 * descriptor, never anything the channel carries. */
export const HOST_CHANNEL_ENV = "OMA_HOST_CHANNEL";
/** The longest line either end ever sends. A longer one is not a message. */
export const HOST_CHANNEL_LINE_BYTES = 128;

export type HostChannelMessage =
  | { readonly kind: "ready" }
  /** The broker would not accept the engine the host named. It names the
   * registration it refuses: an answer that names nothing can be taken for the
   * answer to whatever registration happens to be waiting when it lands. */
  | { readonly kind: "refused"; readonly sessionHandle: string }
  | { readonly kind: "session"; readonly sessionHandle: string; readonly pid: number }
  | { readonly kind: "credential"; readonly credential: string; readonly sessionHandle: string };

export function encodeHostMessage(message: HostChannelMessage): string {
  switch (message.kind) {
    case "ready": return "ready\n";
    case "refused":
      if (!isPrincipalSessionHandle(message.sessionHandle)) throw new TypeError("invalid refusal");
      return `refused ${message.sessionHandle}\n`;
    case "session":
      if (!isPrincipalSessionHandle(message.sessionHandle) || !Number.isSafeInteger(message.pid) || message.pid <= 1)
        throw new TypeError("invalid session registration");
      return `session ${message.sessionHandle} ${message.pid}\n`;
    case "credential":
      return encodeCredential(message);
  }
}

const REFUSED = /^refused ([0-9a-f]{32})$/;
const SESSION = /^session ([0-9a-f]{32}) ([1-9][0-9]{0,9})$/;

export function decodeHostMessage(line: string): HostChannelMessage | null {
  if (line === "ready") return { kind: "ready" };
  const refused = REFUSED.exec(line);
  if (refused !== null) return { kind: "refused", sessionHandle: refused[1]! };
  const session = SESSION.exec(line);
  if (session !== null) {
    const pid = Number(session[2]);
    return Number.isSafeInteger(pid) && pid > 1 ? { kind: "session", sessionHandle: session[1]!, pid } : null;
  }
  const credential = decodeCredential(line);
  if (credential !== null) return { kind: "credential", ...credential };
  return null;
}

/** Splits a byte stream into messages. Anything that is not a whole, valid
 * message -- an over-long line, a line that decodes to nothing, a byte that is
 * not ASCII -- is a broken channel, reported once, after which the reader
 * accepts nothing more. */
export class HostChannelReader {
  private pending = "";
  private broken = false;
  constructor(
    private readonly onMessage: (message: HostChannelMessage) => void,
    private readonly onBroken: (reason: string) => void,
  ) {}

  push(chunk: Buffer | string): void {
    if (this.broken) return;
    const text = typeof chunk === "string" ? chunk : chunk.toString("latin1");
    if (!/^[\x20-\x7e\n]*$/.test(text)) { this.fail("the channel carried a byte outside its grammar"); return; }
    this.pending += text;
    for (;;) {
      const end = this.pending.indexOf("\n");
      if (end < 0) break;
      const line = this.pending.slice(0, end);
      this.pending = this.pending.slice(end + 1);
      const message = line.length > HOST_CHANNEL_LINE_BYTES ? null : decodeHostMessage(line);
      if (message === null) { this.fail("the channel carried a line that is not a message"); return; }
      this.onMessage(message);
    }
    if (this.pending.length > HOST_CHANNEL_LINE_BYTES) this.fail("the channel carried an over-long line");
  }

  private fail(reason: string): void {
    this.broken = true;
    this.pending = "";
    this.onBroken(reason);
  }
}
