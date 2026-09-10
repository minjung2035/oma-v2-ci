import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";

test("COMP-005/006: structural evidence rejects stale, incomplete and duplicate records", () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-compliance-"));
  const script = resolve("scripts/compliance.mjs");
  const put = (file: string, text: string) => {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  };
  const hash = (file: string) => createHash("sha256").update(readFileSync(join(dir, file))).digest("hex");
  const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: "utf8" });
  const trace = "implementation/traceability.json";
  try {
    const sources = ["implementation-spec.md", "implementation/integration-policy.md",
      "implementation/physical-ordering.md", "implementation/compliance.md", "implementation/loc-budget.md",
      "implementation/test-matrix.md", "implementation/spikes.md", "implementation/validation.md"];
    for (const file of sources) put(file, "**MUST [TEST-001]** Reject absent proof.\n");
    const pins = ["architecture.md", "package.json", "package-lock.json",
      "src/owner.ts", "src/entry.ts", "src/dependency.ts", "test/negative.ts"];
    for (const file of pins) put(file, "synthetic structural-check fixture\n");
    put("production-files.txt", "src/owner.ts\nsrc/entry.ts\nsrc/dependency.ts\n");
    put("run.log", "synthetic log: this is not production evidence\n");
    assert.equal(run("--inventory").status, 0);
    const rows = JSON.parse(readFileSync(join(dir, trace), "utf8"));
    assert.equal(rows.length, sources.length);
    assert.equal(run().status, 1);
    const sourceDigests = Object.fromEntries([...sources, ...pins, "production-files.txt"].map((file) => [file, hash(file)]));
    for (const row of rows) Object.assign(row, {
      applicability: "runtime", status: "proven", rationale: "synthetic checker fixture only",
      owner: "src/owner.ts#effect", entrypoint: "src/entry.ts",
      callPath: ["src/entry.ts", "src/owner.ts#effect"], negativeTests: ["test/negative.ts#reject"],
      evidence: { specDigest: row.digest, buildExit: 0, testExit: 0,
        buildCommand: "fixture build", testCommand: "fixture test", environmentPin: "synthetic",
        logPath: "run.log", logDigest: hash("run.log"), sourceDigests },
    });
    const save = (value: unknown = rows) => put(trace, JSON.stringify(value));
    save();
    assert.equal(run().status, 0, "the structural positive control must pass");
    assert.equal(run("--inventory").status, 0);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, trace), "utf8")), rows, "refresh preserves reviewed records");
    for (const change of [
      { applicability: "invented" }, { rationale: "" }, { callPath: [] },
      { owner: "src/owner.ts" }, { negativeTests: "not an array" },
      { status: "not_applicable" }, { evidence: { ...rows[0].evidence, sourceDigests: {} } },
    ]) {
      save([{ ...rows[0], ...change }, ...rows.slice(1)]);
      assert.equal(run().status, 1, JSON.stringify(change));
    }
    save([...rows, rows[0]]);
    assert.equal(run().status, 1, "duplicate identity rejected");
    save([...rows, { ...rows[0], digest: "outdated" }]);
    assert.equal(run().status, 1, "extra stale identity rejected");
    save();
    put("src/dependency.ts", "changed dependency\n");
    assert.equal(run().status, 1, "unchanged owner does not hide a changed dependency");
    put(sources[0]!, "**MUST [TEST-001]** Changed contract.\n");
    assert.equal(run("--inventory").status, 0);
    const refreshed = JSON.parse(readFileSync(join(dir, trace), "utf8"));
    assert.equal(refreshed[0].status, "unverified", "changed clause loses old proof");
    // The whole-scope report must expose dependency escapes, never promote proof.
    const reportScript = resolve("scripts/adversarial-report.mjs");
    const roots = ["src/entry/broker.ts", "src/entry/runner.ts", "src/entry/host.ts", "src/cli.ts", "src/pi-extension.ts"];
    put("tsconfig.json", JSON.stringify({ compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext" } }));
    put("package.json", JSON.stringify({ type: "module" }));
    for (const root of roots) put(root, "export {};\n");
    put(roots[0]!, "import '../../test/negative.js';\n");
    put("test/negative.ts", "export const sentinel = 1;\n");
    put("production-files.txt", roots.join("\n") + "\n");
    put("scripts/compliance.mjs", readFileSync(script, "utf8"));
    put("scripts/adversarial-report.mjs", readFileSync(reportScript, "utf8"));
    mkdirSync(join(dir, "implementation/evidence"), { recursive: true });
    put("implementation/test-matrix.md", Array.from({ length: 77 }, (_, i) => `| T${String(i + 1).padStart(2, "0")} / fixture | synthetic oracle |`).join("\n"));
    const report = spawnSync(process.execPath, [reportScript], { cwd: dir, encoding: "utf8" });
    assert.equal(report.status, 0, report.stderr);
    assert.match(report.stdout, /2 static import-closure findings/);
    assert.match(readFileSync(join(dir, "implementation/adversarial-review.md"), "utf8"), /Production imports a test: test\/negative.ts/);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, trace), "utf8")).map((row: { status: string }) => row.status), refreshed.map((row: { status: string }) => row.status));
    put("implementation/test-matrix.md", "| T01 / fixture | synthetic oracle |\n");
    assert.equal(spawnSync(process.execPath, [reportScript], { cwd: dir, encoding: "utf8" }).status, 1, "missing acceptance rows cannot disappear from the report");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
