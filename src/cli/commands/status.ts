import { parseArguments } from "../arguments.js";
import { call } from "../transport.js";
import { fail, finishFailure, succeed } from "../exit.js";

const STATUS = { options: {}, positional: { min: 0, max: 1 } } as const;

export async function runStatusCommand(args: string[]): Promise<never> {
  const agent = parseArguments(args, STATUS).positional[0];
  let replies;
  try {
    replies = await call("status.get", agent ? { agent } : {});
  } catch {
    fail("broker unreachable", 3);
  }
  const reply = replies[0];
  if (!reply?.ok) finishFailure(reply, "status: ");
  console.log(JSON.stringify(reply.result));
  return succeed();
}
