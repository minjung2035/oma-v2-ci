import { explicitFullOid } from "../request-intent.js";
import { keyOf, opt } from "../arguments.js";
import { readBody, resolveOid } from "../effects.js";
import { fail, finishFailure, succeed, usage } from "../exit.js";
import { effect, randKey } from "../request-service.js";
import { call } from "../transport.js";

export async function runAgentCommand(args: string[]): Promise<never> {
  const sub = args[0];
  if (sub === "create") {
    const name = args[1];
    const from = opt(args, "--from");
    const briefFile = opt(args, "--file");
    if (!name || !from || !briefFile) usage();
    const key = keyOf(args) ?? randKey();
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
    const name = args[1];
    if (!name) usage();
    const key = keyOf(args) ?? randKey();
    const method = sub === "start" ? "agent.start" : "agent.stop";
    return effect(
      method,
      key,
      () => ({ method, params: { agent: name } }),
      () => ({ agent: name }),
    );
  }
  if (sub === "continue") {
    const note = opt(args, "--note");
    if (!note) usage();
    const key = keyOf(args) ?? randKey();
    return effect(
      "agent.continue",
      key,
      () => ({ method: "agent.continue", params: { note } }),
      () => ({ note }),
    );
  }
  if (sub === "wait") {
    const replies = await call("agent.wait", {});
    if (!replies[0]?.ok) finishFailure(replies[0], "wait: ");
    console.log("wait accepted");
    return succeed();
  }
  return usage();
}
