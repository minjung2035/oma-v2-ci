/** LIFE-006/PR-001: the broker's end of the supervision channel.
 *
 * The host that starts a broker gives it one socketpair at a fixed descriptor.
 * From it the broker learns three things it could not learn safely any other
 * way: who its host is (the peer's credentials, which no other process can
 * forge), which engine the host started for the Principal, and -- by the
 * channel closing -- that the host is gone.
 *
 * That last one is what stops a broker outliving the product that owns it. A
 * host that exits normally stops its broker; a host that crashes, or is killed
 * outright, cannot. Its descriptors are closed by the kernel either way, so the
 * broker hears the close and stops itself. Without this, a killed `oma` left a
 * broker holding the society's lock and a Principal endpoint registered to a
 * session that no longer existed, and every later `oma` found it "already
 * running" and started a Principal with no authority.
 */
import { fstatSync } from "node:fs";
import { Socket } from "node:net";
import { peerCred } from "@oma/native/linux";
import { pinDarwinPrivateParent } from "@oma/native/private-parent";
import { cleanupAll } from "@oma/native/cleanup";
import { processIdentity } from "@oma/broker/process-ancestry";
import { HostChannelReader, encodeHostMessage } from "@oma/protocol/host-channel";
import type { PrincipalHostChannel } from "@oma/broker/principal-endpoint";

export interface SupervisionOptions {
  readonly fd: number;
  /** Called once, when the host is gone or the channel cannot be trusted. */
  readonly onHostGone: (reason: string) => void;
  readonly log?: (line: string) => void;
}

/** The channel, or undefined when the descriptor is not a socket this process
 * was given. A registration inherited by a broker started some other way would
 * otherwise speak into whatever that descriptor happens to be. */
export function openSupervisionChannel(options: SupervisionOptions): PrincipalHostChannel | undefined {
  const log = options.log ?? (() => {});
  let kind;
  try { kind = fstatSync(options.fd); }
  catch { log("a host channel is declared but none is attached; no principal endpoint is opened"); return undefined; }
  if (!kind.isSocket()) { log("the host channel is not a socket; no principal endpoint is opened"); return undefined; }
  // This endpoint is given directly to the trusted Broker, never forwarded.
  // Darwin's endpoint token is not a general per-message sender proof. Bind
  // it to this process's actual parent and withdraw on exec/death/uncertainty.
  const parent = process.platform === "darwin" ? pinDarwinPrivateParent(options.fd) : undefined;
  const credentials = process.platform === "darwin" ? undefined : peerCred(options.fd);
  if (process.platform === "darwin" ? parent === null : credentials == null || credentials.uid !== (process.getuid?.() ?? -1)) {
    log("the host channel's peer is not this user; no principal endpoint is opened");
    return undefined;
  }
  // Pinned with its start time: the pid on its own is reused, and this identity
  // is what the delivery endpoint answers to.
  const host = parent?.identity ?? (credentials == null ? null : processIdentity(credentials.pid));
  if (host === null) {
    parent?.close();
    log("the host channel's peer is not observed running; no principal endpoint is opened");
    return undefined;
  }

  let socket: Socket;
  try { socket = new Socket({ fd: options.fd, readable: true, writable: true }); }
  catch (error) { parent?.close(); throw error; }
  let gone = false;
  let watch: ReturnType<typeof setInterval> | undefined;
  const returnParent = (): void => { clearInterval(watch); parent?.close(); };
  const hostGone = (reason: string): void => {
    if (gone) return;
    gone = true;
    cleanupAll([returnParent, () => socket.destroy(), () => options.onHostGone(reason)]);
  };
  const live = (): boolean => {
    if (gone) return false;
    if (parent != null && !parent.alive()) { hostGone("the host identity changed or could not be observed"); return false; }
    return true;
  };
  const listeners: ((sessionHandle: string, pid: number) => void)[] = [];
  const queued: { sessionHandle: string; pid: number }[] = [];
  const reader = new HostChannelReader(message => {
    if (!live()) return;
    if (message.kind !== "session") { socket.destroy(); hostGone("the host sent a message only a broker sends"); return; }
    if (listeners.length === 0) { queued.push(message); return; }
    for (const listener of listeners) listener(message.sessionHandle, message.pid);
  }, reason => { socket.destroy(); hostGone(reason); });
  socket.on("data", chunk => reader.push(chunk));
  socket.once("end", () => hostGone("the host closed the supervision channel"));
  socket.once("close", () => hostGone("the host is gone"));
  socket.on("error", () => hostGone("the supervision channel failed"));
  if (parent != null) { watch = setInterval(() => { live(); }, 25); watch.unref(); }

  const send = (text: string): void => {
    if (!live() || socket.destroyed) return;
    socket.write(text);
  };
  return Object.freeze({
    host,
    alive: () => !gone && (parent == null || parent.alive()),
    ready: () => send(encodeHostMessage({ kind: "ready" })),
    grant: (credential: string, sessionHandle: string) =>
      send(encodeHostMessage({ kind: "credential", credential, sessionHandle })),
    refuse: (sessionHandle: string) => send(encodeHostMessage({ kind: "refused", sessionHandle })),
    onSession: (listener: (sessionHandle: string, pid: number) => void) => {
      if (!live()) { queued.length = 0; return; }
      listeners.push(listener);
      for (const message of queued.splice(0)) { if (!live()) return; listener(message.sessionHandle, message.pid); }
    },
    // The broker owns this descriptor for its lifetime; closing it is part of
    // stopping, so a broker told to stop on its own does not keep running for
    // a channel nobody is reading.
    close: () => { gone = true; cleanupAll([returnParent, () => socket.destroy()]); },
  });
}
