import { testBroker } from "./helpers/broker-fixture.js";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
/** V26A / INV10 (adversarial): a Resident reaches its own actor socket, and
 * every connection there costs the broker a socket and a peer pidfd. A flood of
 * connections is held to ACTOR_CONNECTIONS by the kernel listener, costs the
 * broker bounded descriptors, and once it ends the Resident's next call is
 * answered. Real Broker.openRun on this test process's own cgroup, real Unix
 * sockets and frames.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { join } from "node:path";
import type { ResolvedAgentSpec } from "@oma/contracts";
import { ACTOR_CONNECTIONS, Broker } from "@oma/broker";
import { LifecycleModule } from "@oma/lifecycle";
import { ViewsModule } from "#oma-test/app/views";
import type { FeatureExecution } from "./fixtures/execution.js";
import { FrameParser, encodeFrame } from "@oma/protocol/frame";
import { preparedFixture } from "./fixtures/delivery-receipt.js";
import { TEST_VIEW_LIMITS } from "./fixtures/limits.js";

const OWN_CGROUP = readFileSync("/proc/self/cgroup", "utf8").trim().split("\n")[0]!.slice(3);
const settle = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test("V26A: a connection flood on an actor socket is bounded, and the Resident is answered once it ends", { timeout: 60_000 }, async () => {
  const f = await preparedFixture(1);
  const id = "c".repeat(32);
  const units = { onRevokeRun: undefined, bindIncarnationReader: () => undefined, unitCgroup: () => "",
    observe: () => ({ activeState: "active", subState: "running", result: "success", execMainStatus: 0, scope: OWN_CGROUP, invocationId: id }),
  } as unknown as FeatureExecution;
  const lifecycle = createLifecycleModule(f.store, units, { stateRoot: f.root, projectGit: join(f.root, "repos", "project.git"), society: "demo",
    hasGoal: () => true, activationAllowed: () => true },
    (_parent: unknown, input: { name: string; from: string; brief: string }) => ({ ...input }) as unknown as ResolvedAgentSpec, f.mail);
  const broker = testBroker({ store: f.store, mail: f.mail, units: units, views: new ViewsModule(f.store, f.root, "demo", "p", TEST_VIEW_LIMITS), lifecycle: lifecycle, git: null, reviews: null, reconcile: null, paths: { stateRoot: f.root, runRoot: join(f.root, "run"), society: "demo", hasGoal: () => true } });
  const flood: Socket[] = [];
  try {
    await broker.start();
    const lease = await (Reflect.get(broker, "openRun") as (actor: string, invocation: string) => Promise<{ socketHostPath: string }>).call(broker, "alice", id);
    const served = () => (Reflect.get(broker, "connections") as Map<unknown, unknown>).size;
    for (let i = 0; i < 400; i += 1) { const socket = connect(lease.socketHostPath); socket.on("error", () => {}); flood.push(socket); }
    await settle(1500);
    assert.ok(served() <= ACTOR_CONNECTIONS, `the broker served ${served()} connections of one flood`);
    for (const socket of flood) socket.destroy();
    await settle(300);
    // Liveness: the Resident's next call is answered.
    const answer = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const socket = connect(lease.socketHostPath);
      const parser = new FrameParser(TEST_VIEW_LIMITS.frameBytes);
      socket.on("error", reject);
      socket.on("data", (chunk: Buffer) => { for (const frame of parser.feed(chunk)) { resolve(frame.raw); socket.destroy(); } });
      socket.write(encodeFrame({ v: 1, id: "after-flood", method: "status.get", params: { agent: "alice" } }));
    });
    assert.equal(answer.id, "after-flood");
    assert.equal(answer.ok, true, JSON.stringify(answer));
  } finally {
    for (const socket of flood) socket.destroy();
    await broker.drainAndClose();
    (f.store as unknown as { close(): void }).close = () => undefined;
    f.close();
  }
});
