import { createMailModule } from "#oma-test/app/broker/mail-composition";
// TEST-002: child crash harness; parent owns exactly this process and temporary society.
import { join } from "node:path";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { sendWithStop, type MailStopPoint } from "./mail-faults.js";
import type { AuthContext, MailInput } from "@oma/contracts";
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
  // An empty OMA_STOP is the "no stop point" case used by the resend runs.
  if (value === undefined || value === "") return undefined;
  if (value === "stage" || value === "object" || value === "accepted" || value === "archive") return value;
  if (/^inbox-[1-9]\d*$/.test(value)) return `inbox-${Number(value.slice(6))}`;
  throw new Error("unknown requested mail fault boundary");
}

if (role === "send") {
  const mail = createMailModule({ stateRoot: state, society }, store, 64);
  const auth: AuthContext = {
    actor: process.env.OMA_SENDER ?? "a", incarnation: 1, role: "resident", channel: "actor",
    capabilities: new Set(["mail.send"]), peer: { pid: 1, uid: 1000, gid: 1000 },
  };
  const input: MailInput = {
    to: (process.env.OMA_TO ?? "b").split(",").filter(Boolean),
    subject: process.env.OMA_SUBJECT ?? "crash test", kind: "message", body: process.env.OMA_BODY ?? "body",
  };
  try {
    const receipt = await sendWithStop(mail, store, auth, process.env.OMA_KEY ?? "k", input, stopPoint(process.env.OMA_STOP), point => {
      console.log(`BOUNDARY:${point}`);
      process.kill(process.pid, "SIGSTOP");
    });
    console.log(`RECEIPT:${JSON.stringify(receipt)}`);
    store.close(); process.exit(0);
  } catch (error) {
    console.log(`ERROR:${error instanceof Error ? error.message : String(error)}`);
    store.close(); process.exit(2);
  }
}
store.close();
process.exit(1);
