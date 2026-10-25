import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import ts from "typescript";
import { analyzeProgram, createArchitectureProgram, DEFAULT_POLICY } from "../scripts/architecture-check.mjs";

const boundaryRules = new Set(["pure-boundary-import", "subprocess-owner", "sqlite-owner"]);
test("R34 C04: actual source imports agree with the concrete default owner policy", () => {
  const program = createArchitectureProgram(process.cwd());
  const findings = analyzeProgram(program).filter(finding => boundaryRules.has(finding.rule));
  assert.deepEqual(findings, [], JSON.stringify(findings, null, 2));
});
function analyze(files) {
  const root = mkdtempSync(join(tmpdir(), "oma-owner-policy-"));
  try {
    const names = Object.entries(files).map(([name, contents]) => {
      const absolute = join(root, name);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, contents);
      return absolute;
    });
    const program = ts.createProgram(names, { noEmit: true, noLib: true, module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext });
    return analyzeProgram(program, { rootDir: root, checkContracts: false }).filter(finding => boundaryRules.has(finding.rule));
  } finally { rmSync(root, { recursive: true, force: true }); }
}
test("R34 C04: mixed runtime transport import is allowed only at the actual channel owner", () => {
  const net = 'import { connect, type Socket } from "node:net"; export { connect };';
  assert.deepEqual(analyze({ "packages/client/src/channel.ts": net }), []);
  assert.equal(analyze({ "packages/protocol/src/codec.ts": net })[0]?.rule, "pure-boundary-import");
  assert.equal(analyze({ "packages/domain/src/channel.ts": net })[0]?.rule, "pure-boundary-import");
  assert.deepEqual(analyze({ "packages/protocol/src/codec.ts": 'import type { Socket } from "node:net"; export type Peer = Socket;' }), []);
});
test("R34 C04: transport permission does not authorize filesystem, subprocess, SQLite or Store imports", () => {
  for (const module of ["node:fs", "node:child_process", "node:sqlite"]) {
    const findings = analyze({ "packages/client/src/channel.ts": `import "${module}";` });
    assert.ok(findings.some(finding => finding.rule === "pure-boundary-import"), module);
  }
  const findings = analyze({ "packages/client/src/channel.ts": "import { Store } from \"../../storage/src/store.js\"; export { Store };",
    "packages/storage/src/store.ts": "export class Store {}" });
  assert.ok(findings.some(finding => finding.rule === "pure-boundary-import"));
});
test("R34 C04: native execution is restricted to named responsibilities, not a directory wildcard", () => {
  for (const file of DEFAULT_POLICY.subprocessOwners)
    assert.deepEqual(analyze({ [file]: 'import { spawn } from "node:child_process"; export { spawn };' }), []);
  for (const file of ["packages/process/src/another.ts", "packages/git/src/submit.ts", "apps/oma/src/units/execute.ts", "packages/protocol/src/another.ts"]) {
    const findings = analyze({ [file]: 'import { spawn } from "node:child_process"; export { spawn };' });
    assert.ok(findings.some(finding => finding.rule === "subprocess-owner"), file);
  }
  assert.deepEqual(DEFAULT_POLICY.sqliteOwners, ["packages/storage/src/store.ts"]);
});
