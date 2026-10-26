import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { collectProductionFiles, writeProductionInventory, assertProductionInventory, assertMeasurementCurrent, assertSourceDigests, measureWithCloc, writeSourceDigests } from "../scripts/production-inventory.mjs";
import { VERIFICATION_INPUT_ROOTS, VERIFICATION_OUTPUT_EXCLUSIONS, verificationInputDigest, verificationInputFiles, verificationSourceDigests } from "../scripts/source-digest.mjs";
import { fileURLToPath } from "node:url";
import { bindVerificationInputs } from "../scripts/refresh-evidence.mjs";
import { brokenLinks, documentLayoutFindings, projectDocuments } from "../scripts/document-integrity.mjs";

const REPO = fileURLToPath(new URL("..", import.meta.url));

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "oma-inventory-"));
  const put = (file, bytes = "export {};\n") => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), bytes);
  };
  const schemas = ["schema-v4.sql"]
    .map(name => `packages/storage/src/${name}`);
  const roots = ["apps/oma/src", "apps/oma/package.json",
    ...["contracts", "domain", "client", "process", "storage", "platform-linux"].flatMap(name => [`packages/${name}/src`, `packages/${name}/package.json`])];
  put("production-manifest.json", JSON.stringify(roots));
  put("apps/oma/src/entry.ts");
  put("apps/oma/package.json", "{}\n");
  put("packages/contracts/src/index.ts");
  for (const name of ["contracts", "domain", "client", "process", "storage", "platform-linux"]) put(`packages/${name}/package.json`, "{}\n");
  for (const schema of schemas) put(schema, "SELECT 1;\n");
  put("packages/platform-linux/src/systemd/resident.service.in", "[Service]\nExecStart=/bin/true\n");
  put("packages/domain/src/capabilities.ts");
  put("packages/client/src/channel.ts");
  put("packages/storage/src/transaction.ts");
  put("packages/process/src/run.ts");
  put("packages/process/src/async.ts");
  return { root, roots, put, close() { rmSync(root, { recursive: true, force: true }); } };
}
test("R38 C05: every witnessed new owner is enumerated without requiring cloc", () => {
  const f = fixture();
  try {
    const files = writeProductionInventory(f.root);
    for (const file of ["packages/domain/src/capabilities.ts", "packages/client/src/channel.ts", "packages/storage/src/transaction.ts", "packages/process/src/run.ts", "packages/process/src/async.ts"])
      assert.ok(files.includes(file), file);
    assert.deepEqual(assertProductionInventory(f.root), files);
    assert.equal(readFileSync(join(f.root, "production-files.txt"), "utf8"), files.join("\n") + "\n");
    f.put("packages/process/src/new-owner.ts");
    assert.throws(() => assertProductionInventory(f.root), /stale production-files/);
    writeProductionInventory(f.root);
    assert.ok(assertProductionInventory(f.root).includes("packages/process/src/new-owner.ts"));
  } finally { f.close(); }
});
test("R38 C05: omission, duplicate identity and out-of-root paths cannot lower the inventory", () => {
  const f = fixture();
  try {
    f.put("production-manifest.json", JSON.stringify(f.roots.filter(root => root !== "apps/oma/src")));
    assert.throws(() => collectProductionFiles(f.root), /omits current runtime sources/);
    f.put("production-manifest.json", JSON.stringify([...f.roots, "packages/process/src/run.ts"]));
    assert.throws(() => collectProductionFiles(f.root), /duplicate production source/);
    f.put("production-manifest.json", JSON.stringify(["../outside"]));
    assert.throws(() => collectProductionFiles(f.root), /invalid production manifest path/);
    f.put("production-manifest.json", JSON.stringify(f.roots));
    f.put("apps/oma/src/unsupported.in", "not a systemd input\n");
    assert.throws(() => collectProductionFiles(f.root), /unsupported .in language/);
  } finally { f.close(); }
});
test("R38 C05: equal bytes in distinct source files are counted, symlink sources are rejected", () => {
  const f = fixture();
  try {
    f.put("apps/oma/src/duplicate-a.ts", "export const same = 1;\n");
    f.put("apps/oma/src/duplicate-b.ts", "export const same = 1;\n");
    const files = collectProductionFiles(f.root);
    assert.ok(files.includes("apps/oma/src/duplicate-a.ts"));
    assert.ok(files.includes("apps/oma/src/duplicate-b.ts"));
    symlinkSync("duplicate-a.ts", join(f.root, "apps/oma/src/link.ts"));
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
      writeSourceDigests(f.root, list);
      f.put("production-loc.json", JSON.stringify({
        header: { n_files: list.length, cloc_version: "2.08", ...(overrides.header ?? {}) },
        ...rows(list),
        SUM: { code: 3 * list.length, blank: list.length, comment: 2 * list.length, nFiles: list.length, ...(overrides.sum ?? {}) },
      }));
      f.put("production-measurement-hashes.json", JSON.stringify({
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
    f.put("production-measurement-hashes.json", JSON.stringify({
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
    f.put("packages/process/src/async.ts", "export const changed = 1;\n");
    assert.throws(() => check(), /stale production source digests/);
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
    measure(files, { header: { cloc_version: "2.09" }, hashes: { cloc: "2.09" } });
    assert.throws(() => check(), /requires pinned cloc/);
    measure(files, { hashes: { files: files.map(() => ({ path: files[0], sha256: hashOf(readFileSync(join(f.root, files[0]))) })) } });
    assert.throws(() => check(), /invalid production measurement source digests/);

    // A row outside the manifest inflating the total.
    measure();
    const inflated = JSON.parse(readFileSync(join(f.root, "production-loc.json"), "utf8"));
    inflated["apps/oma/src/not-production.ts"] = { code: 900, blank: 0, comment: 0 };
    f.put("production-loc.json", JSON.stringify(inflated));
    assert.throws(() => check(), /outside the manifest/);

    // A new production file the records never saw.
    measure();
    f.put("packages/process/src/added.ts");
    assert.throws(() => check(), /invalid production source digests|different file list/);
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
    f.put("packages/process/src/async.ts", "// a comment\nexport const a = 1;\n\nexport const b = 2;\n");
    const files = writeProductionInventory(f.root);
    const cloc = measureWithCloc(f.root, files);
    assert.ok(cloc !== null, "cloc 2.08 is not installed; this gate cannot bind LOC to the source");
    assert.deepEqual({ code: cloc["packages/process/src/async.ts"].code, comment: cloc["packages/process/src/async.ts"].comment },
      { code: 2, comment: 1 });
    const hashOf = bytes => createHash("sha256").update(bytes).digest("hex");
    const write = report => {
      writeSourceDigests(f.root, files);
      f.put("production-loc.json", JSON.stringify(report));
      f.put("production-measurement-hashes.json", JSON.stringify({
        cloc: "2.08", manifest: hashOf(`${files.join("\n")}\n`),
        report: hashOf(readFileSync(join(f.root, "production-loc.json"))),
        files: files.map(file => ({ path: file, sha256: hashOf(readFileSync(join(f.root, file))) })),
      }));
    };
    write({ ...cloc, header: { ...cloc.header, n_files: files.length } });
    assert.equal(assertMeasurementCurrent(f.root).status, "SOURCE_BOUND");
    // DR20: a genuinely large source is measured, never refused by its size.
    f.put("packages/process/src/async.ts", "export const value = 1;\n".repeat(10001));
    const large = measureWithCloc(f.root, files);
    write({ ...large, header: { ...large.header, n_files: files.length } });
    assert.ok(large.SUM.code > 10000);
    assert.equal(assertMeasurementCurrent(f.root).status, "SOURCE_BOUND");
    // One count off by one, the total adjusted to keep every sum consistent.
    const forged = JSON.parse(JSON.stringify(large));
    forged["packages/process/src/async.ts"].code += 1;
    forged.SUM.code += 1;
    write({ ...forged, header: { ...forged.header, n_files: files.length } });
    assert.throws(() => assertMeasurementCurrent(f.root), /does not match a fresh measurement/);
  } finally { f.close(); }
});

test("R38: the verification closure includes every class of local gate input", () => {
  assert.deepEqual(VERIFICATION_INPUT_ROOTS, [
    "apps", "packages", "test", "scripts", "implementation", "docs", ".github/workflows", ".gitignore", "README.md",
    "package.json", "package-lock.json",
    "tsconfig.json", "tsconfig.build.json", "tsconfig.architecture.json", "production-manifest.json", "production-files.txt",
    "production-loc-hashes.json",
  ]);
  assert.deepEqual(VERIFICATION_OUTPUT_EXCLUSIONS, [
    "implementation/evidence/runtime-tests.log", "docs/archive/adversarial-review.md",
  ]);
  const files = verificationInputFiles(REPO);
  for (const required of [
    "README.md", "packages/tui/src/keys.ts", "test/tui-app.test.ts", "scripts/test-local.mjs",
    "packages/contracts/src/index.ts", "packages/storage/src/schema-v4.sql",
    "packages/platform-mac/src/keychain/main.swift", "scripts/setup-native-linux-ci.sh",
    "implementation/source-owners.json", "implementation/traceability.json",
    "docs/implementation/validation.md", "implementation/evidence/dependency-graph.json",
    "implementation/tests/contracts.type-test.ts", "docs/architecture.md", "docs/implementation-spec.md",
    "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json", "packages/extension/tsconfig.json",
    "production-manifest.json", "production-files.txt",
    "production-loc-hashes.json", ".github/workflows/architecture-verification.yml",
    "packages/platform-mac/src/keychain/main.swift", "packages/platform-mac/src/keychain/oma-keychain.entitlements",
    ".github/workflows/native-runtime.yml", ".gitignore",
  ]) assert.ok(files.includes(required), required);
  assert.equal(files.includes("production-loc.json"), false);
  assert.equal(files.includes("production-measurement-hashes.json"), false);
  assert.equal(files.includes("implementation/evidence/runtime-tests.log"), false);
  assert.equal(files.some(file => file.startsWith("docs/archive/")), false);
});

test("R38: package, compiler, owner, spec and workflow changes all change the verification digest", () => {
  const f = fixture();
  try {
    for (const root of VERIFICATION_INPUT_ROOTS) {
      if (["apps", "packages", "test", "scripts", "implementation", "docs", ".github/workflows"].includes(root))
        f.put(`${root}/fixture.ts`);
      else f.put(root, `${root}\n`);
    }
    for (const file of [
      "packages/extension/tsconfig.json",
      "implementation/source-owners.json", "docs/implementation/validation.md",
      "implementation/evidence/dependency-graph.json", "packages/platform-mac/src/keychain/main.swift",
      "docs/implementation-spec.md",
      ".github/workflows/architecture-verification.yml",
    ]) f.put(file, `${file}\n`);
    const before = verificationInputDigest(f.root);
    f.put("apps/fixture.ts");
    for (const file of ["README.md", "package.json", "tsconfig.json", "packages/extension/tsconfig.json", "implementation/source-owners.json", "docs/implementation-spec.md", ".github/workflows/architecture-verification.yml", "apps/fixture.ts", ".gitignore"]) {
      const original = readFileSync(join(f.root, file));
      f.put(file, Buffer.concat([original, Buffer.from("changed\n")]));
      assert.notDeepEqual(verificationInputDigest(f.root), before, file);
      f.put(file, original);
      assert.deepEqual(verificationInputDigest(f.root), before, `${file} did not restore`);
    }
    const validation = readFileSync(join(f.root, "docs/implementation/validation.md"), "utf8");
    f.put("docs/implementation/validation.md", validation.replace("docs/implementation/validation.md", "changed validation input"));
    assert.notDeepEqual(verificationInputDigest(f.root), before);
    f.put("docs/implementation/validation.md", "verification input digest `" + "f".repeat(64) + "` (999 files)\n");
    const selfA = verificationInputDigest(f.root);
    f.put("docs/implementation/validation.md", "verification input digest `" + "0".repeat(64) + "` (1 files)\n");
    assert.deepEqual(verificationInputDigest(f.root), selfA, "the recorded digest field must be normalized");
    const outputBefore = verificationInputDigest(f.root);
    f.put("implementation/evidence/runtime-tests.log", "new runtime output\n");
    f.put("docs/archive/adversarial-review.md", "generated report changed\n");
    assert.deepEqual(verificationInputDigest(f.root), outputBefore, "verification outputs entered their own input digest");
    f.put("implementation/new-gate-input.json", "new input\n");
    assert.notDeepEqual(verificationInputDigest(f.root), outputBefore, "a new implementation input was omitted");
  } finally { f.close(); }
});

test("R38: README link findings cannot change without changing their verification identity", () => {
  const f = fixture();
  try {
    for (const root of VERIFICATION_INPUT_ROOTS) {
      if (["apps", "packages", "test", "scripts", "implementation", "docs", ".github/workflows"].includes(root))
        f.put(`${root}/fixture.ts`);
      else f.put(root, `${root}\n`);
    }
    f.put("README.md", "# Root\n");
    const before = verificationInputDigest(f.root);
    assert.deepEqual(brokenLinks(f.root, projectDocuments(f.root)), []);
    f.put("README.md", "[broken](missing-document.md)\n");
    assert.deepEqual(brokenLinks(f.root, projectDocuments(f.root)), [
      "README.md: missing-document.md names a file that does not exist",
    ]);
    assert.notDeepEqual(verificationInputDigest(f.root), before);
    assert.equal(verificationSourceDigests(f.root)["README.md"],
      createHash("sha256").update(readFileSync(join(f.root, "README.md"))).digest("hex"));
  } finally { f.close(); }
});

test("R38: newly discovered project guidance is bound even when its placement is invalid", () => {
  const f = fixture();
  try {
    for (const root of VERIFICATION_INPUT_ROOTS) {
      if (["apps", "packages", "test", "scripts", "implementation", "docs", ".github/workflows"].includes(root))
        f.put(`${root}/fixture.ts`);
      else f.put(root, `${root}\n`);
    }
    f.put("README.md", "# Root\n");
    const before = verificationInputDigest(f.root);
    f.put("new-guide.md", "# Unregistered current guidance\n");
    assert.deepEqual(documentLayoutFindings(projectDocuments(f.root)), [
      "new-guide.md: project documentation belongs under docs/",
    ]);
    assert.notDeepEqual(verificationInputDigest(f.root), before);
    rmSync(join(f.root, "new-guide.md"));
    assert.deepEqual(verificationInputDigest(f.root), before);
    symlinkSync("README.md", join(f.root, "linked-guide.md"));
    assert.throws(() => verificationInputDigest(f.root), /symlink/);
  } finally { f.close(); }
});

test("DR44: structural rebinding is idempotent and preserves authored outcomes and review claims", () => {
  const f = fixture();
  try {
    for (const root of VERIFICATION_INPUT_ROOTS) {
      if (["apps", "packages", "test", "scripts", "implementation", "docs", ".github/workflows"].includes(root))
        f.put(`${root}/fixture.ts`);
      else f.put(root, `${root}\n`);
    }
    const historical = "Historical runtime PASS for old bytes.\n";
    const binding = "verification input digest `" + "0".repeat(64) + "` (1 files)";
    const path = "docs/implementation/validation.md";
    f.put(path, historical + binding + "\n");
    f.put("implementation/review-notes.json", "authored byte-bound review claim\n");
    const identity = bindVerificationInputs(f.root);
    assert.equal(identity.runtimeProof, false);
    assert.deepEqual({ digest: identity.digest, files: identity.files }, verificationInputDigest(f.root));
    const once = readFileSync(join(f.root, path), "utf8");
    assert.ok(once.startsWith(historical));
    assert.deepEqual(bindVerificationInputs(f.root), identity);
    assert.equal(readFileSync(join(f.root, path), "utf8"), once);
    assert.equal(readFileSync(join(f.root, "implementation/review-notes.json"), "utf8"), "authored byte-bound review claim\n");
    for (const invalid of [historical, once + binding]) {
      f.put(path, invalid);
      assert.throws(() => bindVerificationInputs(f.root), /exactly one/);
      assert.equal(readFileSync(join(f.root, path), "utf8"), invalid, "ambiguous binding was rewritten");
    }
  } finally { f.close(); }
});

test("R38: the lane's bound source is the canonical closure -- committed digests in, CI artifacts out", () => {
  // K63/AV-20261003-30: verify-lane once listed `production-loc.json` at the
  // repo root, where it never exists -- the binding was vacuous, and the
  // measurement-hashes sibling was named nowhere. The lane now binds
  // `verificationSourceDigests`: the canonical closure, raw bytes (a checker
  // re-reads the file and must get this digest).
  const digests = verificationSourceDigests(REPO);
  const hashOf = path => createHash("sha256").update(readFileSync(join(REPO, path))).digest("hex");
  for (const committed of ["README.md", "production-manifest.json", "production-files.txt", "production-loc-hashes.json",
    "package.json", "tsconfig.json", ".github/workflows/architecture-verification.yml"])
    assert.equal(digests[committed], hashOf(committed), `${committed} must be bound by its real bytes`);
  assert.equal(digests["production-loc.json"], undefined, "a CI artifact is never a bound input");
  assert.equal(digests["production-measurement-hashes.json"], undefined, "a CI artifact is never a bound input");
  assert.equal(Object.keys(digests).length, verificationInputFiles(REPO).length);
  for (const [file, value] of Object.entries(digests)) assert.match(value, /^[0-9a-f]{64}$/, file);
  // And verify-lane must not keep a second, divergent root list: it calls the
  // shared closure.
  const lane = readFileSync(new URL("../scripts/verify-lane.mjs", import.meta.url), "utf8");
  assert.match(lane, /verificationSourceDigests\(/);
  assert.equal(lane.includes('"production-loc.json"'), false, "the vacuous root binding is back");
  // A declared input that is missing must fail, not bind vacuously.
  const f = fixture();
  try {
    for (const root of VERIFICATION_INPUT_ROOTS) {
      if (["apps", "packages", "test", "scripts", "implementation", "docs", ".github/workflows"].includes(root))
        f.put(`${root}/fixture.ts`);
      else f.put(root, `${root}\n`);
    }
    assert.doesNotThrow(() => verificationSourceDigests(f.root));
    rmSync(join(f.root, "production-loc-hashes.json"));
    assert.throws(() => verificationSourceDigests(f.root), "a missing declared input bound vacuously");
  } finally { f.close(); }
});

test("R38: the validation record names the verification inputs that were run, by their bytes", () => {
  const record = readFileSync(new URL("../docs/implementation/validation.md", import.meta.url), "utf8");
  const quoted = [...record.matchAll(/verification input digest `([0-9a-f]{64})` \((\d+) files\)/g)]
    .map(([, value, files]) => ({ digest: value, files: Number(files) }));
  assert.equal(quoted.length, 1, "the validation record names no verification input digest, or more than one");
  assert.deepEqual(quoted[0], verificationInputDigest(REPO),
    "the validation record names verification inputs that are not this tree's");
});

test("R38: the figures the validation record quotes remain historical; current LOC is CI-generated evidence", () => {
  // A historical number must not acquire the authority of a current source
  // measurement when LOC evidence moves from committed input to CI artifacts.
  const record = readFileSync(new URL("../docs/implementation/validation.md", import.meta.url), "utf8");
  const digests = JSON.parse(readFileSync(new URL("../production-loc-hashes.json", import.meta.url), "utf8"));
  const quoted = [...record.matchAll(/(\d+) files \/ ([\d,]+) code LOC/g)]
    .map(([, files, code]) => ({ files: Number(files), code: Number(code.replaceAll(",", "")) }));
  assert.ok(quoted.length > 0, "the validation record quotes no LOC figure at all");
  assert.match(record, /역사적 기록은 현재 source의 LOC claim이 아니며/);
  assert.match(record, /CI artifact `production-loc\.json`과 `production-measurement-hashes\.json`/);
  assert.equal(digests.kind, "oma-production-source-digests-v1");
  assert.deepEqual(Object.keys(digests).sort(), ["files", "kind", "manifest"]);
  assert.equal(VERIFICATION_INPUT_ROOTS.includes("production-loc.json"), false);
  assertSourceDigests(REPO);
});
