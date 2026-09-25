import { explicitFullOid } from "../request-intent.js";
import { keyOf, parseArguments } from "../arguments.js";
import { readBody, resolveOid } from "../effects.js";
import { fail, finishFailure, succeed, usage } from "../exit.js";
import { effect, randKey } from "../request-service.js";
import { call } from "../transport.js";

const CREATE = { options: { "--from": "value", "--file": "value", "--request": "value" }, positional: { min: 2, max: 2 } } as const;
const ACTION = { options: { "--request": "value" }, positional: { min: 2, max: 2 } } as const;
const CONTINUE = { options: { "--note": "value", "--request": "value" }, positional: { min: 1, max: 1 } } as const;
const WAIT = { options: {}, positional: { min: 1, max: 1 } } as const;

export async function runAgentCommand(args: string[]): Promise<never> {
  const sub = args[0];
  if (sub === "create") {
    const parsed = parseArguments(args, CREATE);
    const name = parsed.positional[1]!;
    const from = parsed.value("--from");
    const briefFile = parsed.value("--file");
    if (!from || !briefFile) usage();
    const key = keyOf(parsed) ?? randKey();
    return effect(
      "agent.create",
      key,
      () => {
        const oid = resolveOid(from);
        const brief = readBody(briefFile);
        if (!brief) fail("agent create requires --file <brief>", 2);
        return { method: "agent.create", params: { name, from: oid, brief } };
      },
      () => ({ name, ...explicitFullOid("from", from) }),
    );
  }
  if (sub === "start" || sub === "stop") {
    const parsed = parseArguments(args, ACTION);
    const name = parsed.positional[1]!;
    const key = keyOf(parsed) ?? randKey();
    const method = sub === "start" ? "agent.start" : "agent.stop";
    return effect(
      method,
      key,
      () => ({ method, params: { agent: name } }),
      () => ({ agent: name }),
    );
  }
  if (sub === "continue") {
    const parsed = parseArguments(args, CONTINUE);
    const note = parsed.value("--note");
    if (!note) usage();
    const key = keyOf(parsed) ?? randKey();
    return effect(
      "agent.continue",
      key,
      () => ({ method: "agent.continue", params: { note } }),
      () => ({ note }),
    );
  }
  if (sub === "wait") {
    parseArguments(args, WAIT);
    const replies = await call("agent.wait", {});
    if (!replies[0]?.ok) finishFailure(replies[0], "wait: ");
    console.log("wait accepted");
    return succeed();
  }
  return usage();
}
