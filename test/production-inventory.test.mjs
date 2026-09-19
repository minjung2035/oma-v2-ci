import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { collectProductionFiles, writeProductionInventory, assertProductionInventory, assertMeasurementCurrent, measureWithCloc } from "../scripts/production-inventory.mjs";
import { EXECUTED_SOURCE_ROOTS, executedSourceDigest } from "../scripts/source-digest.mjs";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));

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
    // The report, then the hashes that name it -- the order loc.mjs writes them.
    const measure = (list = files, overrides = {}) => {
      f.put("production-loc.json", JSON.stringify({
        header: { n_files: list.length, cloc_version: "2.08", ...(overrides.header ?? {}) },
        ...rows(list),
        SUM: { code: 3 * list.length, blank: list.length, comment: 2 * list.length, nFiles: list.length, ...(overrides.sum ?? {}) },
      }));
      f.put("production-loc-hashes.json", JSON.stringify({
        cloc: "2.08", manifest: hashOf(`${list.join("\n")}\n`),
        report: hashOf(readFileSync(join(f.root, "production-loc.json"))),
        files: list.map(file => ({ path: file, sha256: hashOf(readFileSync(join(f.root, file))) })),
        ...(overrides.hashes ?? {}),
      }));
    };
    // A stand-in for the pinned tool, returning what these fixture rows claim.
    const agrees = () => ({ ...rows(writeProductionInventory(f.root)), SUM: { code: 3 * files.length } });
    const check = (options = { measure: agrees }) => assertMeasurementCurrent(f.root, undefined, options);

    // Positive: re-measured and equal is the only thing called source-bound.
    measure();
    assert.deepEqual(check(), { files: files.length, code: 3 * files.length, status: "SOURCE_BOUND" });
    // Without the tool the answer is not a pass dressed up as one.
    assert.equal(check({ measure: () => null }).status, "CONSISTENT_NOT_REMEASURED");

    // The audit's attack: counts rewritten everywhere, total adjusted to match,
    // hashes regenerated beside them. Every internal check agrees; only
    // measuring the source again shows the numbers are not the source's.
    const forged = files.map(file => [file, { code: 900, blank: 0, comment: 0 }]);
    f.put("production-loc.json", JSON.stringify({
      header: { n_files: files.length, cloc_version: "2.08" }, ...Object.fromEntries(forged),
      SUM: { code: 900 * files.length, blank: 0, comment: 0, nFiles: files.length },
    }));
    f.put("production-loc-hashes.json", JSON.stringify({
      cloc: "2.08", manifest: hashOf(`${files.join("\n")}\n`),
      report: hashOf(readFileSync(join(f.root, "production-loc.json"))),
      files: files.map(file => ({ path: file, sha256: hashOf(readFileSync(join(f.root, file))) })),
    }));
    assert.throws(() => check(), /does not match a fresh measurement/);
    // ...and without re-measuring, that forgery is exactly what cannot be
    // detected, which is why that case is never reported as bound.
    assert.equal(check({ measure: () => null }).status, "CONSISTENT_NOT_REMEASURED");

    // The report edited on its own, hashes untouched.
    measure();
    const edited = JSON.parse(readFileSync(join(f.root, "production-loc.json"), "utf8"));
    edited.header.elapsed_seconds = 1;
    f.put("production-loc.json", JSON.stringify(edited));
    assert.throws(() => check(), /not the report its hashes were recorded with/);

    // A file whose bytes changed after measurement.
    measure();
    f.put("src/process/async.ts", "export const changed = 1;\n");
    assert.throws(() => check(), /stale production-loc-hashes\.json/);
    measure();
    assert.doesNotThrow(() => check());

    // A total that is not the sum of the rows.
    measure(files, { sum: { code: 1 } });
    assert.throws(() => check(), /SUM disagrees with its own rows/);
    measure(files, { sum: { nFiles: files.length + 1 } });
    assert.throws(() => check(), /SUM disagrees with its own rows/);

    // A report with no total at all.
    measure();
    const counted = JSON.parse(readFileSync(join(f.root, "production-loc.json"), "utf8"));
    delete counted.SUM;
    f.put("production-loc.json", JSON.stringify(counted));
    assert.throws(() => check(), /no SUM/);

    // Counts and hashes taken by different tools.
    measure(files, { header: { cloc_version: "2.09" } });
    assert.throws(() => check(), /different runs/);

    // A row outside the manifest inflating the total.
    measure();
    const inflated = JSON.parse(readFileSync(join(f.root, "production-loc.json"), "utf8"));
    inflated["src/not-production.ts"] = { code: 900, blank: 0, comment: 0 };
    f.put("production-loc.json", JSON.stringify(inflated));
    assert.throws(() => check(), /outside the manifest/);

    // A new production file the records never saw.
    measure();
    f.put("src/process/added.ts");
    assert.throws(() => check(), /different file list/);
  } finally { f.close(); }
});

