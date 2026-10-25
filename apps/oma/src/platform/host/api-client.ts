/** The Human CLI's authenticated request. This client never starts a VM. */
import { encodeFrame } from "@oma/protocol/frame";
import { HOST_API_VERSION } from "@oma/protocol/host-api";
import { PLATFORM_FRAME_BYTES } from "@oma/protocol/host-guest";
import { connectSocket, readLeadingResponse } from "../rpc.js";

export async function hostApiRequest(socketPath: string, token: string, method: string,
  params: Record<string, unknown>, key?: string, timeoutMs = 180_000): Promise<Record<string, unknown>> {
  const socket = await connectSocket(socketPath, 10_000);
  try {
    socket.write(encodeFrame({ v: 1, id: "h", method: "hello", params: {
      api: { min: Math.max(1, HOST_API_VERSION - 1), max: HOST_API_VERSION }, token, client: "oma-cli" } }));
    const hello = await readLeadingResponse(socket, "h", PLATFORM_FRAME_BYTES, 10_000);
    if (hello.rest.length > 0) socket.unshift(hello.rest);
    socket.write(encodeFrame({ v: 1, id: "r", method, params, ...(key === undefined ? {} : { key }) }));
    return (await readLeadingResponse(socket, "r", PLATFORM_FRAME_BYTES, timeoutMs)).result;
  } finally { socket.destroy(); }
}
