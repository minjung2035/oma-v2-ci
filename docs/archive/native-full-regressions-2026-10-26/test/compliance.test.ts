import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, lstatSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";

test("COMP-005/006: structural evidence rejects stale, incomplete and duplicate records", { timeout: 120000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-compliance-"));
  const script = resolve("scripts/compliance.mjs");
  const reportScript = resolve("scripts/adversarial-report.mjs");
  const put = (file: string, text: string) => {
    mkdirSync(dirname(join(dir, file)), { recursive: true }); writeFileSync(join(dir, file), text);
  };
  const hash = (file: string) => createHash("sha256").update(readFileSync(join(dir, file))).digest("hex");
  const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024 });
  const report = () => spawnSync(process.execPath, [reportScript], { cwd: dir, encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024 });
  const trace = "implementation/traceability.json";
  const roots = ["apps/oma/src/entry/broker.ts", "apps/oma/src/entry/runner.ts", "apps/oma/src/entry/host.ts", "apps/oma/src/cli.ts", "packages/extension/src/index.ts"];
  const matrix = (first: number, last: number) => Array.from({ length: last - first + 1 }, (_, index) =>
    `| T${String(index + first).padStart(2, "0")} / fixture | synthetic structural oracle, not production evidence |`).join("\n");
  const sourceWalk = (path: string): string[] => {
    if (lstatSync(join(dir, path)).isFile()) return [path];
    return readdirSync(join(dir, path)).sort().filter(name =>
      !(path === "implementation" && name === "evidence") && !(path === "docs" && name === "archive"))
      .flatMap(name => sourceWalk(`${path}/${name}`));
  };
  try {
    const sources = ["docs/implementation-spec.md", "docs/implementation/integration-policy.md",
      "docs/verification-spec.md", "docs/macos-platform.md"];
    for (const file of sources) put(file, "**MUST [TEST-001]** Reject absent proof.\n");
    const matrixText = "**MUST [TEST-001]** Reject absent proof.\n\n" + matrix(1, 77) + "\n\n" + matrix(78, 90) + "\n";
    put("docs/verification-spec.md", matrixText);
    put("docs/architecture.md", "Synthetic normative baseline for checker controls only.\n");
    put("package.json", JSON.stringify({ type: "module" })); put("package-lock.json", "{}\n");
    put("tsconfig.json", JSON.stringify({ compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", target: "ES2022" }, include: ["apps/oma/src/**/*.ts"] }));
    put("tsconfig.build.json", JSON.stringify({ extends: "./tsconfig.json" }));
    put("production-manifest.json", JSON.stringify(["apps/oma/src", "packages/extension/src"]));
    put("apps/oma/src/owner.ts", "export function effect() {}\n"); put("apps/oma/src/entry.ts", "export {};\n");
    put("apps/oma/src/dependency.ts", "export const dependency = 1;\n"); put("test/negative.ts", "export const reject = true;\n");
    for (const root of roots) put(root, "export {};\n");
    put("production-files.txt", ["apps/oma/src/owner.ts", "apps/oma/src/entry.ts", "apps/oma/src/dependency.ts", ...roots].sort().join("\n") + "\n");
    put("implementation/source-owners.json", "[]\n");
    for (const name of ["compliance.mjs", "adversarial-report.mjs", "traceability.mjs", "architecture-check.mjs"])
      put(`scripts/${name}`, readFileSync(resolve("scripts", name), "utf8"));
    put("run.log", "synthetic log: this is not production evidence\n");
    assert.equal(run("--inventory").status, 0);
    const rows = JSON.parse(readFileSync(join(dir, trace), "utf8"));
    assert.equal(rows.length, sources.length); assert.equal(run().status, 1);
    const authored = ["apps", "packages", "test", "scripts", "implementation", "docs"].flatMap(sourceWalk)
      .filter(file => file !== trace);
    const inputs = [...new Set([...authored, ...sources, "docs/architecture.md", "production-files.txt", "production-manifest.json", "package.json", "package-lock.json", "tsconfig.json", "tsconfig.build.json"])];
    const sourceDigests = Object.fromEntries(inputs.map(file => [file, hash(file)]));
    for (const row of rows) Object.assign(row, {
      applicability: "runtime", status: "proven", rationale: "synthetic checker fixture only",
      owner: "apps/oma/src/owner.ts#effect", entrypoint: "apps/oma/src/entry.ts",
      callPath: ["apps/oma/src/entry.ts", "apps/oma/src/owner.ts#effect"], negativeTests: ["test/negative.ts#reject"],
      evidence: { specDigest: row.digest, buildExit: 0, testExit: 0, buildCommand: "fixture build", testCommand: "fixture test", environmentPin: "synthetic",
        logPath: "run.log", logDigest: hash("run.log"), sourceDigests },
    });
    const save = (value: unknown = rows) => put(trace, JSON.stringify(value));
    save();
    const positive = run(); assert.equal(positive.status, 0, positive.stderr + positive.stdout);
    assert.equal(run("--inventory").status, 0);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, trace), "utf8")), rows, "refresh preserves reviewed records");
    for (const change of [
      { applicability: "invented" }, { rationale: "" }, { callPath: [] }, { owner: "apps/oma/src/owner.ts" },
      { negativeTests: "not an array" }, { status: "not_applicable" }, { evidence: { ...rows[0].evidence, sourceDigests: {} } },
    ]) {
      save([{ ...rows[0], ...change }, ...rows.slice(1)]); assert.equal(run().status, 1, JSON.stringify(change));
    }
    save(rows.slice(1)); assert.equal(run().status, 1, "a missing record cannot be synthesized into proof");
    save([...rows, rows[0]]); assert.equal(run().status, 1, "duplicate identity rejected");
    save([...rows, { ...rows[0], digest: "outdated" }]); assert.equal(run().status, 1, "extra malformed fingerprint rejected");
    save([...rows, { ...rows[0], digest: "f".repeat(64) }]); assert.equal(run().status, 1, "well-formed extra stale fingerprint rejected");
    save();
    put("apps/oma/src/dependency.ts", "export const dependency = 2;\n");
    assert.equal(run().status, 1, "unchanged owner cannot hide a changed dependency");
    put("apps/oma/src/dependency.ts", "export const dependency = 1;\n");
    put("test/new-negative.ts", "export const newlyRequiredOracle = true;\n");
    assert.equal(run().status, 1, "a newly added negative test is part of the source closure");
    rmSync(join(dir, "test/new-negative.ts"));
    put("implementation/source-owners.json", JSON.stringify([{ source: sources[0], requirements: ["TEST-001"], owner: "apps/oma/src/dependency.ts#dependency",
      entrypoint: "apps/oma/src/entry.ts#main", callPath: ["apps/oma/src/entry.ts#main", "apps/oma/src/dependency.ts#dependency"], negativeTests: ["test/negative.ts#reject"] }]));
    assert.equal(run("--inventory").status, 0);
    const relinked = JSON.parse(readFileSync(join(dir, trace), "utf8"));
    assert.equal(relinked[0].status, "unverified"); assert.equal(relinked[0].evidence, null);
    assert.equal(relinked[0].digest, rows[0].digest, "relinking must not forge a new normative digest");
    put("implementation/source-owners.json", "[]\n"); save();
    put(sources[0]!, "**MUST [TEST-001]** Changed contract.\n");
    assert.equal(run("--inventory").status, 0);
    const refreshed = JSON.parse(readFileSync(join(dir, trace), "utf8"));
    assert.equal(refreshed[0].status, "unverified", "changed clause loses old proof");
    const traceBeforeReport = readFileSync(join(dir, trace), "utf8");
    put("implementation/evidence/audit-source-pins.json", "{\"historical\":\"must-not-be-rebound\"}\n");
    const originalPins = readFileSync(join(dir, "implementation/evidence/audit-source-pins.json"), "utf8");
    const inventoryControl = report(); assert.equal(inventoryControl.status, 0, inventoryControl.stderr);
    assert.equal(readFileSync(join(dir, trace), "utf8"), traceBeforeReport, "report is not an implicit inventory rewrite");
    assert.equal(readFileSync(join(dir, "implementation/evidence/audit-source-pins.json"), "utf8"), originalPins);
    put(roots[0]!, "import '../../../../test/negative.js';\n");
    const escaped = report(); assert.equal(escaped.status, 1, escaped.stderr);
    assert.match(escaped.stdout, /2 static import-closure findings/);
    const review = readFileSync(join(dir, "docs/archive/adversarial-review.md"), "utf8");
    assert.match(review, /Production imports a test: test\/negative.ts/);
    assert.match(review, /NOT_RUN/); assert.doesNotMatch(review, /runtime\/regression suite executed/);
    assert.equal(readFileSync(join(dir, trace), "utf8"), traceBeforeReport);
    put(roots[0]!, "export {};\n");
    put("docs/verification-spec.md", "**MUST [TEST-001]** Reject absent proof.\n\n" + matrix(1, 77) + "\n");
    assert.equal(report().status, 1, "complete core cannot hide missing tiered target rows");
    put("docs/verification-spec.md", matrixText + matrix(78, 78) + "\n");
    assert.equal(report().status, 1, "duplicate tiered row is not another proof");
    put("docs/verification-spec.md", "| T01 / fixture | synthetic oracle |\n");
    assert.equal(report().status, 1, "missing acceptance rows cannot disappear from the report");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
