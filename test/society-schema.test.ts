/** DR67: schema5 is current, schema4 requires the explicit backed-up migration; unsupported versions fail closed. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store, readDiagnosticSnapshot } from "@oma/storage";
import { makeValidAgent } from "./fixtures/spec.js";

function legacyAt(version: number): { root: string; path: string } {
  const root = mkdtempSync(join(tmpdir(), "oma-society-schema-"));
  const path = join(root, "runtime.sqlite");
  const store = new Store(path, 0, { society: "demo" });
  store.transaction(tx => { tx.insertAgent(makeValidAgent("alice")); });
  store.close();
  const db = new DatabaseSync(path);
  try { db.exec(`PRAGMA user_version = ${version}`); } finally { db.close(); }
  return { root, path };
}

for (const version of [1, 2, 3, 6, 99]) {
  test(`001. A database at user_version ${version} fails closed and is never rewritten`, () => {
    const { root, path } = legacyAt(version);
    try {
      const bytes = readFileSync(path);
      assert.throws(() => new Store(path, 0, { society: "demo" }), { code: "STORE_CORRUPT" });
      assert.deepEqual(readFileSync(path), bytes, "the refused database was modified");
      assert.throws(() => readDiagnosticSnapshot(root), { code: "STORE_CORRUPT" });
      const db = new DatabaseSync(path, { readOnly: true });
      try { assert.equal(db.prepare("PRAGMA user_version").get()?.user_version, version); } finally { db.close(); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test("002. An unversioned nonempty database is not mistaken for a new one", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-society-schema-"));
  const path = join(root, "runtime.sqlite");
  try {
    const db = new DatabaseSync(path);
    try { db.exec("CREATE TABLE stray (id INTEGER PRIMARY KEY)"); } finally { db.close(); }
    const bytes = readFileSync(path);
    assert.throws(() => new Store(path, 0, { society: "demo" }), { code: "STORE_CORRUPT" });
    assert.deepEqual(readFileSync(path), bytes);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("003. A new database gets schema v5 and a v5 database reopens unchanged", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-society-schema-"));
  const path = join(root, "runtime.sqlite");
  try {
    const store = new Store(path, 0, { society: "demo" });
    store.transaction(tx => { tx.insertAgent(makeValidAgent("alice")); });
    store.close();
    const bytes = readFileSync(path);
    const db = new DatabaseSync(path, { readOnly: true });
    try { assert.equal(db.prepare("PRAGMA user_version").get()?.user_version, 5); } finally { db.close(); }
    const snapshot = readDiagnosticSnapshot(root);
    assert.equal(snapshot.schemaVersion, 5);
    assert.deepEqual(snapshot.foreignKeys, []);
    const again = new Store(path, 0, { society: "demo" });
    try {
      assert.equal(again.getAgent("alice")?.name, "alice");
      assert.equal(again.societyOpen(), true);
    } finally { again.close(); }
    assert.deepEqual(readFileSync(path), bytes, "an open of the current schema rewrote the file");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
