/** Mach's aligned inline packets as a shared TS byte stream. No RPC codec,
 * role/scope grant, filesystem pathname or process-death inference lives here.
 */
import { PacketStream, type PacketDriver } from "@oma/process/packet-stream";
import type { MachReceiveRight, MachSendRight, MachAuditSender } from "@oma/native/mach-message";
import { cleanupAll, withAsyncCleanup, withCleanup } from "@oma/native/cleanup";
import { StoreError } from "@oma/domain/errors";
import { machPoll } from "./mach-poll.js";

const DATA = 0x4f4d4102, END = 0x4f4d4103, PACKET_BYTES = 65532;
export interface MachStreamEndpoints { readonly receive: MachReceiveRight; readonly send: MachSendRight }

/** Takes both endpoint owners. Kernel enqueue is Writable completion, never
 * an accepted RPC result. Physical receive-port loss is an error, not EOF.
 */
export function machStream(endpoints: MachStreamEndpoints, authorize: (sender: MachAuditSender) => boolean,
  onClosed: () => void | Promise<void> = () => {}, ready: () => boolean = () => true): PacketStream<MachAuditSender> {
  let closed: Promise<void> | undefined;
  const driver: PacketDriver<MachAuditSender> = {
    maximumPacketBytes: PACKET_BYTES,
    read() {
      if (!ready()) return { kind: "again" };
      const message = endpoints.receive.receive();
      if (message.kind === "again") {
        // A peer may return its receive right after enqueuing a final reply
        // and EOF. Drain actual queued packets first; port loss itself never
        // manufactures EOF, process death or authorization for those bytes.
        if (endpoints.send.destination() !== "present") throw new StoreError("BROKER_UNAVAILABLE", "Mach destination is no longer observed available");
        return message;
      }
      return withCleanup(() => {
        if (message.reply !== null) throw new StoreError("STREAM_INVALID", "unexpected Mach right in stream packet");
        if (message.id === END && message.bytes.length === 0) return { kind: "end", sender: message.sender };
        if (message.id !== DATA || message.bytes.length < 8) throw new StoreError("STREAM_INVALID", "invalid Mach byte packet");
        const count = message.bytes.readUInt32LE(0), padded = (count + 3) & ~3;
        if (count < 1 || count > PACKET_BYTES || message.bytes.length !== 4 + padded ||
            message.bytes.subarray(4 + count).some(byte => byte !== 0))
          throw new StoreError("STREAM_INVALID", "invalid Mach byte packet length or padding");
        return { kind: "data", bytes: message.bytes.subarray(4, 4 + count), sender: message.sender };
      }, () => message.reply?.close());
    },
    send(packet) {
      if (!ready()) return "again";
      if (packet.kind === "end") return endpoints.send.send(END, Buffer.alloc(0));
      const bytes = Buffer.alloc(4 + ((packet.bytes.length + 3) & ~3));
      bytes.writeUInt32LE(packet.bytes.length, 0); bytes.set(packet.bytes, 4);
      return endpoints.send.send(DATA, bytes);
    },
    watch(ready, failure) {
      const poll = machPoll(ready, failure);
      return { request: (read, write) => poll.request(read || write), close: () => poll.close() };
    },
    close() {
      closed ??= withAsyncCleanup(async () => {
        cleanupAll([() => endpoints.receive.close(), () => endpoints.send.close()]);
      }, onClosed);
      return closed;
    },
  };
  return new PacketStream(driver, authorize);
}
