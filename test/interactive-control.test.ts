import { engineStartEffects } from "#oma-test/app/engine/start-effects";
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PrincipalSession, principalWorkspace, principalSessionDir } from "@oma/engine/principal-session";
import { tryHoldSociety } from "#oma-test/app/runtime/society-lease";
import { PiRpcClient, type PiEvent } from "@oma/engine/pi-rpc";
import { PI_ADAPTER_REVISION } from "@oma/protocol/delivery-boundary";
import { collaborationSurface } from "@oma/domain/collaboration-surface";

const sourceBounds = { OMA_SUBJECT_BYTES: "512", OMA_BODY_BYTES: "4096", OMA_FRAME_BYTES: "4096", OMA_CONTEXT_BYTES: "8388608" };
for (const mode of ["silent", "before-ready", "ready-twice", "future", "duplicate"]) {
  test(`001. UI control ${mode} never creates a second Human run`, { timeout: 8000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-ui-control-"));
    const workspace = principalWorkspace(root), sessions = principalSessionDir(root);
    mkdirSync(workspace, { recursive: true }); mkdirSync(sessions, { recursive: true });
    const lease = tryHoldSociety(root); assert.ok(lease);
    const events: PiEvent[] = [];
    let ended = 0;
    const session = PrincipalSession.start(engineStartEffects, { piCommand: process.execPath,
      interactiveEntry: join(process.cwd(), "test/fixtures/interactive-control.mjs"), fence: lease.fence,
      coreExtension: "/nonexistent/core.js", sessionDir: sessions, workspace, home: workspace,
      collaborationStateRoot: root, toolSurface: JSON.stringify(collaborationSurface("principal")) },
    { society: "demo", provider: "fake", model: "scripted", extensions: [] },
    { frameBytes: 4096, idleStreamSeconds: 1, receiptWaitSeconds: 1 }, { ...sourceBounds, CONTROL_CASE: mode },
    { onLine: () => {}, onBusy: () => {}, onPromptFailed: () => {}, onEnd: () => { ended += 1; } });
    session.onEvent(event => events.push(event));
    try {
      if (mode === "duplicate") {
        const deadline = Date.now() + 3000;
        while (!events.some(event => event.type === "agent_settled") && Date.now() < deadline)
          await new Promise(resolve => setTimeout(resolve, 10));
        await new Promise(resolve => setTimeout(resolve, 100));
        assert.deepEqual(events.filter(event => event.type === "observed_prompt").map(event => event.text), ["once"]);
        assert.equal(session.running, true);
      } else {
        await session.exited;
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(ended, 1);
        assert.equal(events.some(event => event.type === "observed_prompt"), false);
      }
    } finally {
      session.close(); await session.exited; lease.release();
      rmSync(root, { recursive: true, force: true });
    }
  });
}


test("002. Interactive Principal setup failure returns startup and private channel owners", { timeout: 8000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-ui-setup-"));
  const workspace = principalWorkspace(root), sessions = principalSessionDir(root);
  mkdirSync(workspace, { recursive: true }); mkdirSync(sessions, { recursive: true });
  const lease = tryHoldSociety(root); assert.ok(lease);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const schedule = globalThis.setTimeout, cancel = globalThis.clearTimeout;
  t.mock.method(globalThis, "setTimeout", (action: (...args: unknown[]) => void, ms?: number) => {
    const timer = schedule(action, ms); timers.add(timer); return timer;
  });
  t.mock.method(globalThis, "clearTimeout", (timer: ReturnType<typeof setTimeout>) => { timers.delete(timer); cancel(timer); });
  const problem = new Error("injected interactive setup failure");
  let client: PiRpcClient | undefined;
  let closed: Promise<unknown> | undefined;
  let endings = 0;
  t.mock.method(PiRpcClient.prototype, "onEvent", function (this: PiRpcClient) {
    client = this; closed = once(this.child, "close"); throw problem;
  });
  t.after(async () => {
    client?.close(); client?.child.kill("SIGKILL"); await closed;
    lease.release(); rmSync(root, { recursive: true, force: true });
  });
  assert.throws(() => PrincipalSession.start(engineStartEffects, { piCommand: process.execPath,
    interactiveEntry: join(process.cwd(), "test/fixtures/interactive-control.mjs"), fence: lease.fence,
    coreExtension: "/nonexistent/core.js", sessionDir: sessions, workspace, home: workspace,
    collaborationStateRoot: root, toolSurface: JSON.stringify(collaborationSurface("principal")) },
  { society: "demo", provider: "fake", model: "scripted", extensions: [] },
  { frameBytes: 4096, idleStreamSeconds: 1, receiptWaitSeconds: 5 }, { ...sourceBounds, CONTROL_CASE: "silent" },
  { onLine: () => {}, onBusy: () => {}, onPromptFailed: () => {}, onEnd: () => { endings++; } }), error => error === problem);
  assert.ok(client);
  assert.equal(client.child.killed, true);
  for (const stream of client.child.stdio) if (stream) {
    assert.equal(stream.destroyed, true, "all private channels return on failed setup");
    assert.equal(stream.listenerCount("data"), 0);
  }
  await closed;
  assert.equal(timers.size, 0, "startup/exit timers must not survive the failed owner");
  assert.equal(endings, 0, "a failed constructor must not publish normal session completion");
});

