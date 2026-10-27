import { residentEngineEffects } from "#oma-test/app/engine/resident-effects";
// DR27 (WP10, D06): acceptance, control silence, model silence and drain
// are separate. A delivery has no sum-of-requests wall-clock limit.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiAdapter } from "@oma/engine/pi-adapter";
import { residentOptions, prepareResident, RESIDENT_TEST_OPTIONS } from "./fixtures/resident.js";
import { errorCodeOf, primaryFailure } from "@oma/domain/errors";
import { alarm, PiRpcClient } from "@oma/engine/pi-rpc";
import { PI_ADAPTER_REVISION, PI_BOUNDARY_PREFIX } from "@oma/protocol/delivery-boundary";

type Pacing = "malformed" | "premature-eof" | "wait-observation" | "wait-observation-error" | "wait-observation-end-stall" | "wait-observation-stale" | "eof-before-close" | "steady" | "silent-after-accept" | "never-accepts" | "silent-tool" | "unfinished-tool" | "retry-wait" | "stuck-retry" | "silent-inference" | "stuck-inference" | "compaction" | "stuck-compaction" | "compaction-end-stall" | "post-tool-stall" | "compaction-error" | "many-requests";

/** A fake Pi: after accepting, emits one progress event every `everyMs` for
 * `forMs`, then the boundary and the settle -- or goes silent, or never
 * answers the command at all. */
