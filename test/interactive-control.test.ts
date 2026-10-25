import { engineStartEffects } from "#oma-test/app/engine/start-effects";
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PrincipalSession } from "@oma/engine/principal-session";
import { tryHoldSociety } from "#oma-test/app/runtime/society-lease";
import { PiRpcClient, type PiEvent } from "@oma/engine/pi-rpc";

for (const mode of ["silent", "before-ready", "ready-twice", "future", "duplicate"]) {
  test(`DR22: UI control ${mode} never creates a second Human run`, { timeout: 8000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-ui-control-"));
    const workspace = join(root, "workspace"), sessions = join(root, "sessions");
    mkdirSync(workspace); mkdirSync(sessions);
    const lease = tryHoldSociety(root); assert.ok(lease);
    const events: PiEvent[] = [];
    let ended = 0;
    const session = PrincipalSession.start(engineStartEffects, { piCommand: process.execPath,
      interactiveEntry: join(process.cwd(), "test/fixtures/interactive-control.mjs"), fence: lease.fence,
      coreExtension: "/nonexistent/core.js", sessionDir: sessions, workspace, home: workspace },
    { society: "demo", provider: "fake", model: "scripted", extensions: [] },
    { frameBytes: 4096, idleStreamSeconds: 1, receiptWaitSeconds: 1 }, { CONTROL_CASE: mode },
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


test("DR27/P0-4: interactive Principal setup failure returns startup and private channel owners", { timeout: 8000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-ui-setup-"));
  const workspace = join(root, "workspace"), sessions = join(root, "sessions");
  mkdirSync(workspace); mkdirSync(sessions);
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
    coreExtension: "/nonexistent/core.js", sessionDir: sessions, workspace, home: workspace },
  { society: "demo", provider: "fake", model: "scripted", extensions: [] },
  { frameBytes: 4096, idleStreamSeconds: 1, receiptWaitSeconds: 5 }, { CONTROL_CASE: "silent" },
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
