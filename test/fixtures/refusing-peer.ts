import { createServer, type Server } from "node:net";
import { join } from "node:path";

interface Peer { readonly path: string; readonly frames: Record<string, unknown>[]; close(): Promise<void> }
/** Records every request frame and refuses it, so nothing is ever accepted. */
export async function refusingPeer(root: string): Promise<Peer> {
  const frames: Record<string, unknown>[] = [];
  const path = join(root, "control.sock");
  const server: Server = createServer(socket => {
    let pending = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 4 && pending.length >= 4 + pending.readUInt32BE(0)) {
        const length = pending.readUInt32BE(0);
        const frame = JSON.parse(pending.subarray(4, 4 + length).toString("utf8")) as Record<string, unknown>;
        pending = pending.subarray(4 + length);
        frames.push(frame);
        const reply = Buffer.from(JSON.stringify({ v: 1, id: frame.id, ok: false,
          error: { code: "BROKER_UNAVAILABLE", message: "fixture", retry: "same-key" } }));
        const head = Buffer.alloc(4); head.writeUInt32BE(reply.length, 0);
        socket.write(Buffer.concat([head, reply]));
      }
    });
    socket.on("error", () => {});
  });
  await new Promise<void>(resolve => { server.listen(path, resolve); });
  return { path, frames, close: () => new Promise<void>(resolve => { server.close(() => resolve()); }) };
}
