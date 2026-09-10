// TEST-002 external kill harness for the mail module crash tests.
// Child process: seeds the society, then runs send() with a stop point and
// waits to be SIGKILLed by the parent. Production never loads this file.
import { join } from "node:path";
import { Store } from "../../src/store.js";
import { MailModule } from "../../src/mail.js";
import { sendWithStop, StopSignal, type MailStopPoint } from "./mail-faults.js";
import type { AuthContext, MailInput } from "../../implementation/contracts.js";
import { ALL_CAPS, resolvedSpec } from "./spec.js";

const state = process.env.OMA_STATE!;
const society = process.env.OMA_SOCIETY ?? "demo";
const role = process.env.OMA_ROLE!;
const store = new Store(join(state, "runtime.sqlite"));

if (role === "seed") {
  const agents = process.env.OMA_AGENTS!.split(",").filter(Boolean);
  store.transaction((_tx) => {
    for (const spec of agents) {
      const [name, desired] = spec.split(":") as [string, string];
      store.insertAgent({
        name,
        specHash: "h",
        role: name === "principal" ? "principal" : "resident",
        desired: desired as "enabled" | "stopped" | "provisioning" | "retired",
        incarnation: 1,
        profile: "p",
        createdBy: null,
        specJson: resolvedSpec(ALL_CAPS, "p", name),
      });
    }
    store.insertAgent({
      name: "principal",
      specHash: "h",
      role: "principal",
      desired: "enabled",
      incarnation: 0,
      profile: "p",
      createdBy: null,
      specJson: resolvedSpec(ALL_CAPS, "p", "principal"),
    });
  });
  store.close();
  process.exit(0);
}

if (role === "send") {
  const mail = new MailModule({ stateRoot: state, society }, store, 64);
  const auth: AuthContext = {
    actor: process.env.OMA_SENDER ?? "a",
    incarnation: 1,
    role: "resident",
    channel: "actor",
    capabilities: new Set(["mail.send"]),
    peer: { pid: 1, uid: 1000, gid: 1000, cgroup: null },
  };
  const input: MailInput = {
    to: (process.env.OMA_TO ?? "b")
      .split(",")
      .filter(Boolean) as MailInput["to"],
    subject: process.env.OMA_SUBJECT ?? "crash test",
    kind: "message",
    body: process.env.OMA_BODY ?? "body",
  };
  try {
    const receipt = await sendWithStop(mail, store,
      auth,
      process.env.OMA_KEY ?? "k",
      input,
      process.env.OMA_STOP as MailStopPoint | undefined,
    );
    console.log(`RECEIPT:${JSON.stringify(receipt)}`);
    store.close();
    process.exit(0);
  } catch (e) {
    if (e instanceof StopSignal) {
      console.log(`BOUNDARY:${e.point}`);
      process.kill(process.pid, "SIGSTOP");
    } else {
      console.log(`ERROR:${(e as Error).message}`);
      store.close();
      process.exit(2);
    }
  }
  await new Promise(() => {
    /* parent SIGKILLs at the boundary */
  });
}

store.close();
process.exit(1);
