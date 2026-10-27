/** DR27/RUN-003: local fake provider; real confined engine, CLI, broker and runner. */
import test from "node:test";
import { RESIDENT_TEST_OPTIONS } from "./fixtures/resident.js";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withScenario } from "./fixtures/scenario.js";
import { call, text, tools, toolResults } from "./fixtures/scripted-provider.js";
import type { AuthContext } from "@oma/contracts";
import { runnerReceiptPathAt, runnerSessionDirPathAt, workspacePathAt } from "@oma/domain/paths";

for (const ack of [false, true]) test(`DR27: wait persists tools, not delivery; explicit ACK=${ack}`, RESIDENT_TEST_OPTIONS, async () => {
  await withScenario({ residents: ["worker-a"], confined: true }, async s => {
    s.script([tools(call("oma_mail_send", { to: ["worker-a"], subject: "Work", body: "Do one step and yield." })), text("Sent.")]);
    await s.prompt("Send work.");
    const peer = { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() };
    for (const [actor, role, channel, code] of [["principal", "principal", "principal-extension", "CAPABILITY_DENIED"],
      ["worker-a", "resident", "actor", "STALE_RUN"]] as const) {
      const auth: AuthContext = { actor, role, channel, incarnation: s.store.getAgent(actor)!.incarnation, capabilities: new Set(), peer };
      const refused = await s.broker.dispatch(auth, { v: 1, id: "wait-without-run", method: "agent.wait", params: {} }, null);
      assert.equal((refused as { error: { code: string } }).error.code, code);
    }
    const pending = s.store.pendingDeliveries("worker-a");
    assert.equal(pending.length, 1);
    const before = s.provider.seen.length;
    const command = `${ack ? `oma ack ${pending[0]!.messageId} --request explicit-ack && ` : ""}oma agent wait && sleep 0.2 && printf persisted-after-wait > after-wait.txt && printf tool-finished`;
    s.script([tools(call("bash", { command })), text("Must not call the provider again.")]);
    const result = await s.activate("worker-a");
    assert.equal(result.code, 0, result.stderr);
    assert.equal(s.provider.seen.length, before + 1, "no next inference after the wait boundary");
    assert.equal(readFileSync(join(workspacePathAt(s.root, "worker-a"), "after-wait.txt"), "utf8"), "persisted-after-wait");
    const batches = s.store.preparedBatches("worker-a");
    assert.equal(batches.length, 1, "wait cannot complete a prepared batch");
    assert.equal(existsSync(runnerReceiptPathAt(s.root, "worker-a", batches[0]!.id)), false);
    const delivery = s.store.getDelivery(pending[0]!.messageId, "worker-a")!;
    assert.equal(delivery.presented, 0, "wait does not present the prepared mail");
    assert.equal(delivery.acknowledged, ack ? 1 : 0);
    assert.equal(delivery.batchId, batches[0]!.id);
    assert.equal(delivery.materialized, 1);
    assert.equal(s.store.getAgent("worker-a")!.desired, "enabled");
    assert.deepEqual(s.operations("worker-a").map(row => row.kind), ack ? ["mail.ack"] : []);
    const sessions = runnerSessionDirPathAt(s.root, "worker-a");
    // <sessions>/hashline/ holds the bundled extension's anchor sidecars,
    // not the engine's session journal.
    const files = readdirSync(sessions, { recursive: true }).map(String)
      .filter(name => name.endsWith(".jsonl") && !name.startsWith("hashline/"));
    assert.equal(files.length, 1);
    const history = readFileSync(join(sessions, files[0]!), "utf8");
    const entries = history.trim().split("\n").map(line => JSON.parse(line));
    const output = entries.find(entry => entry.type === "message" && entry.message?.role === "toolResult");
    assert.ok(output, "tool result persisted before graceful yield");
    assert.match(JSON.stringify(output), /tool-finished/);
    assert.equal(entries.some(entry => entry.customType === "oma-delivery-boundary"), false);
    const incarnation = s.store.getAgent("worker-a")!.incarnation;
    await s.restartBroker();
    s.script([tools(call("bash", { command: "oma agent wait --observe true" })), text("Resumed without an inherited wait request.")]);
    const resumed = await s.activate("worker-a");
    assert.equal(resumed.code, 0, resumed.stderr);
    assert.ok(s.store.getAgent("worker-a")!.incarnation > incarnation);
    assert.match(toolResults(s.provider.seen.at(-1)!.body).at(-1)!.text, /"accepted":false/);
    assert.equal(s.store.preparedBatches("worker-a").length, 0);
    assert.equal(s.store.pendingDeliveries("worker-a").length, 0);
  });
});

