/** DR27/P0: schema changes preserve accepted bytes, order, and dependent facts. */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AuthContext } from "../implementation/contracts.js";
import { Store, readDiagnosticSnapshot } from "../src/store.js";
import { MailModule } from "../src/mail.js";
import { AttestationModule } from "../src/attestation.js";
import { inspectLedger } from "../src/diagnostics/ledger.js";
import { ledgerTables } from "../src/storage/diagnostic-snapshot.js";
import { ALL_CAPS, makeValidAgent } from "./fixtures/spec.js";

async function legacy(t: TestContext, version: 1 | 2) {
  const root = mkdtempSync(join(tmpdir(), "oma-society-schema-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "runtime.sqlite");
  const seed = join(root, "seed.sqlite");
  const store = new Store(seed, 0, { society: "demo" });
  try {
    store.transaction(tx => { tx.insertAgent(makeValidAgent("principal")); tx.insertAgent(makeValidAgent("alice", { createdBy: "principal" })); });
    const auth: AuthContext = { actor: "alice", role: "resident", incarnation: 1, capabilities: new Set(ALL_CAPS), channel: "actor",
      peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), cgroup: null } };
    const mail = new MailModule({ stateRoot: root, society: "demo" }, store, 64, 24, { frameBytes: 1024 * 1024, batchMaxMessages: 24 });
    await mail.send(auth, "mail", { to: ["principal"], subject: "Preserve this", body: "bytes\n", kind: "message" });
    await mail.prepare({ ...auth, actor: "principal", role: "principal", incarnation: 0 });
    store.transaction(tx => tx.follow("kept", "alice"));
    if (version === 2) {
      const attestations = new AttestationModule(store, mail, { exact() {}, principal() {} });
      await attestations.record(auth, "review", { kind: "peer", verdict: "APPROVE", evidence: "Exact reviewed bytes",
        identity: { repo: "project", targetRef: "refs/heads/main", candidate: "2".repeat(40), expectedBase: "1".repeat(40), policyRevision: "p1" } });
    }
  } finally { store.close(); }
  const source = new DatabaseSync(seed, { readOnly: true }); const db = new DatabaseSync(path);
  try {
    db.exec(readFileSync(new URL(`../../implementation/schema-v${version}.sql`, import.meta.url), "utf8"));
    db.exec("PRAGMA foreign_keys=OFF; BEGIN EXCLUSIVE");
    for (const table of ledgerTables(version)) {
      for (const row of source.prepare(`SELECT rowid,* FROM ${table}`).all()) {
        const columns = Object.keys(row);
        // Gaps in accepted order and whitespace in immutable JSON must survive.
        if (table === "operations") {
          row.rowid = Number(row.rowid) * 17;
          for (const column of ["payload_json", "plan_json", "result_json"])
            if (typeof row[column] === "string") row[column] = JSON.stringify(JSON.parse(row[column]), null, 2);
        }
        db.prepare(`INSERT INTO ${table}(${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`)
          .run(...columns.map(column => row[column]!));
      }
    }
    db.exec("COMMIT; PRAGMA foreign_keys=ON");
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { source.close(); db.close(); }
  return { root, path };
}
function contents(path: string, version: number) {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return Object.fromEntries(ledgerTables(version).map(table => [table, db.prepare(`SELECT rowid,* FROM ${table} ORDER BY rowid`).all()])); }
  finally { db.close(); }
}
for (const version of [1, 2] as const) {
  test(`DR27: v${version} to v3 preserves every dependent fact and diagnostic reads never migrate`, async t => {
    const f = await legacy(t, version); const before = contents(f.path, version);
    const old = readDiagnosticSnapshot(f.root); assert.equal(old.schemaVersion, version);
    assert.equal(inspectLedger(old, { stateRoot: f.root, society: "demo" }).report.status, "PASS");
    const store = new Store(f.path, 0, { society: "demo" });
    try { assert.equal(store.societyOpen(), true); } finally { store.close(); }
    assert.deepEqual(contents(f.path, version), before);
    const after = readDiagnosticSnapshot(f.root); assert.equal(after.schemaVersion, 3);
    assert.deepEqual(after.foreignKeys, []);
    const report = inspectLedger(after, { stateRoot: f.root, society: "demo" }).report;
    assert.equal(report.status, "PASS", JSON.stringify(report));
    const again = new Store(f.path, 0, { society: "demo" }); again.close();
    assert.deepEqual(contents(f.path, version), before);
  });
  test(`DR27: v${version} migration with broken foreign keys rolls back all tables and the version`, async t => {
    const f = await legacy(t, version); const db = new DatabaseSync(f.path);
    db.exec("PRAGMA foreign_keys=OFF"); db.prepare("UPDATE deliveries SET operation_id=?").run("op-00000000-0000-4000-8000-000000000999"); db.close();
    const before = contents(f.path, version);
    assert.throws(() => new Store(f.path, 0, { society: "demo" }), { code: "STORE_CORRUPT" });
    assert.deepEqual(contents(f.path, version), before);
    assert.equal(readDiagnosticSnapshot(f.root).schemaVersion, version);
  });
}
test("DR27: interruption between v1-v2 and v2-v3 rolls the entire migration back", async t => {
  const f = await legacy(t, 1); const before = contents(f.path, 1); let injected = false;
  const exec = DatabaseSync.prototype.exec;
  t.mock.method(DatabaseSync.prototype, "exec", function(this: DatabaseSync, sql: string) {
    const at = sql.indexOf("CREATE TABLE operations_v3");
    if (sql.includes("CREATE TABLE operations_v2") && at >= 0) {
      exec.call(this, sql.slice(0, at)); injected = true; throw new Error("injected second-stage migration failure");
    }
    return exec.call(this, sql);
  });
  assert.throws(() => new Store(f.path, 0, { society: "demo" }), { code: "STORE_CORRUPT" });
  assert.equal(injected, true); assert.deepEqual(contents(f.path, 1), before);
  assert.equal(readDiagnosticSnapshot(f.root).schemaVersion, 1);
});
