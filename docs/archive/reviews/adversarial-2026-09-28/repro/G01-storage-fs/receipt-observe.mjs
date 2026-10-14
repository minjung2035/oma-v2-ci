import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  observeDeliveryReceipt, deliveryDecision, PI_ADAPTER_REVISION,
} from "../../../../dist/src/storage/delivery-receipt.js";

const MAX = 64 * 1024;
const actor = "alice";
const batchId = `b-${randomUUID()}`;
const messageId = `m-${randomUUID()}-0`;
const incarnation = 3;

const root = mkdtempSync(join(tmpdir(), "oma-adv-G01-storage-fs-"));
function layout() {
  const agentRoot = join(root, "agents", actor);
  const receiptsDir = join(agentRoot, "runner", "receipts");
  const sessionsDir = join(agentRoot, "runner", "sessions");
  mkdirSync(receiptsDir, { recursive: true });
  mkdirSync(sessionsDir, { recursive: true });
  return { receiptsDir, sessionsDir };
}
const { receiptsDir, sessionsDir } = layout();
const receiptPath = join(receiptsDir, `batch-${batchId}.json`);
const sessionPath = join(sessionsDir, "s.jsonl");
writeFileSync(sessionPath, "some session content\n");

const batch = {
  id: batchId, agent: actor, incarnation, messageIds: [messageId],
  sessionPath, deliveryMode: "steer", notice: "n", indexPath: "/inbox.md",
};

function goodReceipt(inc = incarnation) {
  return {
    schemaVersion: 1, adapterRevision: PI_ADAPTER_REVISION, batchId, actor,
    incarnation: inc, messageIds: [messageId], sessionPath, entryId: "0a1b2c3d",
  };
}

function show(label, attempts) {
  const obs = observeDeliveryReceipt(root, batch, MAX, attempts);
  const dec = deliveryDecision(obs);
  console.log(`${label}: kind=${obs.kind} action=${dec.action}${obs.kind === "unavailable" || obs.kind === "conflicting" ? " problem=" + obs.diagnostic.problem : ""}${obs.kind === "absent" ? " missing=" + obs.missing : ""}`);
}

try {
  // absent receipt
  show("no receipt");

  // valid receipt
  writeFileSync(receiptPath, JSON.stringify(goodReceipt()) + "\n", { mode: 0o600 });
  show("valid");

  // 0-byte receipt (truncated to nothing)
  writeFileSync(receiptPath, "", { mode: 0o600 });
  show("zero-byte");

  // partial/truncated JSON
  writeFileSync(receiptPath, "{\"schemaVersion\":1,\"adap", { mode: 0o600 });
  show("truncated-json");

  // conflicting: different incarnation outside range (default range = [inc,inc])
  writeFileSync(receiptPath, JSON.stringify(goodReceipt(incarnation + 5)) + "\n", { mode: 0o600 });
  show("incarnation-above-range (default attempts)");
  show("incarnation-in-range (attempts first..last)", { first: 0, last: incarnation + 5 });

  // conflicting: wrong messageId
  const wrong = goodReceipt(); wrong.messageIds = [`m-${randomUUID()}-0`];
  writeFileSync(receiptPath, JSON.stringify(wrong) + "\n", { mode: 0o600 });
  show("wrong messageId");

  // wrong mode (not 0o600) -> not-private-regular -> conflicting
  writeFileSync(receiptPath, JSON.stringify(goodReceipt()) + "\n", { mode: 0o644 });
  chmodSync(receiptPath, 0o644);
  show("mode 0644");

  // receipt directory unreadable -> unavailable NOT absent
  chmodSync(receiptsDir, 0o000);
  show("receipts dir sealed (EACCES)");
  chmodSync(receiptsDir, 0o755);
} finally {
  rmSync(root, { recursive: true, force: true });
}
