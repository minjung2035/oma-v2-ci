import { call } from "../transport.js";
import { fail, finishFailure, succeed } from "../exit.js";

export async function runStatusCommand(args: string[]): Promise<never> {
  const agent = args[0];
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
