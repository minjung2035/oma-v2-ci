/** Actual descriptor I/O and crash persistence on each CI OS. The legacy
 * witness below is format data; it grants no live process/recovery authority. */
import test from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ExecutionJournal } from "@oma/storage/execution-journal";

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oma-journal-files-")));
  t.after(() => rmSync(root, { recursive: true })); ExecutionJournal.initialize(root);
  return { root, file: join(root, "execution/scopes.jsonl") };
}
const witness = { kind: "darwin-audit-session", auditSession: 1, coalitionId: "2", pid: 3, pidVersion: 4 };

test("001. Actual journal descriptor appends, reopens and preserves prior frame bytes", t => {
  const f = fixture(t), initial = readFileSync(f.file);
  let journal = ExecutionJournal.open(f.root);
  try {
    const row = journal.reserve("candidate"); row.publish(witness);
    assert.deepEqual(ExecutionJournal.inspect(f.root), [{ slot: "candidate", execution: row.execution, witness }]);
    assert.deepEqual(readFileSync(f.file).subarray(0, initial.length), initial);
  } finally { journal.close(); }
  journal = ExecutionJournal.open(f.root);
  try { const [row] = journal.entries(); journal.retire(row.slot, row.execution); }
  finally { journal.close(); }
  assert.deepEqual(ExecutionJournal.inspect(f.root), []);
});

for (const published of [false, true]) test(`002. SIGKILL preserves ${published ? "published" : "opening-only"} physical observation`, t => {
  const f = fixture(t);
  const source = `import {ExecutionJournal} from '@oma/storage/execution-journal';
    const journal=ExecutionJournal.open(${JSON.stringify(f.root)});
    const row=journal.reserve('candidate');
    ${published ? `row.publish(${JSON.stringify(witness)});` : ""}
    process.kill(process.pid,'SIGKILL');`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], { encoding: "utf8", timeout: 10000 });
  assert.equal(result.signal, "SIGKILL", result.stderr);
  const before = readFileSync(f.file), journal = ExecutionJournal.open(f.root);
  try {
    const rows = journal.entries(); assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].witness, published ? witness : null);
    assert.throws(() => journal.reserve("candidate"), error => error.code === "RUN_TERMINATION_UNKNOWN");
    assert.deepEqual(readFileSync(f.file), before, "reopen never discards an unsettled scope");
  } finally { journal.close(); }
});

test("003. Actual incomplete frame remains corrupt and unmodified", t => {
  const f = fixture(t); appendFileSync(f.file, '{"version":'); const before = readFileSync(f.file);
  for (const read of [ExecutionJournal.open, ExecutionJournal.inspect])
    assert.throws(() => read(f.root), error => error.code === "STORE_CORRUPT");
  assert.deepEqual(readFileSync(f.file), before);
});
