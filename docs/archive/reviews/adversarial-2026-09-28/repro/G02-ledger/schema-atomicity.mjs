// G02-ledger repro: DB-001 schema application atomicity and idempotent reopen.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const dir = mkdtempSync(join(tmpdir(), "oma-adv-G02-ledger-"));
let failures = 0;
const log = (ok, msg) => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}: ${msg}`); };

try {
  // 1. A schema whose COMMIT is not reached leaves user_version at 0 (atomic).
  const p1 = join(dir, "partial.sqlite");
  const db = new DatabaseSync(p1);
  db.exec("PRAGMA journal_mode = WAL");
  // Apply everything the real schema does EXCEPT the trailing COMMIT, then close.
  db.exec("BEGIN EXCLUSIVE; CREATE TABLE agents (name TEXT PRIMARY KEY); PRAGMA user_version = 1;");
  // Do not COMMIT; closing rolls back the open transaction.
  db.close();
  const check = new DatabaseSync(p1, { readOnly: true });
  const uv = check.prepare("PRAGMA user_version").get().user_version;
  const hasTable = check.prepare("SELECT 1 FROM sqlite_schema WHERE name='agents'").get();
  check.close();
  log(uv === 0 && hasTable === undefined,
    `uncommitted schema rolls back atomically (user_version=${uv}, agents present=${hasTable !== undefined})`);

  // 2. Real Store applies v1 and reopens idempotently.
  const { Store } = await import("../../../../dist/src/store.js");
  const p2 = join(dir, "runtime.sqlite");
  const s1 = new Store(p2); s1.close();
  const s2 = new Store(p2); // second open must not re-migrate or throw
  s2.close();
  const v = new DatabaseSync(p2, { readOnly: true });
  const uv2 = v.prepare("PRAGMA user_version").get().user_version;
  v.close();
  log(uv2 === 1, `Store applies user_version=1 and reopens idempotently (user_version=${uv2})`);
} catch (e) {
  console.log(`ERROR: ${e && e.stack ? e.stack : e}`); failures++;
} finally {
  rmSync(dir, { recursive: true, force: true });
  console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAIL"}`);
}
