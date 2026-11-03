import { principalPaths, principalBounds } from "./fixtures/principal-paths.js";
// #27: real SDK + real trusted adapter + actual Principal session, no provider call.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { PrincipalSession } from "@oma/engine/principal-session";
import { engineStartEffects } from "#oma-test/app/engine/start-effects";
import { PrincipalDelivery } from "#oma-test/app/runtime/principal-delivery";
import { PI_ADAPTER_REVISION, PI_DELIVERY_NOT_STARTED_PREFIX, deliveryNotStartedOf } from "@oma/protocol/delivery-boundary";
import type { PreparedBatch } from "@oma/contracts";
const id = "b-00000000-0000-4000-8000-000000000027";
const notice = (body: unknown) => ({ type: "extension_ui_request", method: "notify", message: PI_DELIVERY_NOT_STARTED_PREFIX + JSON.stringify(body) });
test("001. Never-started observations are closed, correlated adapter messages, not arbitrary notifications", () => {
  const body = { adapterRevision: PI_ADAPTER_REVISION, batchId: id, reason: "invalid-batch" };
  assert.deepEqual(deliveryNotStartedOf(notice(body)), { batchId: id, reason: "invalid-batch" });
  for (const invalid of [null, {}, { ...body, extra: true }, { ...body, adapterRevision: "old" }, { ...body, batchId: "other" }, { ...body, reason: "timeout" }])
    assert.equal(deliveryNotStartedOf(notice(invalid)), null);
  assert.equal(deliveryNotStartedOf({ ...notice(body), type: "message_end" }), null);
});
test("002. SDK accepts an invalid delivery command without a run; trusted preflight refusal releases it without a receipt", { timeout: 20000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-no-run-"));
  for (const name of ["workspace", "sessions", "view", "agent", "agents/principal/workspace", "agents/principal/sessions", "agents/principal/runner/view"]) mkdirSync(join(root, name), { recursive: true });
  for (const path of [principalPaths(root).workspace, principalPaths(root).sessionDir]) mkdirSync(path, { recursive: true });
  const extension = join(root, "delivery.mjs");
  writeFileSync(extension, `import {registerDelivery} from ${JSON.stringify(import.meta.resolve("@oma/extension/delivery"))}; export default registerDelivery;`);
  const events: Record<string, unknown>[] = [];
  const session = PrincipalSession.start(engineStartEffects, {
    piCommand: process.execPath, piArgs: [resolve("node_modules/@earendil-works/pi-coding-agent/dist/cli.js")],
    coreExtension: extension, ...principalPaths(root), home: root, piAgentDir: join(root, "agent"),
  }, { society: "demo", provider: "pi", model: "current", extensions: [] },
  { frameBytes: 1048576, idleStreamSeconds: 30, receiptWaitSeconds: 10 },
  { ...principalBounds, HOME: root, PATH: process.env.PATH ?? "/usr/bin:/bin", OMA_BATCH_VIEW: join(root, "view"), OMA_FRAME_BYTES: "1048576", OMA_BATCH_MAX_MESSAGES: "24" },
  { onLine() {}, onBusy() {}, onEnd() {}, onPromptFailed() {} });
  session.onEvent(event => events.push(event));
  let completed = 0;
  const batch: PreparedBatch = { id, agent: "principal", incarnation: 0, messageIds: [], deliveryMode: "followUp", notice: "mail", sessionPath: null, indexPath: "/inbox.md" };
  try {
    const delivery = new PrincipalDelivery(session, { prepare: async () => batch, complete: async () => { completed++; } },
      { stateRoot: root, frameBytes: 1048576, acceptMs: 10000, retryAfterMs: 0 });
    const outcome = await delivery.tick();
    assert.equal(outcome.kind, "failed");
    if (outcome.kind === "failed") { assert.equal(outcome.phase, "engine"); assert.match(outcome.reason, /did not start/); }
    // The SDK's successful handled response may follow the refusal; it must not reclaim the session.
    const deadline = Date.now() + 5000;
    while (!events.some(event => event.type === "response" && event.id === id) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(events.some(event => event.type === "response" && event.id === id && event.success === true));
    assert.equal(events.some(event => event.type === "agent_start"), false);
    assert.equal(session.running, true); assert.equal(session.busy, false);
    assert.equal(completed, 0);
    assert.equal(existsSync(join(root, "agents/principal/runner/receipts", `batch-${id}.json`)), false);
    assert.equal((await delivery.tick()).kind, "failed", "same prepared batch remains retryable, not completed");
    assert.equal(session.busy, false);
  } finally { session.close(); await session.exited; rmSync(root, { recursive: true, force: true }); }
});
