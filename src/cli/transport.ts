/** CLI transport policy only. Freeze/query/resend and exit codes remain in
 * the CLI request service, not in the role-neutral protocol channel.
 */
import type { PublicMethod } from "../../implementation/contracts.js";
import { BrokerChannel, type RpcReply } from "../protocol/channel.js";
import { StoreError } from "../domain/errors.js";
import { isLogResponseFrameLimit } from "../protocol/log-response.js";

// CFG-003: sandbox supplies the host's limit; only an omitted setting uses 256 KiB.
// Preserve the CLI's absolute 60-second deadline independently of frame sizing.
const CLI_DEADLINE_MS = 60000;
export async function callActor(
  path: string, method: PublicMethod, params: Record<string, unknown>, request?: string, streamBytes?: Uint8Array,
): Promise<RpcReply<PublicMethod>[]> {
  const configured = process.env.OMA_FRAME_BYTES;
  const frameBytes = configured === undefined ? 256 * 1024 : Number(configured);
  if ((configured !== undefined && !/^[0-9]+$/.test(configured)) || !isLogResponseFrameLimit(frameBytes))
    throw new StoreError("INVALID_REQUEST", "OMA_FRAME_BYTES must be decimal bytes supporting log responses and uint32 framing");
  const channel = new BrokerChannel({ frameBytes, idleStreamSeconds: 60, receiptWaitSeconds: 60 });
  const timer = setTimeout(() => channel.close(new StoreError("BROKER_UNAVAILABLE", "broker did not answer before the CLI deadline")), CLI_DEADLINE_MS);
  try {
    await channel.connect(path);
    const result = await channel.call(method, params, {
      ...(request === undefined ? {} : { request }), ...(streamBytes === undefined ? {} : { streamBytes }),
    });
    return [result];
  } finally { clearTimeout(timer); channel.close(); }
}
