// TEST-002: child crash harness; parent owns exactly this process and temporary society.
import { join } from "node:path";
import { Store } from "../../src/store.js";
import { MailModule } from "../../src/mail.js";
import { sendWithStop, StopSignal, type MailStopPoint } from "./mail-faults.js";
import type { AuthContext, MailInput } from "../../implementation/contracts.js";
import { makeValidAgent } from "./spec.js";

const state = process.env.OMA_STATE!;
const society = process.env.OMA_SOCIETY ?? "demo";
const role = process.env.OMA_ROLE!;
const store = new Store(join(state, "runtime.sqlite"));

if (role === "seed") {
  const agents = process.env.OMA_AGENTS!.split(",").filter(Boolean);
  store.transaction(() => {
    for (const entry of agents) {
      const [name, desired] = entry.split(":");
      if (!name || !["enabled", "stopped", "provisioning", "retired"].some(value => value === desired))
        throw new Error("invalid normal mail agent fixture");
      if (desired !== "enabled" && desired !== "stopped" && desired !== "provisioning" && desired !== "retired")
        throw new Error("invalid desired state");
      store.insertAgent(makeValidAgent(name, { desired }));
    }
    if (!store.getAgent("principal")) store.insertAgent(makeValidAgent("principal"));
  });
  for (const agent of store.listAgents()) if (!agent.specHash) throw new Error("normal agent did not round-trip");
  store.close();
  process.exit(0);
}

function stopPoint(value: string | undefined): MailStopPoint | undefined {
  if (value === undefined || value === "stage" || value === "object" || value === "accepted" || value === "archive") return value;
  if (/^inbox-[1-9]\d*$/.test(value)) return `inbox-${Number(value.slice(6))}`;
  throw new Error("unknown requested mail fault boundary");
}

if (role === "send") {
  const mail = new MailModule({ stateRoot: state, society }, store, 64);
  const auth: AuthContext = {
    actor: process.env.OMA_SENDER ?? "a", incarnation: 1, role: "resident", channel: "actor",
    capabilities: new Set(["mail.send"]), peer: { pid: 1, uid: 1000, gid: 1000, cgroup: null },
  };
  const input: MailInput = {
    to: (process.env.OMA_TO ?? "b").split(",").filter(Boolean),
    subject: process.env.OMA_SUBJECT ?? "crash test", kind: "message", body: process.env.OMA_BODY ?? "body",
  };
  try {
    const receipt = await sendWithStop(mail, store, auth, process.env.OMA_KEY ?? "k", input, stopPoint(process.env.OMA_STOP));
    console.log(`RECEIPT:${JSON.stringify(receipt)}`);
    store.close(); process.exit(0);
  } catch (error) {
    if (error instanceof StopSignal) {
      console.log(`BOUNDARY:${error.point}`);
      process.kill(process.pid, "SIGSTOP");
    } else {
      console.log(`ERROR:${error instanceof Error ? error.message : String(error)}`);
      store.close(); process.exit(2);
    }
  }
  await new Promise(() => { /* parent SIGKILLs at the verified boundary */ });
}
store.close();
process.exit(1);
