/** Actual filesystem/host/boot observations and controlled changed-boot state
 * transitions. Controlled boot values never claim a physical reboot. The
 * product CLI still requires its independently qualified Society lease. */
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionJournal } from "../dist/execution-journal.js";
import { prepareExecutionRecovery, applyExecutionRecovery } from "../dist/execution-recovery.js";
import { currentDarwinBootId, currentDarwinHostId } from "@oma/native/audit-session";
import { linuxBootId, linuxHostId } from "@oma/native/pid-namespace";
import { controlledSource } from "./source-fixture.mjs";

const bytes = Buffer.from([0xff, 0x7b, 0x0a]), opaque = Buffer.from("unrelated opaque state\0\xff");
const version = process.platform === "darwin" ? 2 : 1;
function fixture(t, absent = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oma-native-reboot-")));
  t.after(() => rmSync(root, { recursive: true }));
  ExecutionJournal.initialize(root);
  const journal = join(root, "execution/scopes.jsonl"), ticket = join(root, "execution/recovery.json");
  if (absent) unlinkSync(journal); else { writeFileSync(journal, bytes); chmodSync(journal, 0o400); }
  writeFileSync(join(root, "runtime.sqlite"), opaque);
  return { root, journal, ticket, preserved() { assert.deepEqual(readFileSync(join(root, "runtime.sqlite")), opaque); } };
}
for (const absent of [false, true]) test(`001. Actual host boot refuses same-boot recovery of ${absent ? "missing" : "corrupt read-only"} journal`, t => {
  const f = fixture(t, absent), prepared = prepareExecutionRecovery(f.root);
  assert.equal(prepared.version, version);
  assert.equal(prepared.bootId, process.platform === "darwin" ? currentDarwinBootId() : linuxBootId());
  assert.equal(prepared.hostId, process.platform === "darwin" ? currentDarwinHostId() : linuxHostId());
  const ticket = readFileSync(f.ticket); assert.deepEqual(prepareExecutionRecovery(f.root), prepared);
  assert.throws(() => applyExecutionRecovery(f.root), { code: "RUN_TERMINATION_UNKNOWN" });
  assert.throws(() => ExecutionJournal.open(f.root), { code: "RUN_TERMINATION_UNKNOWN" });
  assert.throws(() => ExecutionJournal.initialize(f.root), { code: "RUN_TERMINATION_UNKNOWN" });
  assert.deepEqual(readFileSync(f.ticket), ticket); f.preserved();
  if (absent) assert.equal(existsSync(f.journal), false);
  else {
    assert.deepEqual(readFileSync(f.journal), bytes);
    assert.deepEqual(readFileSync(join(f.root, "execution", `scopes.before-recovery-${prepared.original.sha256}.jsonl`)), bytes);
  }
});
for (const absent of [false, true]) test(`002. Controlled changed boot resets only ${absent ? "missing" : "corrupt"} observations and preserves the original archive`, t => {
  const f = fixture(t, absent); let boot = "00000000-0000-4000-8000-000000000001";
  const kernel = controlledSource("execution-recovery", {
    "@oma/native/pid-namespace": () => ({ linuxBootId: () => boot }),
    "@oma/native/audit-session": () => ({ currentDarwinBootId: () => boot }),
  });
  const prepared = kernel.prepareExecutionRecovery(f.root); assert.equal(prepared.version, version);
  assert.throws(() => kernel.applyExecutionRecovery(f.root), { code: "RUN_TERMINATION_UNKNOWN" });
  boot = "00000000-0000-4000-8000-000000000002";
  assert.deepEqual(kernel.prepareExecutionRecovery(f.root), prepared, "preparation keeps the original boot proof");
  const result = kernel.applyExecutionRecovery(f.root);
  if (absent) assert.equal(result.archive, null); else assert.deepEqual(readFileSync(result.archive), bytes);
  const journal = ExecutionJournal.open(f.root); try { assert.deepEqual(journal.entries(), []); } finally { journal.close(); }
  assert.equal(existsSync(f.ticket), false); f.preserved();
});
test("003. Another OS ticket version cannot reinterpret host identity or authorize retirement", t => {
  const f = fixture(t), ticket = prepareExecutionRecovery(f.root);
  writeFileSync(f.ticket, JSON.stringify({ ...ticket, version: version === 1 ? 2 : 1 }) + "\n");
  const refused = readFileSync(f.ticket);
  assert.throws(() => applyExecutionRecovery(f.root), { code: "STORE_CORRUPT" });
  assert.throws(() => prepareExecutionRecovery(f.root), { code: "STORE_CORRUPT" });
  assert.deepEqual(readFileSync(f.ticket), refused); assert.deepEqual(readFileSync(f.journal), bytes); f.preserved();
});
test("004. A live actual journal lock blocks reboot preparation before publishing any ticket", t => {
  const f = fixture(t, true); ExecutionJournal.initialize(f.root); const journal = ExecutionJournal.open(f.root);
  try {
    assert.throws(() => prepareExecutionRecovery(f.root), error => error.code === "BROKER_UNAVAILABLE" && error.details?.reason === "busy");
    assert.equal(existsSync(f.ticket), false);
  } finally { journal.close(); }
});