function fakePi(root: string, pacing: Pacing, everyMs: number, forMs: number): string {
  const command = join(root, "fake-pi");
  writeFileSync(command, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const sessionDir = args[args.indexOf("--session-dir") + 1]; mkdirSync(sessionDir, { recursive: true });
const sessionPath = join(sessionDir, "owned.jsonl"); writeFileSync(sessionPath, '{"type":"session","version":3}\\n');
const out = value => process.stdout.write(JSON.stringify(value) + "\\n");
process.stdin.setEncoding("utf8"); let pending = "";
process.stdin.on("data", chunk => { pending += chunk; const lines = pending.split("\\n"); pending = lines.pop();
  for (const line of lines) { if (!line) continue; const request = JSON.parse(line);
    if (${JSON.stringify(pacing)} === "never-accepts") continue;
    out({ type: "response", id: request.id, command: "prompt", success: true });
    if (${JSON.stringify(pacing)} === "silent-after-accept") continue;
    const finish = () => {
      out({ type: "message_end", message: { role: "assistant", stopReason: "stop" } });
      const batchId = request.message.split(" ").at(-1);
      const evidence = { adapterRevision: ${JSON.stringify(PI_ADAPTER_REVISION)}, batchId, incarnation: 1, sessionPath, entryId: "0123abcd" };
      out({ type: "extension_ui_request", id: "notice", method: "notify", message: ${JSON.stringify(PI_BOUNDARY_PREFIX)} + JSON.stringify(evidence) });
      out({ type: "agent_settled" });
    };
    const pacing = ${JSON.stringify(pacing)};
    if (pacing === "malformed") { process.stdout.write("{broken\\n"); continue; }
    if (pacing === "premature-eof") { process.stdout.end(); continue; }
    if (pacing.startsWith("wait-observation")) {
      const observation = phase => out({ type: "extension_ui_request", method: "notify", message: "OMA_PI_WAIT_OBSERVATION_V1 " + JSON.stringify({
        adapterRevision: ${JSON.stringify(PI_ADAPTER_REVISION)}, batchId: request.id,
        incarnation: pacing === "wait-observation-stale" ? 0 : 1, phase }) });
      observation("begin");
      if (pacing === "wait-observation-stale") setTimeout(() => { observation("end"); finish(); }, 1500);
      else setTimeout(() => {
        observation(pacing === "wait-observation-error" ? "failed" : "end");
        if (pacing === "wait-observation-error") out({ type: "agent_settled" });
        else if (pacing !== "wait-observation-end-stall") finish();
      }, ${forMs});
      continue;
    }
    if (["silent-inference", "stuck-inference"].includes(pacing)) {
      // Pi emits turn_start before any provider response, even message_start.
      out({ type: "turn_start" });
      if (pacing === "silent-inference") setTimeout(finish, ${forMs});
      continue;
    }
    if (["compaction", "stuck-compaction", "compaction-end-stall", "compaction-error"].includes(pacing)) {
      out({ type: "message_end", message: { role: "assistant", stopReason: "stop" } });
      out({ type: "compaction_start", reason: "threshold" });
      if (pacing !== "stuck-compaction") setTimeout(() => {
        out({ type: "compaction_end", reason: "threshold", aborted: pacing === "compaction-error" });
        if (pacing !== "compaction-end-stall") finish();
      }, ${forMs});
      continue;
    }
    if (pacing === "many-requests") {
      let requests = 0;
      const request = () => {
        out({ type: "turn_start" });
        setTimeout(() => {
          out({ type: "message_end", message: { role: "assistant", stopReason: "toolUse" } });
          out({ type: "turn_end" });
          if (++requests === 4) finish(); else request();
        }, ${forMs});
      };
      request(); continue;
    }
    if (${JSON.stringify(pacing)} === "retry-wait" || ${JSON.stringify(pacing)} === "stuck-retry") {
      out({ type: "auto_retry_start", attempt: 1, maxAttempts: 5, delayMs: ${forMs} });
      if (${JSON.stringify(pacing)} === "retry-wait") setTimeout(finish, ${forMs});
      continue;
    }
    if (${JSON.stringify(pacing)} === "silent-tool" || ${JSON.stringify(pacing)} === "unfinished-tool" || ${JSON.stringify(pacing)} === "post-tool-stall") {
      // A command that prints nothing, e.g. \`sleep\`: the engine says it started
      // the tool and is silent until the tool ends.
      out({ type: "tool_execution_start", toolCallId: "call_1", toolName: "bash", args: { command: "sleep" } });
      if (${JSON.stringify(pacing)} === "unfinished-tool") { setTimeout(() => process.exit(1), ${forMs}); continue; }
      setTimeout(() => { out({ type: "tool_execution_end", toolCallId: "call_1", toolName: "bash", result: { content: [] }, isError: false }); if (pacing !== "post-tool-stall") finish(); }, ${forMs});
      continue;
    }
    const started = Date.now();
    const progress = setInterval(() => {
      out({ type: "message_update", message: { role: "assistant" } });
      if (Date.now() - started < ${forMs}) return;
      clearInterval(progress);
      out({ type: "message_end", message: { role: "assistant", stopReason: "stop" } });
      const batchId = request.message.split(" ").at(-1);
      const evidence = { adapterRevision: ${JSON.stringify(PI_ADAPTER_REVISION)}, batchId, incarnation: 1, sessionPath, entryId: "0123abcd" };
      out({ type: "extension_ui_request", id: "notice", method: "notify", message: ${JSON.stringify(PI_BOUNDARY_PREFIX)} + JSON.stringify(evidence) });
      out({ type: "agent_settled" });
    }, ${everyMs});
  }
});
process.on("SIGTERM", () => ${JSON.stringify(pacing)} === "eof-before-close" ? process.stdout.end() : process.exit(0));
setInterval(() => {}, 1000);
`);
  chmodSync(command, 0o700);
  return command;
}

async function deliverWith(pacing: Pacing, everyMs: number, forMs: number, budgets: { idle: number; model: number; accept: number }) {
  const root = mkdtempSync(join(tmpdir(), "oma-v10a-"));
  try {
    const options = residentOptions(root, root, fakePi(root, pacing, everyMs, forMs));
    prepareResident(options);
    writeFileSync(options.paths.coreExtension, "export default function() {}\n"); writeFileSync(options.paths.cli, "\n");
    const adapter = new PiAdapter(residentEngineEffects, { ...options,
      profile: { ...options.profile, inferenceSeconds: budgets.model },
      limits: { ...options.limits, idleStreamSeconds: budgets.idle, receiptWaitSeconds: budgets.accept } });
    const batch = { id: "b-00000000-0000-4000-8000-0000000000b1", agent: "alice", incarnation: 1,
      messageIds: ["m-00000000-0000-4000-8000-000000000001-0"], sessionPath: null, deliveryMode: "followUp" as const,
      notice: "mail", indexPath: "/inbox.md" as const };
    const started = Date.now();
    try { return { outcome: await adapter.deliver(batch), error: null, ms: Date.now() - started }; }
    catch (error) { return { outcome: null, error: error as Error & { code?: string }, ms: Date.now() - started }; }
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("V10A: a turn that keeps making progress past the idle budget still settles", { ...RESIDENT_TEST_OPTIONS, timeout: 20_000 }, async () => {
  const result = await deliverWith("steady", 200, 2_500, { idle: 1, model: 10, accept: 2 });
  assert.equal(result.error, null, String(result.error));
  assert.ok(result.ms >= 2_400, "the turn was not actually longer than the idle budget");
  assert.equal(result.outcome!.entryId, "0123abcd");
});

test("V10A: a genuinely silent engine ends the delivery at the idle budget, as idle", { ...RESIDENT_TEST_OPTIONS, timeout: 20_000 }, async () => {
  const result = await deliverWith("silent-after-accept", 200, 0, { idle: 1, model: 10, accept: 2 });
  assert.equal(result.error?.code, "DEADLINE_EXCEEDED");
  assert.match(result.error!.message, /idle stream budget/);
  assert.ok(result.ms < 5_000, `idle took ${result.ms} ms`);
});

test("DR27 / WP10: model progress and repeated requests are not limited by total delivery time", { ...RESIDENT_TEST_OPTIONS, timeout: 20_000 }, async () => {
  for (const [pacing, duration] of [["steady", 2500], ["many-requests", 650]] as const) {
    const result = await deliverWith(pacing, 200, duration, { idle: 1, model: 2, accept: 2 });
    assert.equal(result.error, null, String(result.error));
    assert.ok(result.ms >= 2400, "delivery must outlive one model silence budget");
    assert.equal(result.outcome!.entryId, "0123abcd");
  }
});

test("DR27 / WP10: silent reasoning before the first token and post-response compaction are not RPC idleness", { ...RESIDENT_TEST_OPTIONS, timeout: 20_000 }, async () => {
  for (const pacing of ["silent-inference", "compaction", "compaction-error"] as const) {
    const result = await deliverWith(pacing, 0, 1500, { idle: 1, model: 3, accept: 2 });
    assert.equal(result.error, null, `${pacing}: ${result.error}`);
    assert.ok(result.ms >= 1400);
    assert.equal(result.outcome!.entryId, "0123abcd");
  }
});

test("DR27 / WP10: an unresponsive inference or compaction is bounded without inventing a receipt", { ...RESIDENT_TEST_OPTIONS, timeout: 20_000 }, async () => {
  for (const pacing of ["stuck-inference", "stuck-compaction"] as const) {
    const result = await deliverWith(pacing, 0, 0, { idle: 1, model: 2, accept: 2 });
    assert.equal(result.error?.code, "DEADLINE_EXCEEDED");
    assert.match(result.error!.message, /model silence budget/);
    assert.equal(result.outcome, null);
    assert.ok(result.ms >= 1900 && result.ms < 6000);
  }
});

test("DR27 / WP10: finishing a compaction or tool restores the control-event budget", { ...RESIDENT_TEST_OPTIONS, timeout: 20_000 }, async () => {
  for (const pacing of ["compaction-end-stall", "post-tool-stall"] as const) {
    const result = await deliverWith(pacing, 0, 1200, { idle: 1, model: 10, accept: 2 });
    assert.equal(result.error?.code, "DEADLINE_EXCEEDED");
    assert.match(result.error!.message, /idle stream budget/);
    assert.ok(result.ms >= 2100 && result.ms < 6000);
  }
});

/** AV24 -- WP10, CFG-004: the seventh functional run. A Resident ran a test
 * script and then \`sleep 31\` in one bash call; the command printed nothing
 * for 30 s, the adapter read the engine as idle, and the run ended
 * DEADLINE_EXCEEDED in the middle of the tool. Builds, installs and test
 * suites are that shape. A tool the engine announced is progress. */
test("AV24 / WP10: a silent tool the engine announced runs past the idle budget and the turn settles", { ...RESIDENT_TEST_OPTIONS, timeout: 20_000 }, async () => {
  const result = await deliverWith("silent-tool", 200, 2_500, { idle: 1, model: 10, accept: 2 });
  assert.equal(result.error, null, String(result.error));
  assert.ok(result.ms >= 2_400, "the tool was not actually longer than the idle budget");
  assert.equal(result.outcome!.entryId, "0123abcd");
});

test("DR27 / WP10: a tool owns its runtime, but engine loss still leaves an unconfirmed boundary", { ...RESIDENT_TEST_OPTIONS, timeout: 20_000 }, async () => {
  const result = await deliverWith("unfinished-tool", 200, 2500, { idle: 1, model: 2, accept: 2 });
  assert.equal(result.error?.code, "SESSION_BOUNDARY_UNCONFIRMED");
  assert.ok(result.ms >= 2400);
  assert.equal(result.outcome, null);
});

test("INF-001 / WP10: announced retry backoff is not idle; a missing retry still times out", { ...RESIDENT_TEST_OPTIONS, timeout: 20_000 }, async () => {
  const finished = await deliverWith("retry-wait", 0, 1500, { idle: 1, model: 10, accept: 2 });
  assert.equal(finished.error, null);
  const stuck = await deliverWith("stuck-retry", 0, 1500, { idle: 1, model: 10, accept: 2 });
  assert.equal(stuck.error?.code, "DEADLINE_EXCEEDED"); assert.match(stuck.error!.message, /idle stream budget/);
  const retried = await deliverWith("retry-wait", 0, 2500, { idle: 1, model: 2, accept: 2 });
  assert.equal(retried.error, null, "announced backoff is not model silence");
});

test("V10A: an unanswered command ends at the acceptance budget, and says so", { ...RESIDENT_TEST_OPTIONS, timeout: 20_000 }, async () => {
  const result = await deliverWith("never-accepts", 200, 0, { idle: 10, model: 10, accept: 1 });
  assert.equal(result.error?.code, "SESSION_BOUNDARY_UNCONFIRMED");
  assert.match(result.error!.message, /accept the delivery command/);
});

test("V10C: a budget longer than the native timer limit does not fire early, and cancel is final", async () => {
  let fired = 0;
  const warnings: string[] = [];
  const onWarning = (warning: Error) => { warnings.push(warning.name); };
  process.on("warning", onWarning);
  const longest = alarm(40 * 24 * 3600, () => { fired += 1; });   // 40 days, past 2^31-1 ms
  await new Promise(resolve => setTimeout(resolve, 50));
  process.off("warning", onWarning);
  assert.equal(fired, 0, "a 40-day budget expired at once");
  // Armed in native-sized steps: no overflowing native timer, which Node would
  // fire after 1 ms and turn into a busy re-arm loop.
  assert.deepEqual(warnings.filter(name => name === "TimeoutOverflowWarning"), []);
  longest.cancel();
  const short = alarm(0.02, () => { fired += 1; });
  short.cancel();
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(fired, 0, "a cancelled alarm fired");
});

test("V10C: every delivery outcome leaves no timer behind", { ...RESIDENT_TEST_OPTIONS, timeout: 30_000 }, async () => {
  const timers = () => process.getActiveResourcesInfo().filter(kind => kind === "Timeout").length;
  await new Promise(resolve => setTimeout(resolve, 20));
  const before = timers();
  for (const [pacing, forMs, budgets] of [
    ["steady", 300, { idle: 2, model: 10, accept: 2 }],
    ["silent-after-accept", 0, { idle: 1, model: 10, accept: 2 }],
    ["never-accepts", 0, { idle: 10, model: 10, accept: 1 }],
    ["malformed", 0, { idle: 10, model: 10, accept: 2 }],
    ["premature-eof", 0, { idle: 10, model: 10, accept: 2 }],
    ["eof-before-close", 100, { idle: 10, model: 10, accept: 2 }],
  ] as const) await deliverWith(pacing, 100, forMs, budgets);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(timers(), before, "a deadline outlived its delivery");
});

test("DR27: wait observation has its own budget and restores control idleness afterwards", { ...RESIDENT_TEST_OPTIONS, timeout: 20_000 }, async () => {
  const budgets = { idle: 1, model: 3, accept: 2 };
  const good = await deliverWith("wait-observation", 0, 1500, budgets);
  assert.equal(good.error, null);
  assert.ok(good.outcome);
  const failed = await deliverWith("wait-observation-error", 0, 1500, budgets);
  assert.equal(failed.error?.code, "SESSION_BOUNDARY_UNCONFIRMED");
  assert.match(failed.error!.message, /could not observe/);
  assert.equal(failed.outcome, null);
  const stalled = await deliverWith("wait-observation-end-stall", 0, 1500, budgets);
  assert.equal(stalled.error?.code, "DEADLINE_EXCEEDED");
  assert.match(stalled.error!.message, /idle stream budget/);
  assert.ok(stalled.ms >= 2400 && stalled.ms < 6000);
  const stale = await deliverWith("wait-observation-stale", 0, 0, budgets);
  assert.equal(stale.error?.code, "DEADLINE_EXCEEDED");
  assert.ok(stale.ms < 4000, "a stale incarnation cannot suspend the idle deadline");
});

test("DR27 / P0-4: EOF is not child death; adapter success waits for actual close", { ...RESIDENT_TEST_OPTIONS, timeout: 20_000 }, async t => {
  let closed = false;
  const original = PiRpcClient.prototype.onEvent;
  t.mock.method(PiRpcClient.prototype, "onEvent", function (this: PiRpcClient, ...args: Parameters<typeof original>) {
    this.child.once("close", () => { closed = true; });
    return original.apply(this, args);
  });
  const result = await deliverWith("eof-before-close", 50, 100, { idle: 2, model: 3, accept: 2 });
  assert.equal(result.error, null);
  assert.ok(result.outcome);
  assert.equal(closed, true, "an ended stream cannot release the live child owner");
});

for (const pacing of ["silent-after-accept", "never-accepts", "wait-observation-error", "malformed", "premature-eof"] as const) {
  test(`DR27/P0-4: ${pacing} failure keeps the child until actual close`, { ...RESIDENT_TEST_OPTIONS, timeout: 15_000 }, async t => {
    let closed = false;
    const original = PiRpcClient.prototype.onEvent;
    t.mock.method(PiRpcClient.prototype, "onEvent", function (this: PiRpcClient, ...args: Parameters<typeof original>) {
      this.child.once("close", () => { closed = true; });
      return original.apply(this, args);
    });
    const result = await deliverWith(pacing, 0, 100, { idle: 2, model: 3, accept: 1 });
    assert.ok(result.error, "failure cannot become a boundary");
    assert.equal(result.outcome, null);
    assert.equal(closed, true, "a rejected delivery still owns its child until OS close");
    if (pacing === "silent-after-accept") assert.equal(result.error.code, "DEADLINE_EXCEEDED");
    if (pacing === "never-accepts" || pacing === "wait-observation-error" || pacing === "premature-eof")
      assert.equal(result.error.code, "SESSION_BOUNDARY_UNCONFIRMED");
  });
}

for (const pacing of ["silent-after-accept", "never-accepts", "eof-before-close"] as const) {
  test(`DR27/P0-5: lost ${pacing} close observation is bounded and preserves the original failure`, { ...RESIDENT_TEST_OPTIONS, timeout: 15_000 }, async t => {
    let actualClose = false;
    let lateClose: ReturnType<typeof setTimeout> | undefined;
    t.after(() => clearTimeout(lateClose));
    let closeListeners = () => -1;
    const original = PiRpcClient.prototype.onEvent;
    t.mock.method(PiRpcClient.prototype, "onEvent", function (this: PiRpcClient, ...args: Parameters<typeof original>) {
      // The child really exits; delay only its notification past both close
      // budgets. A removed deadline eventually fails an assertion, not a hang.
      // No orphan is created to test an unobserved termination.
      closeListeners = () => this.child.listenerCount("close");
      const emit = this.child.emit.bind(this.child);
      t.mock.method(this.child, "emit", (event: string | symbol, ...args: unknown[]) => {
        if (event === "close") {
          actualClose = true;
          lateClose = setTimeout(() => emit(event, ...args), 2500);
          return true;
        }
        return emit(event, ...args);
      });
      return original.apply(this, args);
    });
    const result = await deliverWith(pacing, 50, 100, { idle: 2, model: 3, accept: 1 });
    assert.equal(actualClose, true);
    assert.equal(result.outcome, null);
    assert.ok(result.error instanceof AggregateError);
    assert.equal(errorCodeOf(result.error), pacing === "silent-after-accept" ? "DEADLINE_EXCEEDED" : "SESSION_BOUNDARY_UNCONFIRMED");
    assert.equal(primaryFailure(result.error), result.error.errors[0]);
    assert.match(result.error.errors[0].message, pacing === "silent-after-accept" ? /idle stream budget/ :
      pacing === "never-accepts" ? /accept the delivery command/ : /did not close after its settled boundary/);
    assert.equal(errorCodeOf(result.error.errors[1]), "SESSION_BOUNDARY_UNCONFIRMED");
    assert.match(result.error.errors[1].message, /child termination could not be confirmed/);
    assert.ok(result.ms < 6000, `lost closure waited ${result.ms}ms`);
    assert.equal(closeListeners(), 0, "an expired observation leaves no close listener behind");
  });
}

test("DR27/P0-4: delivery event-registration failure returns timers and observes its child close", { ...RESIDENT_TEST_OPTIONS, timeout: 8000 }, async t => {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const schedule = globalThis.setTimeout, cancel = globalThis.clearTimeout;
  t.mock.method(globalThis, "setTimeout", (action: (...args: unknown[]) => void, ms?: number) => {
    const timer = schedule(action, ms); timers.add(timer); return timer;
  });
  t.mock.method(globalThis, "clearTimeout", (timer: ReturnType<typeof setTimeout>) => { timers.delete(timer); cancel(timer); });
  const problem = new Error("injected event registration failure");
  let client: PiRpcClient | undefined;
  let closed = false;
  t.mock.method(PiRpcClient.prototype, "onEvent", function (this: PiRpcClient) {
    client = this;
    this.child.once("close", () => { closed = true; });
    throw problem;
  });
  t.after(() => client?.close());
  const result = await deliverWith("never-accepts", 0, 0, { idle: 2, model: 3, accept: 2 });
  assert.equal(result.error, problem, "setup must retain its original failure");
  assert.equal(closed, true, "a failed setup must still observe its owned child's close");
  assert.equal(client?.child.stdout?.listenerCount("data"), 0);
  assert.equal(timers.size, 0, "setup timers must not survive their owner");
});
