import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { collectProductionFiles, writeProductionInventory, assertProductionInventory } from "../scripts/production-inventory.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "oma-inventory-"));
  const put = (file, bytes = "export {};\n") => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), bytes);
  };
  const roots = ["implementation/contracts.ts", "implementation/schema-v1.sql", "implementation/systemd", "src"];
  put("production-manifest.json", JSON.stringify(roots));
  put("implementation/contracts.ts");
  put("implementation/schema-v1.sql", "SELECT 1;\n");
  put("implementation/systemd/resident.service.in", "[Service]\nExecStart=/bin/true\n");
  put("src/domain/capabilities.ts");
  put("src/protocol/channel.ts");
  put("src/storage/transaction.ts");
  put("src/process/run.ts");
  put("src/process/async.ts");
  return { root, roots, put, close() { rmSync(root, { recursive: true, force: true }); } };
}
test("R38 C05: every witnessed new owner is enumerated without requiring cloc", () => {
  const f = fixture();
  try {
    const files = writeProductionInventory(f.root);
    for (const file of ["src/domain/capabilities.ts", "src/protocol/channel.ts", "src/storage/transaction.ts", "src/process/run.ts", "src/process/async.ts"])
      assert.ok(files.includes(file), file);
    assert.deepEqual(assertProductionInventory(f.root), files);
    assert.equal(readFileSync(join(f.root, "production-files.txt"), "utf8"), files.join("\n") + "\n");
    f.put("src/process/new-owner.ts");
    assert.throws(() => assertProductionInventory(f.root), /stale production-files/);
    writeProductionInventory(f.root);
    assert.ok(assertProductionInventory(f.root).includes("src/process/new-owner.ts"));
  } finally { f.close(); }
});
test("R38 C05: omission, duplicate identity and out-of-root paths cannot lower the inventory", () => {
  const f = fixture();
  try {
    f.put("production-manifest.json", JSON.stringify(f.roots.filter(root => root !== "src")));
    assert.throws(() => collectProductionFiles(f.root), /omits current runtime sources/);
    f.put("production-manifest.json", JSON.stringify([...f.roots, "src/process/run.ts"]));
    assert.throws(() => collectProductionFiles(f.root), /duplicate production source/);
    f.put("production-manifest.json", JSON.stringify(["../outside"]));
    assert.throws(() => collectProductionFiles(f.root), /invalid production manifest path/);
    f.put("production-manifest.json", JSON.stringify(f.roots));
    f.put("src/unsupported.in", "not a systemd input\n");
    assert.throws(() => collectProductionFiles(f.root), /unsupported .in language/);
  } finally { f.close(); }
});
test("R38 C05: equal bytes in distinct source files are counted, symlink sources are rejected", () => {
  const f = fixture();
  try {
    f.put("src/duplicate-a.ts", "export const same = 1;\n");
    f.put("src/duplicate-b.ts", "export const same = 1;\n");
    const files = collectProductionFiles(f.root);
    assert.ok(files.includes("src/duplicate-a.ts"));
    assert.ok(files.includes("src/duplicate-b.ts"));
    symlinkSync("duplicate-a.ts", join(f.root, "src/link.ts"));
    assert.throws(() => collectProductionFiles(f.root), /symlink/);
  } finally { f.close(); }
});
