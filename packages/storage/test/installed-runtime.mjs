/** Installed SQLite connections remain owned by Storage. */
import assert from "node:assert/strict";
import { closeSync, mkdtempSync, openSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, createDarwinSqliteRoot } from "@oma/storage";
import { DatabaseSync } from "node:sqlite";
const directory = realpathSync(mkdtempSync(join(tmpdir(), "oma-installed-storage-")));
try {
  const store = new Store(join(directory, "runtime.sqlite"));
  try { assert.equal(store.societyOpen(), true); } finally { store.close(); }
  if (process.platform === "darwin") {
    const fd = openSync(directory, "r");
    let root;
    try { root = createDarwinSqliteRoot(fd); } finally { closeSync(fd); }
    const db = new DatabaseSync(root.address("probe.sqlite"));
    try {
      assert.equal(db.prepare("PRAGMA journal_mode=WAL").get().journal_mode, "wal");
      db.exec("CREATE TABLE probe(value);INSERT INTO probe VALUES(1)");
      assert.throws(() => root.close(), error => error.code === "REF_STATE_UNKNOWN");
      assert.equal(db.prepare("SELECT value FROM probe").get().value, 1);
    } finally { db.close(); root.close(); }
  }
} finally { rmSync(directory, { recursive: true }); }
