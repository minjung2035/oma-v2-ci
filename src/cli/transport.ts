/** CLI transport policy only. Freeze/query/resend and exit codes remain in
 * the CLI request service, not in the role-neutral protocol channel.
 */
import type { PublicMethod } from "../../implementation/contracts.js";
import { BrokerChannel, type RpcReply } from "../protocol/channel.js";
import { StoreError } from "../domain/errors.js";

// The prior CLI used a 256 KiB frame and one absolute 60-second call deadline.
// Runner/Host retain their own 30-second defaults or explicit host limits.
const CLI_DEADLINE_MS = 60000;
export async function callActor(
  path: string, method: PublicMethod, params: Record<string, unknown>, request?: string, streamBytes?: Uint8Array,
): Promise<RpcReply<PublicMethod>[]> {
  const channel = new BrokerChannel({ frameBytes: 256 * 1024, idleStreamSeconds: 60, receiptWaitSeconds: 60 });
  const timer = setTimeout(() => channel.close(new StoreError("BROKER_UNAVAILABLE", "broker did not answer before the CLI deadline")), CLI_DEADLINE_MS);
  try {
    await channel.connect(path);
    const result = await channel.call(method, params, {
      ...(request === undefined ? {} : { request }), ...(streamBytes === undefined ? {} : { streamBytes }),
    });
    return [result];
  } finally { clearTimeout(timer); channel.close(); }
}
