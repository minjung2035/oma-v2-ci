import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { observeFile } from "./fixtures/effect-observation.js";
import { mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store, StoreError } from "../src/store.js";

function databaseDescriptors(root: string): string[] {
  const paths: string[] = [];
  for (const fd of readdirSync("/proc/self/fd")) {
    try {
      const path = readlinkSync(`/proc/self/fd/${fd}`);
      if (path.startsWith(`${root}/`)) paths.push(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return paths.sort();
}

function fileSnapshot(root: string): Record<string, ReturnType<typeof observeFile>> {
  return Object.fromEntries(readdirSync(root).sort().map(name => [name, observeFile(join(root, name))]));
}

for (const fixture of ["delete", "wal-closed", "wal-retained"] as const) {
  test(`V04A: unsupported ${fixture} Store refusal preserves database and sidecars`, t => {
    const root = mkdtempSync(join(tmpdir(), "oma-store-refusal-"));
    const path = join(root, "runtime.sqlite");
    try {
      const setup = new DatabaseSync(path);
      setup.exec("CREATE TABLE preserved(value); PRAGMA user_version=1");
      if (fixture !== "delete") setup.exec("PRAGMA journal_mode=WAL");
      if (fixture !== "wal-retained") setup.exec("PRAGMA user_version=77");
      setup.close();
      if (fixture === "wal-retained") {
        const child = spawnSync(process.execPath, ["--input-type=module", "-e",
          `import {DatabaseSync} from 'node:sqlite'; const d=new DatabaseSync(${JSON.stringify(path)}); d.exec('PRAGMA user_version=77'); process.kill(process.pid,'SIGKILL');`],
        { encoding: "utf8", timeout: 5000, maxBuffer: 65536, killSignal: "SIGKILL" });
        assert.equal(child.error, undefined);
        assert.equal(child.signal, "SIGKILL");
        assert.equal(readFileSync(path).readUInt32BE(60), 1, "future version must be committed only in the WAL");
      }
      const before = fileSnapshot(root);
      const descriptors = databaseDescriptors(root);
      let opened: Store | undefined;
      try {
        assert.throws(() => { opened = new Store(path); }, error =>
          error instanceof StoreError && error.code === "STORE_CORRUPT");
      } finally { opened?.close(); }
      const after = fileSnapshot(root);
      t.diagnostic(JSON.stringify({ fixture, before, after }));
      assert.deepEqual(after, before);
      assert.deepEqual(databaseDescriptors(root), descriptors);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test("V04B: fresh and supported Store ownership still transfers to the caller", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-store-supported-"));
  try {
    const path = join(root, "runtime.sqlite");
    for (let attempt = 0; attempt < 2; attempt++) {
      const store = new Store(path);
      try {
        assert.deepEqual(store.listAgents(), []);
        assert.equal(store.transaction(() => 7), 7);
      } finally { store.close(); }
      assert.deepEqual(databaseDescriptors(root), []);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
