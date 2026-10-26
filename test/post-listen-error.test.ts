import { testBroker } from "./helpers/broker-fixture.js";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
/** Post-listen 'error' settlement (WORKSTREAM §9 — 전신성 부류 전수 스캔):
 * a `server.once("error", reject)` removed after a successful listen leaves
 * zero 'error' listeners behind, so a later accept-class error
 * (EMFILE/ENFILE) escapes its emit as the host process's death -- the
 * runner mid-delivery, oma-society mid-session, a guest service mid-boot.
 * Every listen boundary now keeps a permanent listener that journals and
 * keeps the socket bound: the kernel retries the accept, while a close
 * would unlink the name the clients still dial.
 *
 * The oracle needs no real fd exhaustion: `server.emit("error", ...)` is
 * synchronous and throws at the emit on a listenerless server; on a fixed
 * one the permanent listener absorbs it. Each site's journal seam is
 * checked too -- a sink that throws inside the emit is the same escape.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { connect, Socket, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type { ResolvedAgentSpec } from "@oma/contracts";
import { Broker } from "@oma/broker";
import { LifecycleModule } from "@oma/lifecycle";
import { ConnectProxy, type EgressAudit } from "#oma-test/app/runtime/connect-proxy";
import { InferenceRelay } from "#oma-test/app/runtime/inference-relay";
import type { FeatureExecution } from "./fixtures/execution.js";
import { ViewsModule } from "#oma-test/app/views";
import { preparedFixture } from "./fixtures/delivery-receipt.js";
import { TEST_VIEW_LIMITS } from "./fixtures/limits.js";

function scratch(t: TestContext): { path(name: string): string } {
  const dir = mkdtempSync(join(tmpdir(), "oma-listen-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { path: name => join(dir, name) };
}

/** The journal each unit writes on its stderr, captured for one test. */
function journal(t: TestContext): string[] {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  t.after(() => { console.error = original; });
  return lines;
}

/** The shape a kernel accept failure takes. */
const acceptError = (): Error => Object.assign(new Error("accept failed"), { code: "EMFILE" });

/** The listener still answers after the error: its name stayed bound. */
async function stillServing(socketPath: string): Promise<void> {
  const probe = connect(socketPath);
  probe.on("error", () => {});
  await once(probe, "connect");
  probe.destroy();
}

/** What the permanent listener leaves behind: itself alone, after the
 * startup once-listener is removed. Zero meant the emit below threw. */
function expectPermanent(server: Server): void {
  assert.equal(server.listenerCount("error"), 1, "the startup once-listener is gone; the permanent one stays");
}

test("post-listen: the inference relay absorbs an accept-class error and keeps the socket bound", async t => {
  const { path } = scratch(t);
  const socketPath = path("inference.sock");
  const relay = await InferenceRelay.open(socketPath,
    { origin: "https://example.com", headers: {} }, { concurrent: 2, timeoutMs: 5000 });
  t.after(() => relay.close());
  const lines = journal(t);
  const server = Reflect.get(relay, "server") as Server;
  expectPermanent(server);
  server.emit("error", acceptError());
  assert.ok(lines.some(line => line.includes("accept failed")), "the error reached the journal");
  assert.equal(server.listening, true, "the relay keeps listening");
  await stillServing(socketPath);
});

test("post-listen: the CONNECT proxy absorbs an accept-class error through its audit journal", async t => {
  const { path } = scratch(t);
  const socketPath = path("egress.sock");
  const audits: EgressAudit[] = [];
  const proxy = await ConnectProxy.open({ socketPath,
    actor: "alice",
    dial: async () => new Socket(), audit: entry => audits.push(entry) });
  t.after(() => proxy.close());
  const server = Reflect.get(proxy, "server") as Server;
  expectPermanent(server);
  server.emit("error", acceptError());
  assert.deepEqual(audits.map(entry => [entry.target, entry.decision]), [["(listener)", "fail"]]);
  assert.match(audits[0]!.reason, /accept failed/);
  assert.equal(server.listening, true);
  await stillServing(socketPath);
});

test("post-listen: a refusing audit sink cannot throw out of the proxy listener's emit", async t => {
  const { path } = scratch(t);
  const socketPath = path("egress.sock");
  const proxy = await ConnectProxy.open({ socketPath,
    actor: "alice",
    dial: async () => new Socket(), audit: () => { throw new Error("the journal is dead"); } });
  t.after(() => proxy.close());
  const server = Reflect.get(proxy, "server") as Server;
  server.emit("error", acceptError());
  assert.equal(server.listening, true);
  await stillServing(socketPath);
});

const RUN = { placeholderId: randomUUID(), society: "demo", actor: "principal", incarnation: 0, modelProfile: "default" };


test("post-listen: the broker's listener survives a dead journal sink -- the cleanup write cannot escape the emit", async t => {
  // `listen`'s permanent 'error' listener ends in `cleanupError`, whose
  // console.error ran unguarded: a dead stderr inside the emit was the same
  // escape the listener exists to absorb. The run-revoke path in
  // `listenActor` reaches the identical write.
  const f = await preparedFixture();
  const units = { onRevokeRun: undefined, bindIncarnationReader: () => undefined, unitCgroup: () => "",
    observe: () => ({ activeState: "active", subState: "running", result: "success", execMainStatus: 0, scope: "", invocationId: "a".repeat(32) }),
    observeStatus: async () => new Map() } as unknown as FeatureExecution;
  const lifecycle = createLifecycleModule(f.store, units, { stateRoot: f.root, projectGit: join(f.root, "repos", "project.git"),
    society: "demo", hasGoal: () => true, activationAllowed: () => true },
    (_parent: unknown, input: { name: string; from: string; brief: string }) => ({ ...input }) as unknown as ResolvedAgentSpec, f.mail);
  const broker = testBroker({ store: f.store, mail: f.mail, units: units, views: new ViewsModule(f.store, f.root, "demo", "p", TEST_VIEW_LIMITS), lifecycle: lifecycle, git: null, reviews: null, reconcile: null, paths: { stateRoot: f.root, runRoot: join(f.root, "run"), society: "demo", hasGoal: () => true } });
  // The drain is also the teardown: an emit that escaped would otherwise
  // leave both listeners bound and the process could never exit.
  t.after(() => void broker.drainAndClose().catch(() => undefined));
  const escaped: unknown[] = [];
  const onUncaught = (error: Error) => { escaped.push(error); };
  process.once("uncaughtException", onUncaught);
  // The journal's own sink is dead for the rest of the test.
  const original = console.error;
  console.error = () => { throw new Error("stderr is dead"); };
  try {
    await broker.start();
    const server = Reflect.get(broker, "hostServer") as Server;
    server.emit("error", acceptError());
    assert.equal(server.listening, true, "the emit absorbed the journal's own failure");
    // The shared sink the run-revoke path reaches: the same guarded write.
    assert.doesNotThrow(() => Reflect.get(broker, "cleanupError").call(broker, new Error("revoke failed")));
    await broker.drainAndClose();
  } finally {
    console.error = original;
    process.off("uncaughtException", onUncaught);
    (f.store as unknown as { close(): void }).close = () => undefined;
    f.close();
  }
  assert.deepEqual(escaped, [], "nothing escaped a synchronous emit");
});
