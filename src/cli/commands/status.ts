import { parseArguments } from "../arguments.js";
import { call } from "../transport.js";
import { fail, finishFailure, succeed } from "../exit.js";

const STATUS = { options: { "--after": "value" }, positional: { min: 0, max: 1 } } as const;

export async function runStatusCommand(args: string[]): Promise<never> {
  const parsed = parseArguments(args, STATUS);
  const agent = parsed.positional[0];
  const after = parsed.value("--after");
  let replies;
  try {
    replies = await call("status.get", { ...(agent ? { agent } : {}), ...(after === null ? {} : { after }) });
  } catch {
    fail("broker unreachable", 3);
  }
  const reply = replies[0];
  if (!reply?.ok) finishFailure(reply, "status: ");
  console.log(JSON.stringify(reply.result));
  return succeed();
}
