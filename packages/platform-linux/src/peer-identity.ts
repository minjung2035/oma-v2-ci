/** Linux connection identity and pidfd mechanics. Reference counting and all
 * actor/current-authority decisions stay with the shared broker owner. */
import type { Socket } from "node:net";
import { closeSync } from "node:fs";
import { peerCred, peerPidFd, pidfdLiveness, socketDescriptor, type PeerCred } from "@oma/native/linux";
import { StoreError } from "@oma/domain/errors";
import { isUnixMessageSender } from "@oma/native/unix-message";

export interface LinuxPeerPin extends PeerCred { alive(): boolean; sameSender(sender: unknown): boolean; close(): void }
export function pinLinuxPeer(socket: Socket): LinuxPeerPin | null {
  const fd = socketDescriptor(socket);
  if (fd === null) throw new StoreError("AUTH_FAILED", "no socket fd");
  const credentials = peerCred(fd);
  if (credentials === null) return null;
  const pinned = peerPidFd(fd);
  if (pinned === null) return null;
  let closed = false;
  return Object.freeze({ ...credentials,
    alive: () => !closed && pidfdLiveness(pinned).kind === "running",
    sameSender: (sender: unknown) => !closed && isUnixMessageSender(sender) && sender.pid === credentials.pid &&
      sender.uid === credentials.uid && sender.gid === credentials.gid,
    close() { if (closed) return; closed = true; closeSync(pinned); },
  });
}