test("R38: the pinned tool re-measures real source and catches a forged count", () => {
  // Not a stand-in: the real cloc on real files. A dev host or CI runner without
  // the pinned version fails here rather than skipping -- a gate that silently
  // could not measure is the thing this test exists to rule out.
  const f = fixture();
  try {
    // The real language definition, so the systemd templates are counted the
    // way the production run counts them.
    f.put("implementation/cloc-systemd.lang", readFileSync(new URL("../implementation/cloc-systemd.lang", import.meta.url)));
    f.put("src/process/async.ts", "// a comment\nexport const a = 1;\n\nexport const b = 2;\n");
    const files = writeProductionInventory(f.root);
    const cloc = measureWithCloc(f.root, files);
    assert.ok(cloc !== null, "cloc 2.08 is not installed; this gate cannot bind LOC to the source");
    assert.deepEqual({ code: cloc["src/process/async.ts"].code, comment: cloc["src/process/async.ts"].comment },
      { code: 2, comment: 1 });
    const hashOf = bytes => createHash("sha256").update(bytes).digest("hex");
    const write = report => {
      f.put("production-loc.json", JSON.stringify(report));
      f.put("production-loc-hashes.json", JSON.stringify({
        cloc: "2.08", manifest: hashOf(`${files.join("\n")}\n`),
        report: hashOf(readFileSync(join(f.root, "production-loc.json"))),
        files: files.map(file => ({ path: file, sha256: hashOf(readFileSync(join(f.root, file))) })),
      }));
    };
    write({ ...cloc, header: { ...cloc.header, n_files: files.length } });
    assert.equal(assertMeasurementCurrent(f.root).status, "SOURCE_BOUND");
    // One count off by one, the total adjusted to keep every sum consistent.
    const forged = JSON.parse(JSON.stringify(cloc));
    forged["src/process/async.ts"].code += 1;
    forged.SUM.code += 1;
    write({ ...forged, header: { ...forged.header, n_files: files.length } });
    assert.throws(() => assertMeasurementCurrent(f.root), /does not match a fresh measurement/);
  } finally { f.close(); }
});

test("R38: the executed source closure includes the shared production contract", () => {
  // This TypeScript file is compiled into every build even though it lives
  // outside src/. Omitting it would let an executable contract change keep an
  // earlier run's digest and results looking current.
  assert.deepEqual(EXECUTED_SOURCE_ROOTS, [
    "src", "test", "scripts", "implementation/contracts.ts",
  ]);
});

test("R38: the validation record names the source that was run, by its bytes", () => {
  // The record calls itself the single owner of current verification status.
  // A commit name in it says which revision was meant; it does not say which
  // bytes were run, and a line left behind by an earlier commit reads exactly
  // like a current one. The digest is the bytes, so a source change that is
  // not re-run and re-recorded fails here instead of leaving an earlier tree's
  // figures looking current.
  const record = readFileSync(new URL("../implementation/validation.md", import.meta.url), "utf8");
  const quoted = [...record.matchAll(/executed source digest `([0-9a-f]{64})` \((\d+) files\)/g)]
    .map(([, value, files]) => ({ digest: value, files: Number(files) }));
  assert.equal(quoted.length, 1, "the validation record names no executed source digest, or more than one");
  assert.deepEqual(quoted[0], executedSourceDigest(REPO),
    "the validation record names a source digest that is not this tree's");
});

test("R38: the figures the validation record quotes are the ones the artifact holds", () => {
  // A record that says one number while the artifact says another is how a
  // reader ends up judging A-008 on a figure from an earlier commit.
  const record = readFileSync(new URL("../implementation/validation.md", import.meta.url), "utf8");
  const report = JSON.parse(readFileSync(new URL("../production-loc.json", import.meta.url), "utf8"));
  const quoted = [...record.matchAll(/(\d+) files \/ ([\d,]+) code LOC/g)]
    .map(([, files, code]) => ({ files: Number(files), code: Number(code.replaceAll(",", "")) }));
  assert.ok(quoted.length > 0, "the validation record quotes no LOC figure at all");
  for (const figure of quoted)
    assert.deepEqual(figure, { files: report.SUM.nFiles, code: report.SUM.code },
      `validation.md quotes ${figure.files} files / ${figure.code} LOC; the artifact holds ${report.SUM.nFiles} / ${report.SUM.code}`);
});
