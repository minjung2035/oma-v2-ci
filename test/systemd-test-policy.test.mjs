import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  lanes,
  localTestFiles,
  systemdTestFiles,
} from "../scripts/verification-lanes.mjs";

test("V04 local selection never claims systemd tests passed or removes their required lanes", () => {
  const local = "systemd-cleanup.test.js";
  assert.deepEqual(localTestFiles([...systemdTestFiles, local]), [local]);
  for (const file of systemdTestFiles)
    assert.ok(
      lanes.kernel.files.includes(file) || lanes.crash.files.includes(file),
    );
  assert.equal(lanes.all.files, "all");
  assert.throws(
    () => localTestFiles([local]),
    /required systemd test file missing/,
  );
});
test("V04 missing explicit manager opt-in yields BLOCKED NOT_RUN before any manager invocation", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-blocked-lane-"));
  try {
    const bin = join(root, "bin");
    mkdirSync(bin);
    const marker = join(root, "manager-called");
    writeFileSync(
      join(bin, "systemctl"),
      `#!/bin/sh\necho called > '${marker}'\necho fake\n`,
      { mode: 0o700 },
    );
    const out = join(root, "result");
    const result = spawnSync(
      process.execPath,
      ["scripts/verify-lane.mjs", "kernel", "--out", out],
      {
        env: {
          ...process.env,
          OMA_TEST_SYSTEMD: "0",
          PATH: `${bin}:${process.env.PATH}`,
        },
        encoding: "utf8",
        timeout: 20000,
      },
    );
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(readFileSync(join(out, "result.json"), "utf8"));
    assert.equal(report.status, "BLOCKED");
    assert.equal(report.execution, "NOT_RUN");
    assert.match(report.failure, /explicit OMA_TEST_SYSTEMD=1/);
    assert.equal(existsSync(marker), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("V04 local guard rejects manager commands before execution but allows ordinary subprocesses", () => {
  const guard = new URL("../scripts/local-test-guard.mjs", import.meta.url)
    .href;
  const script = `import assert from 'node:assert/strict';
    import cp, { spawn, spawnSync, execFile, execFileSync, exec, execSync } from 'node:child_process';
    import { promisify } from 'node:util';
    for (const method of [spawn, spawnSync, execFile, execFileSync]) {
      assert.throws(() => method('/usr/bin/systemctl', ['--user', 'show']), /BLOCKED/);
      assert.throws(() => method('systemd-run', ['--user']), /BLOCKED/);
      for (const shell of ['/bin/sh', '/bin/bash', 'dash', 'zsh'])
        assert.throws(() => method(shell, ['-c', 'systemctl --user show']), /BLOCKED/);
      assert.throws(() => method('echo', ['safe'], { shell: true }), /BLOCKED/);
      for (const wrapper of ['env', 'nice', 'timeout', 'nohup']) {
        assert.throws(() => method(wrapper, ['systemctl', '--user', 'show']), /BLOCKED/);
        assert.throws(() => method(wrapper, ['/bin/sh', '-c', 'echo harmless']), /BLOCKED/);
      }
    }
    for (const method of [exec, execSync, cp.exec, cp.execSync]) {
      assert.throws(() => method('systemctl --user show'), /BLOCKED/);
      assert.throws(() => method('syste' + 'mctl --user show'), /BLOCKED/);
      assert.throws(() => method('echo harmless'), /BLOCKED/);
    }
    await assert.rejects(promisify(exec)('systemctl --user show'), /BLOCKED/);
    assert.equal(spawnSync(process.execPath, ['-e', 'process.exit(0)']).status, 0);`;
  const result = spawnSync(
    process.execPath,
    ["--import", guard, "--input-type=module", "-e", script],
    { encoding: "utf8", timeout: 10000 },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.signal, null);
});

test("V04 S-01 qualification uses freshly built production code", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-qualification-lane-"));
  const guard = new URL("../scripts/local-test-guard.mjs", import.meta.url).href;
  try {
    // Copy unchanged production quota code and its runtime dependencies (errors
    // names its detail vocabulary through capabilities and identifiers, DR3).
    // Build only this closure in an owned fixture: never rewrite shared dist.
    mkdirSync(join(root, "src/domain"), { recursive: true });
    mkdirSync(join(root, "dist/src/domain"), { recursive: true });
    mkdirSync(join(root, "scripts"));
    const names = ["resources", "integer-fields", "errors", "capabilities", "identifiers"];
    for (const name of names) writeFileSync(join(root, `src/domain/${name}.ts`),
      readFileSync(new URL(`../src/domain/${name}.ts`, import.meta.url)));
    writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module", scripts: { build: "node scripts/build.mjs" } }));
    const tsUrl = new URL("../node_modules/typescript/lib/typescript.js", import.meta.url).href;
    writeFileSync(join(root, "scripts/build.mjs"), `import ts from ${JSON.stringify(tsUrl)};
      import { readFileSync, writeFileSync } from 'node:fs';
      for (const name of ${JSON.stringify(names)}) {
        const source = readFileSync('src/domain/' + name + '.ts', 'utf8');
        const result = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
        writeFileSync('dist/src/domain/' + name + '.js', result.outputText);
      }`);
    writeFileSync(join(root, "dist/src/domain/resources.js"), 'throw new Error("stale artifact used");');
    const build = spawnSync(process.execPath, ["scripts/build.mjs"], { cwd: root, env: { ...process.env, NODE_OPTIONS: `--import=${guard}` }, encoding: "utf8", timeout: 20000 });
    assert.equal(build.status, 0, build.stderr);
    const probe = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/probe-entry-qualification.mjs", import.meta.url)), root, "1048576"], {
      cwd: root, env: { ...process.env, NODE_OPTIONS: `--import=${guard}` }, encoding: "utf8", timeout: 10000,
    });
    assert.equal(probe.status, 0, probe.stderr);
    assert.notEqual(readFileSync(join(root, "dist/src/domain/resources.js"), "utf8"), 'throw new Error("stale artifact used");');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("V04 P24 owner and durable regressions remain required lane coverage", () => {
  assert.ok(lanes.fast.files.includes("p24-owner-guards.test.js"));
  for (const name of ["V03-S1", "V03-S2", "V03-S3", "P08:", "A02:"]) assert.ok(lanes.fast.requiredNames.includes(name));
  for (const file of ["p24-deployment-gates.test.js", "p24-mail-boundaries.test.js", "p24-git-import.test.js"])
    assert.ok(lanes.durable.files.includes(file));
  for (const name of ["P01:", "P02:", "P03:", "P04:", "P05:", "P06:", "P07: sha1", "P07: sha256"])
    assert.ok(lanes.durable.requiredNames.includes(name));
});
