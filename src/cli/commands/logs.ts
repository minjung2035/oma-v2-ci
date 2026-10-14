import { parseArguments } from "../arguments.js";
import { fail, finishFailure, succeed, usage } from "../exit.js";
import { call } from "../transport.js";

function parseDuration(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) fail(`invalid --since ${duration} (positive integer + s/m/h/d)`, 2);
  const value = Number(match[1]);
  if (!Number.isSafeInteger(value) || value <= 0) fail(`invalid --since ${duration}`, 2);
  const multiplier: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  const seconds = value * multiplier[match[2]!]!;
  if (!Number.isSafeInteger(seconds)) fail(`invalid --since ${duration} (duration exceeds the supported integer range)`, 2);
  return seconds;
}

const LOGS = { options: { "--since": "value" }, positional: { min: 1, max: 1 } } as const;

export async function runLogsCommand(args: string[]): Promise<never> {
  if (args.length === 0) usage();
  const parsed = parseArguments(args, LOGS);
  const agent = parsed.positional[0]!;
  const since = parsed.value("--since");
  if (!since) usage();
  let replies;
  try {
    replies = await call("logs.read", { agent, sinceSeconds: parseDuration(since) });
  } catch {
    fail("broker unreachable", 3);
  }
  const reply = replies[0];
  if (!reply?.ok) finishFailure(reply, "logs: ");
  const result = reply.result as { text: string; truncated: boolean };
  console.log(result.text === "" && !result.truncated ? `No log entries for ${agent} in the last ${since}.` : result.text);
  if (result.truncated) console.error("(truncated)");
  return succeed();
}