// AUD-03: the Principal's interactive spawn is the product path, and its
// fd 5/6 channels are not the RPC spawn the never-started regression already
// covers. These two hold the host's side of it: a preflight refusal returns
// the session's claim, and the Human's waiting prompt is handed to the engine
// rather than stranded in the host's queue.
async function startInteractiveDelivery(mode: string) {
  const root = mkdtempSync(join(tmpdir(), "oma-ui-delivery-"));
  const workspace = principalWorkspace(root), sessions = principalSessionDir(root);
  mkdirSync(workspace, { recursive: true }); mkdirSync(sessions, { recursive: true });
  const lease = tryHoldSociety(root); assert.ok(lease);
  const events: PiEvent[] = [];
  const failed: string[] = [];
  const busyStates: boolean[] = [];
  let endings = 0;
  const session = PrincipalSession.start(engineStartEffects, { piCommand: process.execPath,
    interactiveEntry: join(process.cwd(), "test/fixtures/interactive-control.mjs"), fence: lease.fence,
    coreExtension: "/nonexistent/core.js", sessionDir: sessions, workspace, home: workspace,
    collaborationStateRoot: root, toolSurface: JSON.stringify(collaborationSurface("principal")) },
  { society: "demo", provider: "fake", model: "scripted", extensions: [] },
  { frameBytes: 4096, idleStreamSeconds: 30, receiptWaitSeconds: 30 },
  { ...sourceBounds, CONTROL_CASE: mode, CONTROL_ADAPTER_REVISION: PI_ADAPTER_REVISION },
  { onLine: () => {}, onBusy: value => { busyStates.push(value); }, onPromptFailed: text => { failed.push(text); }, onEnd: () => { endings += 1; } });
  session.onEvent(event => events.push(event));
  const until = async (condition: () => boolean, ms = 5000): Promise<void> => {
    const deadline = Date.now() + ms;
    while (!condition() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(condition(), "the interactive Principal did not reach the expected state");
  };
  const observed = () => events.filter(event => event.type === "observed_prompt").map(event => String(event.text));
  return { session, root, lease, events, failed, busyStates, endings: () => endings, until, observed };
}

test("003. An interactive refusal returns the claim without a run and the next delivery is admitted", { timeout: 15000 }, async () => {
  const { session, root, lease, failed, busyStates, until, observed, endings } = await startInteractiveDelivery("delivery-refusal");
  try {
    await until(() => !session.busy);
    await session.deliver("b-00000000-0000-4000-8000-000000000003");
    // Busy until the engine's own never-started notice crosses the interactive
    // bridge; the claim must be its only consequence.
    await until(() => !session.busy);
    assert.deepEqual(busyStates.slice(0, 3), [false, true, false],
      "the refused claim reports busy once and returns to idle once");
    assert.deepEqual(observed(), [], "a refused delivery must start no run");
    assert.deepEqual(failed, [], "a delivery command is not the Human's text to hand back");
    // No stale claim, no second release: the same session takes the next batch.
    await session.deliver("b-00000000-0000-4000-8000-000000000004");
    await until(() => !session.busy);
    assert.deepEqual(busyStates.slice(0, 5), [false, true, false, true, false],
      "the second refused claim releases the same way, exactly once");
    assert.equal(session.running, true);
    assert.equal(endings(), 0);
  } finally {
    session.close(); await session.exited; lease.release(); rmSync(root, { recursive: true, force: true });
  }
});

test("004. The Human's prompt waiting behind an interactive delivery runs after its refusal", { timeout: 15000 }, async () => {
  const { session, root, lease, failed, busyStates, until, observed } = await startInteractiveDelivery("delivery-queue");
  try {
    await until(() => !session.busy);
    await session.deliver("b-00000000-0000-4000-8000-000000000005");
    // The peer reports the Human's mid-delivery input once the claim is held,
    // and only answers the refusal after the host has replied that the prompt
    // waits -- so the write below is the claim's release handing it the run.
    await until(() => observed().includes("follow-up"));
    assert.deepEqual(busyStates.slice(0, 3), [false, true, true],
      "the release never reports an idle session while the Human's prompt waits");
    assert.deepEqual(failed, [], "the waiting prompt is taken by the released session, not handed back");
    await until(() => !session.busy);
    assert.equal(busyStates.at(-1), false);
    assert.equal(session.running, true);
  } finally {
    session.close(); await session.exited; lease.release(); rmSync(root, { recursive: true, force: true });
  }
});
