/** Linux descriptor readiness only. One native poll snapshot, no per-client
 * blocked worker or pending read queue. Shared TS owns sender judgment. */
import type { Socket, Server } from "node:net";
import { ObservedStream } from "@oma/process/observed-stream";
import { enableUnixCredentials, receiveUnixMessage, pollUnixMessages } from "@oma/native/unix-message";
import { socketDescriptor, type PeerCred } from "@oma/native/linux";
interface Watch { readonly fd: number; enabled: boolean; closed: boolean; readonly ready: () => void; readonly failure: (error: Error) => void }
const watches = new Set<Watch>(); let waiting = false;
function schedule(): void {
  if (waiting) return;
  const snapshot = [...watches].filter(value => value.enabled && !value.closed);
  if (!snapshot.length) return;
  waiting = true;
  void pollUnixMessages(snapshot.map(value => value.fd), 50).then(events => {
    waiting = false;
    snapshot.forEach((watch, index) => { if (!watch.closed && watch.enabled && events[index] !== 0) watch.ready(); });
    schedule();
  }, error => {
    waiting = false;
    for (const watch of snapshot) if (!watch.closed) watch.failure(error instanceof Error ? error : new Error("Unix readiness failed", { cause: error }));
    schedule();
  });
}
export function prepareCredentialListener(server: Server): void {
  const fd = socketDescriptor(server); if (fd === null) throw new Error("listener descriptor is unobserved");
  enableUnixCredentials(fd);
}
export function credentialStream(socket: Socket, authorize: (sender: PeerCred | null) => boolean): ObservedStream<PeerCred> {
  const fd = socketDescriptor(socket); if (fd === null) throw new Error("connection descriptor is unobserved");
  // The listening socket enables capture before READY. Enable on the accepted
  // descriptor as well; queued bytes lacking credentials will be refused.
  enableUnixCredentials(fd);
  return new ObservedStream(socket, {
    read: () => {
      if (socket.destroyed || socketDescriptor(socket) !== fd) throw new Error("credential stream descriptor owner ended");
      return receiveUnixMessage(fd);
    },
    watch: (ready, failure) => {
      const watch: Watch = { fd, ready, failure, enabled: false, closed: false }; watches.add(watch);
      return { request(enabled) { if (!watch.closed) { watch.enabled = enabled; schedule(); } },
        close() { watch.closed = true; watches.delete(watch); } };
    },
  }, authorize);
}
