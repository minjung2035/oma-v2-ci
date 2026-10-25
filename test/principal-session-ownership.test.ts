import { engineStartEffects } from "#oma-test/app/engine/start-effects";
// V09A/V09B/V09C (WP09, D06): a real PrincipalSession over a scripted engine.
// Ownership of the engine's run ends only on settlement, refusal or the
// session's end; unsent Human input comes back once, in order; input whose
// acceptance is unknown is reported apart and never resent.
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostTenure } from "#oma-test/app/runtime/host-tenure";
import { type FencedEngine } from "@oma/contracts/runtime";
import { PrincipalSession } from "@oma/engine/principal-session";
import { PiRpcClient } from "@oma/engine/pi-rpc";
import { PrincipalDelivery } from "#oma-test/app/runtime/principal-delivery";
import { TEST_VIEW_LIMITS } from "./fixtures/limits.js";
import { TurnAdmission } from "@oma/domain/turn-admission";

test("DR44: turn admission isolates unknown delivery, transfers queued Humans atomically, and reports unsent input once", () => {
  const turns = new TurnAdmission();
  assert.equal(turns.claimDelivery(), true);
  turns.writing("batch", "/oma-deliver batch", "delivery");
  assert.equal(turns.claimHuman("first"), "queued");
  assert.equal(turns.claimHuman("second"), "queued");
  assert.equal(turns.claimDelivery(), false, "ambiguous acceptance lost its claim");
  assert.equal(turns.response("stale"), null);
  assert.equal(turns.busy, true);
  assert.deepEqual(turns.release("human"), { released: false, next: null });
  assert.equal(turns.settle(), "first");
  assert.equal(turns.busy, true, "handoff exposed an idle window to Mail");
  assert.equal(turns.claimDelivery(), false);
  turns.writing("human", "first", "human");
  assert.deepEqual(turns.end(), { unconfirmed: "first", unsent: ["second"] });
  assert.deepEqual(turns.end(), { unconfirmed: null, unsent: [] });
});

test("DR44: a provably unwritten prompt returns the run and keeps the bounded Human queue in order", () => {
  const turns = new TurnAdmission();
  assert.equal(turns.claimHuman("unwritten"), "started");
  turns.writing("human-1", "unwritten", "human");
  for (let i = 0; i < TurnAdmission.WAITING; i++) assert.equal(turns.claimHuman(`waiting-${i}`), "queued");
  assert.equal(turns.claimHuman("overflow"), "full");
  turns.notWritten("human-1");
  assert.deepEqual(turns.release("human"), { released: true, next: "waiting-0" });
  assert.equal(turns.busy, true);
  assert.equal(turns.end().unconfirmed, null, "unwritten input was reported as possibly accepted");
});

const LIMITS = { frameBytes: TEST_VIEW_LIMITS.frameBytes, idleStreamSeconds: 30, receiptWaitSeconds: 5 };
const BATCH_ID = "b-00000000-0000-4000-8000-0000000000a9";
const BATCH = { id: BATCH_ID, agent: "principal", incarnation: 0,
  messageIds: [], deliveryMode: "followUp", notice: "", sessionPath: null, indexPath: "/inbox.md" } as never;

async function until(what: string, done: () => boolean, ms = 5000): Promise<void> {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(resolve => setTimeout(resolve, 5))) if (done()) return;
  assert.fail(`timed out waiting for ${what}`);
}