for (const outcome of ["continue", "wait", "unobserved"] as const)
  test(`DR27: delayed wait observation ${outcome} preserves the persisted tool boundary`, RESIDENT_TEST_OPTIONS, async t => {
    await withScenario({ residents: ["worker-a"], confined: true }, async s => {
      s.script([tools(call("oma_mail_send", { to: ["worker-a"], subject: "One step", body: "Perform the requested step." })), text("Sent.")]);
      await s.prompt("Send work.");
      // Scale only the runner's control-idle budget; the real broker can answer
      // after it. Authentication and CLI framing still use the production path.
      // The budget must also clear the confined engine's startup, which BL4's
      // vendored-bundle verification and evaluation made slower than 2s.
      const config = JSON.parse(readFileSync(s.configPath, "utf8"));
      config.limits.idleStreamSeconds = 6;
      writeFileSync(s.configPath, JSON.stringify(config));
      const original = s.broker.dispatch.bind(s.broker);
      let observed = 0;
      t.mock.method(s.broker, "dispatch", async (...args: Parameters<typeof original>) => {
        const request = args[1];
        if (request.method === "agent.wait" && request.params.observe === true) {
          observed++;
          await new Promise(resolve => setTimeout(resolve, 10000));
          if (outcome === "unobserved") return { v: 1, id: request.id, ok: false,
            error: { code: "BROKER_UNAVAILABLE", message: "fixture wait observation unavailable", retry: "after-repair" } };
        }
        return original(...args);
      });
      const message = s.store.pendingDeliveries("worker-a")[0]!.messageId;
      const before = s.provider.seen.length;
      s.script([tools(call("bash", { command: `${outcome === "wait" ? "oma agent wait && " : ""}printf durable-tool-result` })), text("Continued after observation.")]);
      const started = performance.now();
      const result = await s.activate("worker-a");
      assert.equal(observed, 1);
      assert.ok(performance.now() - started >= 10000, "the query actually outlived the control-idle budget");
      const successful = outcome === "continue";
      assert.equal(result.code, outcome === "unobserved" ? 2 : 0, result.stderr);
      if (outcome === "unobserved") assert.match(result.stderr, /SESSION_BOUNDARY_UNCONFIRMED/);
      assert.equal(s.provider.seen.length, before + (successful ? 2 : 1));
      const delivery = s.store.getDelivery(message, "worker-a")!;
      assert.equal(delivery.presented, successful ? 1 : 0);
      assert.equal(delivery.acknowledged, 0);
      assert.equal(s.store.getAgent("worker-a")!.desired, "enabled");
      assert.deepEqual(s.operations("worker-a"), []);
      const batches = s.store.preparedBatches("worker-a");
      assert.equal(batches.length, successful ? 0 : 1);
      if (!successful) assert.equal(existsSync(runnerReceiptPathAt(s.root, "worker-a", batches[0]!.id)), false);
      const sessions = runnerSessionDirPathAt(s.root, "worker-a");
      const file = readdirSync(sessions, { recursive: true }).map(String)
        .find(name => name.endsWith(".jsonl") && !name.startsWith("hashline/"))!;
      const entries = readFileSync(join(sessions, file), "utf8").trim().split("\n").map(line => JSON.parse(line));
      assert.ok(entries.some(entry => entry.message?.role === "toolResult" && JSON.stringify(entry).includes("durable-tool-result")));
      assert.equal(entries.some(entry => entry.customType === "oma-delivery-boundary"), successful);
    });
  });
