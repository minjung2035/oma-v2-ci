/** Actual descriptor I/O and crash persistence on each CI OS. The legacy
 * witness below is format data; it grants no live process/recovery authority. */
import test from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ExecutionJournal } from "@oma/storage/execution-journal";
import { DARWIN_EXECUTION_JOURNAL_VERSION } from "@oma/protocol/persisted-formats";
import { canonicalJson, sha256Hex } from "@oma/domain/canonical-json";
import { ExecutionCoordinator, ExecutionNotStarted } from "@oma/process/owned-execution";
import { StoreError } from "@oma/domain/errors";

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

const coalition = { kind: "darwin-resource-coalition", bootId: "00000000-0000-4000-8000-000000000001", coalitionId: "18446744073709551615" };
test("004. Explicit Darwin writer appends v3 while preserving every original v2 byte and hash", t => {
  const f = fixture(t), original = ExecutionJournal.open(f.root);
  try { const old = original.reserve("candidate"); old.publish(witness); old.retire(); } finally { original.close(); }
  const before = readFileSync(f.file), journal = ExecutionJournal.open(f.root, DARWIN_EXECUTION_JOURNAL_VERSION);
  let execution;
  try {
    const row = journal.reserve("candidate"); execution = row.execution; row.publish(coalition);
    assert.throws(() => row.publish({ ...coalition, pid: process.pid }), TypeError);
    assert.deepEqual(readFileSync(f.file).subarray(0, before.length), before);
  } finally { journal.close(); }
  const rows = ExecutionJournal.inspect(f.root); assert.deepEqual(rows, [{ slot: "candidate", execution, witness: coalition }]);
  const reopened = ExecutionJournal.open(f.root, DARWIN_EXECUTION_JOURNAL_VERSION);
  try { reopened.retire("candidate", execution); } finally { reopened.close(); }
  const frames = readFileSync(f.file, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(frames.map(frame => frame.version), [2, 2, 2, 2, 3, 3, 3]);
  assert.deepEqual(ExecutionJournal.inspect(f.root), []);
});
test("005. Writer versions refuse another version's witness without appending bytes", t => {
  for (const version of [2, DARWIN_EXECUTION_JOURNAL_VERSION]) {
    const f = fixture(t), journal = ExecutionJournal.open(f.root, version);
    try {
      const row = journal.reserve("candidate"), before = readFileSync(f.file);
      const invalid = version === 2 ? [coalition] : [witness, ...["0", "-1", "01", "18446744073709551616"].map(coalitionId => ({ ...coalition, coalitionId })),
        { ...coalition, bootId: "not-a-boot" }, { ...coalition, token: [1, 2, 3] }];
      for (const value of invalid) assert.throws(() => row.publish(value), TypeError);
      assert.deepEqual(readFileSync(f.file), before);
    } finally { journal.close(); }
  }
});
test("006. A valid hash cannot admit a v3 coalition in a v2 frame or an unknown version", t => {
  for (const version of [2, 4]) {
    const f = fixture(t), journal = ExecutionJournal.open(f.root, DARWIN_EXECUTION_JOURNAL_VERSION);
    try { journal.reserve("candidate").publish(coalition); } finally { journal.close(); }
    const frames = readFileSync(f.file, "utf8").trim().split("\n").map(JSON.parse), last = frames.at(-1);
    const { hash, ...body } = { ...last, version };
    frames[frames.length - 1] = { ...body, hash: sha256Hex(canonicalJson(body)) };
    writeFileSync(f.file, frames.map(canonicalJson).join("\n") + "\n"); const before = readFileSync(f.file);
    assert.throws(() => ExecutionJournal.open(f.root), error => error.code === "STORE_CORRUPT");
    assert.deepEqual(readFileSync(f.file), before);
  }
});

test("007. A launch refused before any scope exists cannot poison a journal slot", async t => {
  const f = fixture(t), journal = ExecutionJournal.open(f.root, DARWIN_EXECUTION_JOURNAL_VERSION);
  const owner = new ExecutionCoordinator(journal, () => ({ kind: "unavailable" }));
  try {
    for (let attempt = 0; attempt < 2; ++attempt) {
      await assert.rejects(owner.run({ slot: "candidate", launch: async () => { throw new ExecutionNotStarted(new StoreError("UNSUPPORTED_PROFILE", "capability is absent")); }, authorize() { throw new Error("guard reached authority"); } }),
      { code: "UNSUPPORTED_PROFILE" });
      assert.deepEqual(ExecutionJournal.inspect(f.root), []);
    }
  } finally { await owner.drain(); journal.close(); }
});

test("005. Darwin preparation keys keep concurrent scopes distinct without rewriting existing journal frames",t=>{
 const f=fixture(t),initial=readFileSync(f.file),one='preparation:11111111-1111-4111-8111-111111111111',two='preparation:22222222-2222-4222-8222-222222222222';
 const journal=ExecutionJournal.open(f.root,DARWIN_EXECUTION_JOURNAL_VERSION);
 try{
  const a=journal.reserve(one),b=journal.reserve(two),legacy=journal.reserve('preparation');
  assert.deepEqual(ExecutionJournal.inspect(f.root).map(r=>r.slot),[one,two,'preparation']);
  assert.deepEqual(readFileSync(f.file).subarray(0,initial.length),initial);
  const before=readFileSync(f.file);
  for(const invalid of ['preparation:principal','preparation:../outside','preparation:11111111-1111-1111-8111-111111111111'])assert.throws(()=>journal.reserve(invalid),TypeError);
  assert.deepEqual(readFileSync(f.file),before);
  // No child was created by this format-only fixture.
  a.retire();b.retire();legacy.retire();assert.deepEqual(journal.entries(),[]);
 }finally{journal.close();}
});
test("006. The Linux journal keeps its previous preparation key grammar",t=>{
 const f=fixture(t),journal=ExecutionJournal.open(f.root),before=readFileSync(f.file);
 try{assert.throws(()=>journal.reserve('preparation:11111111-1111-4111-8111-111111111111'),TypeError);assert.deepEqual(readFileSync(f.file),before);}
 finally{journal.close();}
});
