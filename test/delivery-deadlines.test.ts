// V10A (WP10, D06): the Resident adapter's acceptance, idle, turn and drain
// budgets are separate. A long turn that keeps producing events is not idle.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiAdapter } from "../src/runtime/pi-adapter.js";
import { alarm } from "../src/runtime/pi-rpc.js";
import { PI_ADAPTER_REVISION, PI_BOUNDARY_PREFIX } from "../src/storage/delivery-receipt.js";

type Pacing = "steady" | "silent-after-accept" | "never-accepts" | "silent-tool" | "unfinished-tool";

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
    if (${JSON.stringify(pacing)} === "silent-tool" || ${JSON.stringify(pacing)} === "unfinished-tool") {
      // A command that prints nothing, e.g. \`sleep\`: the engine says it started
      // the tool and is silent until the tool ends.
      out({ type: "tool_execution_start", toolCallId: "call_1", toolName: "bash", args: { command: "sleep" } });
      if (${JSON.stringify(pacing)} === "unfinished-tool") continue;
      setTimeout(() => { out({ type: "tool_execution_end", toolCallId: "call_1", toolName: "bash", result: { content: [] }, isError: false }); finish(); }, ${forMs});
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
process.on("SIGTERM", () => process.exit(0));
setInterval(() => {}, 1000);
`);
  chmodSync(command, 0o700);
  return command;
}

async function deliverWith(pacing: Pacing, everyMs: number, forMs: number, budgets: { idle: number; turn: number; accept: number }) {
  const root = mkdtempSync(join(tmpdir(), "oma-v10a-"));
  try {
    const dirs = Object.fromEntries(["workspace", "sessions", "home", "archive", "view"].map(name => {
      const path = join(root, name); mkdirSync(path, { recursive: true }); return [name, path];
    })) as Record<string, string>;
    const core = join(root, "extension.js"); const cli = join(root, "cli.js");
    writeFileSync(core, "export default function() {}\n"); writeFileSync(cli, "\n");
    const adapter = new PiAdapter({ actor: "alice", society: "demo",
      profile: { provider: "pi", model: "current", turnSeconds: budgets.turn, prompt: "", extensions: [], workspaceBytes: 1024 * 1024 },
      limits: { frameBytes: 65536, idleStreamSeconds: budgets.idle, receiptWaitSeconds: budgets.accept, batchMaxMessages: 24, mailBodyBytes: 1024 * 1024 },
      paths: { piCommand: fakePi(root, pacing, everyMs, forMs), coreExtension: core, cli, workspace: dirs.workspace!, sessionDir: dirs.sessions!,
        agentHome: dirs.home!, mailArchive: dirs.archive!, batchView: dirs.view!, socket: join(root, "control.sock") } });
    const batch = { id: "b-00000000-0000-4000-8000-0000000000b1", agent: "alice", incarnation: 1,
      messageIds: ["m-00000000-0000-4000-8000-000000000001-0"], sessionPath: null, deliveryMode: "followUp" as const,
      notice: "mail", indexPath: "/inbox.md" as const };
    const started = Date.now();
    try { return { outcome: await adapter.deliver(batch), error: null, ms: Date.now() - started }; }
    catch (error) { return { outcome: null, error: error as Error & { code?: string }, ms: Date.now() - started }; }
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("V10A: a turn that keeps making progress past the idle budget still settles", { timeout: 20_000 }, async () => {
  const result = await deliverWith("steady", 200, 2_500, { idle: 1, turn: 10, accept: 2 });
  assert.equal(result.error, null, String(result.error));
  assert.ok(result.ms >= 2_400, "the turn was not actually longer than the idle budget");
  assert.equal(result.outcome!.entryId, "0123abcd");
});

test("V10A: a genuinely silent engine ends the delivery at the idle budget, as idle", { timeout: 20_000 }, async () => {
  const result = await deliverWith("silent-after-accept", 200, 0, { idle: 1, turn: 10, accept: 2 });
  assert.equal(result.error?.code, "DEADLINE_EXCEEDED");
  assert.match(result.error!.message, /idle stream budget/);
  assert.ok(result.ms < 5_000, `idle took ${result.ms} ms`);
});

test("V10A: a turn that keeps making progress past its own budget ends as a turn deadline", { timeout: 20_000 }, async () => {
  const result = await deliverWith("steady", 200, 10_000, { idle: 1, turn: 2, accept: 2 });
  assert.equal(result.error?.code, "DEADLINE_EXCEEDED");
  assert.match(result.error!.message, /inference timeout/);
  assert.ok(result.ms >= 1_900 && result.ms < 6_000, `turn deadline at ${result.ms} ms`);
});

/** AV24 -- WP10, CFG-004: the seventh functional run. A Resident ran a test
 * script and then \`sleep 31\` in one bash call; the command printed nothing
 * for 30 s, the adapter read the engine as idle, and the run ended
 * DEADLINE_EXCEEDED in the middle of the tool. Builds, installs and test
 * suites are that shape. A tool the engine announced is progress. */
test("AV24 / WP10: a silent tool the engine announced runs past the idle budget and the turn settles", { timeout: 20_000 }, async () => {
  const result = await deliverWith("silent-tool", 200, 2_500, { idle: 1, turn: 10, accept: 2 });
  assert.equal(result.error, null, String(result.error));
  assert.ok(result.ms >= 2_400, "the tool was not actually longer than the idle budget");
  assert.equal(result.outcome!.entryId, "0123abcd");
});

test("AV24 / WP10: a tool that never ends is bounded by the turn, not waited on", { timeout: 20_000 }, async () => {
  const result = await deliverWith("unfinished-tool", 200, 0, { idle: 1, turn: 2, accept: 2 });
  assert.equal(result.error?.code, "DEADLINE_EXCEEDED");
  assert.match(result.error!.message, /inference timeout/);
  assert.ok(result.ms >= 1_900 && result.ms < 6_000, `turn deadline at ${result.ms} ms`);
});

test("V10A: an unanswered command ends at the acceptance budget, and says so", { timeout: 20_000 }, async () => {
  const result = await deliverWith("never-accepts", 200, 0, { idle: 10, turn: 10, accept: 1 });
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

test("V10C: every delivery outcome leaves no timer behind", { timeout: 30_000 }, async () => {
  const timers = () => process.getActiveResourcesInfo().filter(kind => kind === "Timeout").length;
  await new Promise(resolve => setTimeout(resolve, 20));
  const before = timers();
  for (const [pacing, forMs, budgets] of [
    ["steady", 300, { idle: 2, turn: 10, accept: 2 }],
    ["silent-after-accept", 0, { idle: 1, turn: 10, accept: 2 }],
    ["never-accepts", 0, { idle: 10, turn: 10, accept: 1 }],
  ] as const) await deliverWith(pacing, 100, forMs, budgets);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(timers(), before, "a deadline outlived its delivery");
});