function scripted(t?: TestContext, acquired?: (engine: FencedEngine) => void) {
  const root = mkdtempSync(join(tmpdir(), "oma-v09-"));
  t?.after(() => rmSync(root, { recursive: true, force: true }));
  const log = join(root, "prompts.log");
  mkdirSync(join(root, "agents", "principal", "runner", "view"), { recursive: true });
  // AV3: the product's layout -- the model's workspace beside the session
  // history, both inside the private home, neither holding the other.
  mkdirSync(join(root, "workspace")); mkdirSync(join(root, "sessions"));
  const events = { failed: [] as { text: string; reason: string }[], unconfirmed: [] as string[], ends: 0, busy: [] as boolean[] };
  const session = PrincipalSession.start(
    engineStartEffects, { piCommand: process.execPath, piArgs: [join(process.cwd(), "test", "fixtures", "scripted-pi.mjs"), log],
      coreExtension: "/nonexistent/core.js", sessionDir: join(root, "sessions"), workspace: join(root, "workspace"), home: root },
    { society: "demo", provider: "p", model: "m", extensions: [] },
    LIMITS, { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    {
      ...(acquired === undefined ? {} : { onAcquire: acquired }),
      onLine: () => {}, onBusy: busy => events.busy.push(busy), onEnd: () => { events.ends += 1; },
      onPromptFailed: (text, reason) => events.failed.push({ text, reason }),
      onPromptUnconfirmed: text => events.unconfirmed.push(text),
    },
  );
  const written = (): string[] => existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
  const pid = (): number => { const value = session.pid; assert.ok(value); return value!; };
  return { root, session, events, written, pid,
    close: async () => { session.close(); await session.exited; rmSync(root, { recursive: true, force: true }); } };
}

test("V09A: an unanswered delivery keeps the session, so a Human prompt waits instead of joining its run", async () => {
  const s = scripted();
  try {
    let now = 0;
    // The delivery command is answered by nobody within its accept deadline.
    const delivery = new PrincipalDelivery({
      get running() { return s.session.running; }, get busy() { return s.session.busy; },
      onEvent: listener => s.session.onEvent(listener),
      deliver: async batchId => { await s.session.deliver(batchId); },
    }, { prepare: async () => BATCH, complete: async () => {} },
    { stateRoot: s.root, frameBytes: LIMITS.frameBytes, acceptMs: 30, retryAfterMs: 60_000, now: () => (now += 20) });
    // Make the stand-in silent for the delivery command by prefixing its text.
    const deliver = s.session.deliver.bind(s.session);
    (s.session as unknown as { deliver: (id: string) => Promise<void> }).deliver = id => deliver(`silent:${id}` as never);
    const outcome = await delivery.tick();
    assert.equal(outcome.kind, "failed");
    assert.equal(s.session.busy, true, "an ambiguous accept timeout freed the session");
    // The Human types meanwhile: the prompt waits, it is not written into the run.
    assert.deepEqual(s.session.submit("while unsure"), { kind: "accepted" });
    await until("the delivery command to reach the engine", () => s.written().length > 0);
    assert.equal(s.session.busy, true);
    assert.deepEqual(s.written(), [`/oma-deliver silent:${BATCH_ID}`]);
    // The engine answers late and the run settles: only now does the Human's go.
    process.kill(s.pid(), "SIGUSR1");
    await until("the waiting prompt to be written after the late settle", () => s.written().includes("while unsure"));
    assert.deepEqual(s.events.failed, []);
  } finally { await s.close(); }
});

test("V09B: when the engine ends, unsent prompts come back once and in order, and an unanswered one is reported apart", async () => {
  for (const ending of ["engine-exit", "quit"] as const) {
    const s = scripted();
    try {
      assert.deepEqual(s.session.submit("silent: typed first"), { kind: "accepted" });
      await until("the first prompt to be written", () => s.written().length === 1);
      for (const text of ["second", "third", "fourth"]) assert.deepEqual(s.session.submit(text), { kind: "accepted" });
      if (ending === "engine-exit") process.kill(s.pid(), "SIGKILL");
      else s.session.close();
      await until("the session to end", () => s.events.ends === 1 || (ending === "quit" && s.events.failed.length === 3));
      await s.session.exited;
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.deepEqual(s.events.failed.map(entry => entry.text), ["second", "third", "fourth"], ending);
      assert.deepEqual(s.events.unconfirmed, ["silent: typed first"], `${ending}: the written, unanswered prompt`);
      assert.deepEqual(s.written(), ["silent: typed first"], `${ending}: something was resent`);
      // A second ending notice returns nothing again.
      s.session.close();
      assert.equal(s.events.failed.length, 3);
      assert.equal(s.events.unconfirmed.length, 1);
      assert.equal(s.session.busy, false);
    } finally { await s.close(); }
  }
});

test("V09C: after the session ends, a late settle frees nothing and starts nothing", async () => {
  const s = scripted();
  try {
    assert.deepEqual(s.session.submit("hold: long run"), { kind: "accepted" });
    await until("the run to start", () => s.written().length === 1);
    assert.deepEqual(s.session.submit("queued"), { kind: "accepted" });
    s.session.close();
    await s.session.exited;
    // The engine is gone; an event for its run cannot hand the session to the
    // queued prompt of a session that no longer exists.
    (s.session as unknown as { observe: (event: unknown) => void }).observe({ type: "agent_settled" });
    assert.deepEqual(s.written(), ["hold: long run"]);
    assert.deepEqual(s.events.failed.map(entry => entry.text), ["queued"]);
    assert.equal(s.session.busy, false);
  } finally { await s.close(); }
});

test("B3: the waiting queue's snapshot is emitted on every change, folded and cleared at handback", async () => {
  const s = scripted();
  const sent: { type: string; total?: unknown; prompts?: unknown }[] = [];
  // The interactive channel is a socket in production; here the same event
  // stream is collected from the seam it is sent through.
  const stubUi = () => ({ send: (event: unknown) => sent.push(event as (typeof sent)[number]), close: () => {} });
  (s.session as unknown as { ui: ReturnType<typeof stubUi> | null }).ui = stubUi();
  try {
    assert.deepEqual(s.session.submit("hold: first"), { kind: "accepted" });
    await until("the first prompt to be written", () => s.written().length === 1);
    assert.equal(sent.length, 0, "a prompt written straight to the engine draws no queue");
    assert.deepEqual(s.session.submit("queued one"), { kind: "accepted" });
    assert.deepEqual(s.session.submit("queued two \u200b\u200bwith marks"), { kind: "accepted" });
    assert.deepEqual(sent, [
      { type: "queued_prompts", total: 1, prompts: ["queued one"] },
      { type: "queued_prompts", total: 2, prompts: ["queued one", "queued two with marks"] },
    ], "each push emits the whole bounded snapshot, unseen text folded out");
    process.kill(s.pid(), "SIGUSR2");
    // Each settle hands the session to the next waiter and re-emits, until empty.
    await until("the queue to drain", () => s.written().length === 3 &&
      sent.length >= 2 && (sent.at(-1) as { total: number }).total === 0);
    assert.deepEqual(s.written(), ["hold: first", "queued one", "queued two \u200b\u200bwith marks"],
      "the queue keeps the real text; only its picture is folded");
  } finally { await s.close(); }

  const late = scripted();
  (late.session as unknown as { ui: ReturnType<typeof stubUi> | null }).ui = stubUi();
  try {
    assert.deepEqual(late.session.submit("silent: unanswered run"), { kind: "accepted" });
    await until("the unanswered prompt to be written", () => late.written().length === 1);
    assert.deepEqual(late.session.submit("still waiting"), { kind: "accepted" });
    late.session.close();
    await late.session.exited;
    assert.deepEqual(sent.at(-1), { type: "queued_prompts", total: 0, prompts: [] },
      "handback empties the widget so a dead session shows no stale queue");
    assert.deepEqual(late.events.failed.map(entry => entry.text), ["still waiting"]);
  } finally { await late.close(); }
});

test("P0V-73 / F6, P0-4: a Principal engine that could not be spawned has ended, and nothing else ends it early", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-spawn-failed-"));
  try {
    mkdirSync(join(root, "agents", "principal", "runner", "view"), { recursive: true });
    mkdirSync(join(root, "workspace")); mkdirSync(join(root, "sessions"));
    const session = PrincipalSession.start(
      engineStartEffects, { piCommand: join(root, "no-such-engine"), coreExtension: "/nonexistent/core.js", sessionDir: join(root, "sessions"),
        workspace: join(root, "workspace"), home: root },
      { society: "demo", provider: "p", model: "m", extensions: [] },
      LIMITS, { PATH: process.env.PATH ?? "/usr/bin:/bin" },
      { onLine: () => {}, onBusy: () => {}, onEnd: () => {}, onPromptFailed: () => {}, onPromptUnconfirmed: () => {} },
    );
    const outcome = await Promise.race([session.exited.then(() => "ended"), new Promise(resolve => setTimeout(() => resolve("pending"), 2000))]);
    assert.equal(outcome, "ended", "the session of a spawn that failed never ended");
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test("DR27/P0-4: Principal event-registration failure returns the engine and private channels", { timeout: 5000 }, async t => {
  const problem = new Error("injected Principal setup failure");
  let client: PiRpcClient | undefined;
  t.mock.method(PiRpcClient.prototype, "onEvent", function (this: PiRpcClient) { client = this; throw problem; });
  t.after(() => client?.close());
  assert.throws(() => scripted(t), error => error === problem);
  assert.ok(client);
  assert.equal(client.child.killed, true, "no PrincipalSession received ownership");
  for (const stream of client.child.stdio) if (stream) {
    assert.equal(stream.destroyed, true, "private channel retained after failed setup");
    assert.equal(stream.listenerCount("data"), 0, "failed session must detach its RPC reader before handoff returns");
  }
  await client.completion;
});


test("DR27/P0-4: failed Principal setup remains the tenure's engine until actual exit", { timeout: 5000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-failed-tenure-"));
  const owner = HostTenure.take(root)!;
  owner.brokerReady();
  let acquired: FencedEngine | undefined;
  let client: PiRpcClient | undefined;
  const problem = new Error("setup after acquisition failed");
  t.mock.method(PiRpcClient.prototype, "onEvent", function (this: PiRpcClient) {
    client = this;
    assert.equal(owner.canStartEngine, false, "child acquisition must precede fallible session wiring");
    throw problem;
  });
  try {
    assert.throws(() => scripted(t, engine => { acquired = engine; owner.adopt(engine); }), error => error === problem);
    assert.ok(acquired); assert.ok(client);
    assert.equal(client.child.killed, true);
    assert.equal(owner.canStartEngine, false, "a kill request is not actual death");
    await Promise.resolve();
    assert.equal(client.child.exitCode, null);
    assert.equal(client.child.signalCode, null);
    assert.equal(owner.canStartEngine, false, "settling a stop request cannot resolve the exit observation");
    owner.brokerLost(); owner.brokerReady();
    assert.equal(owner.canStartEngine, false, "a broker restart must not release a failed engine");
    await acquired.exited;
    assert.equal(owner.canStartEngine, true);
    t.mock.restoreAll();
    const next = scripted(t, engine => owner.adopt(engine));
    await next.close();
  } finally { client?.close(); await owner.end(); rmSync(root, { recursive: true, force: true }); }
});


test("DR27/P0-4: rejected child acquisition still returns the child before any RPC wiring", { timeout: 5000 }, async t => {
  const problem = new Error("host refused acquired engine");
  let acquired: FencedEngine | undefined;
  let rpcWiring = 0;
  t.mock.method(PiRpcClient.prototype, "onEvent", () => { rpcWiring++; throw new Error("unexpected RPC setup"); });
  try {
    assert.throws(() => scripted(t, engine => { acquired = engine; throw problem; }), error => error === problem);
    assert.ok(acquired);
    assert.equal(rpcWiring, 0);
    await acquired.exited;
  } finally { acquired?.close(); await acquired?.exited; }
});
