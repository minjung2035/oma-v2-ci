import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { collectProductionFiles, writeProductionInventory, assertProductionInventory, assertMeasurementCurrent } from "../scripts/production-inventory.mjs";

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

test("R38: the measured artifacts are bound to the source they were taken from", () => {
  const f = fixture();
  try {
    const files = writeProductionInventory(f.root);
    const hashOf = bytes => createHash("sha256").update(bytes).digest("hex");
    const rows = list => Object.fromEntries(list.map(file => [file, { code: 3, blank: 1, comment: 2 }]));
    const measure = (list = files, overrides = {}) => {
      f.put("production-loc-hashes.json", JSON.stringify({
        cloc: "2.08", manifest: hashOf(`${list.join("\n")}\n`),
        files: list.map(file => ({ path: file, sha256: hashOf(readFileSync(join(f.root, file))) })),
        ...(overrides.hashes ?? {}),
      }));
      f.put("production-loc.json", JSON.stringify({
        header: { n_files: list.length, cloc_version: "2.08", ...(overrides.header ?? {}) },
        ...rows(list),
        SUM: { code: 3 * list.length, blank: list.length, comment: 2 * list.length, nFiles: list.length, ...(overrides.sum ?? {}) },
      }));
    };
    // Positive: records taken from exactly this source, whose total is the sum
    // of its own rows, are current.
    measure();
    assert.deepEqual(assertMeasurementCurrent(f.root), { files: files.length, code: 3 * files.length });

    // A file whose bytes changed after measurement. The file list is unchanged,
    // so only this check can see it -- and this is the drift that let a LOC
    // figure from an older commit be read as the current one.
    f.put("src/process/async.ts", "export const changed = 1;\n");
    assert.throws(() => assertMeasurementCurrent(f.root), /stale production-loc-hashes\.json/);
    measure();
    assert.doesNotThrow(() => assertMeasurementCurrent(f.root));

    // A total that is not the sum of the rows. Every row is present and the
    // header counts them, so membership checks alone see nothing wrong -- and
    // the total is the number the LOC release gate is judged on.
    measure(files, { sum: { code: 1 } });
    assert.throws(() => assertMeasurementCurrent(f.root), /SUM disagrees with its own rows/);
    measure(files, { sum: { nFiles: files.length + 1 } });
    assert.throws(() => assertMeasurementCurrent(f.root), /SUM disagrees with its own rows/);

    // A report with no total at all is not a measurement this gate passes on.
    measure();
    const counted = JSON.parse(readFileSync(join(f.root, "production-loc.json"), "utf8"));
    delete counted.SUM;
    f.put("production-loc.json", JSON.stringify(counted));
    assert.throws(() => assertMeasurementCurrent(f.root), /no SUM/);

    // Counts and hashes taken by different tools are two observations, not one.
    measure(files, { header: { cloc_version: "2.09" } });
    assert.throws(() => assertMeasurementCurrent(f.root), /different runs/);

    // A row for a file the manifest does not contain inflates the total from
    // outside the measured set.
    measure();
    const inflated = JSON.parse(readFileSync(join(f.root, "production-loc.json"), "utf8"));
    inflated["src/not-production.ts"] = { code: 900, blank: 0, comment: 0 };
    f.put("production-loc.json", JSON.stringify(inflated));
    assert.throws(() => assertMeasurementCurrent(f.root), /outside the manifest/);

    // A new production file that the records never saw.
    measure();
    f.put("src/process/added.ts");
    assert.throws(() => assertMeasurementCurrent(f.root), /different file list/);
    writeProductionInventory(f.root);
    assert.throws(() => assertMeasurementCurrent(f.root), /different file list/);
    measure(writeProductionInventory(f.root));
    assert.doesNotThrow(() => assertMeasurementCurrent(f.root));
  } finally { f.close(); }
});
