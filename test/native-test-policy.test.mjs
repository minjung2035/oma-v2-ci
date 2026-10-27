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
  serialTestFiles,
  nativeExecutionTestFiles,
} from "../scripts/verification-lanes.mjs";

test("NATIVE-VERIFY-01: native execution tests are required and never excluded from local discovery", () => {
  const files = [...nativeExecutionTestFiles, "domain-policy.test.js"];
  assert.deepEqual(localTestFiles(files), files);
  for (const file of nativeExecutionTestFiles) {
    assert.ok(lanes.kernel.files.includes(file));
    assert.throws(() => localTestFiles(files.filter(value => value !== file)), /required native execution test file missing/);
  }
  assert.equal(lanes.all.files, "all");
  assert.equal(lanes.kernel.environment, "linux-native");
});
test("NATIVE-VERIFY-02: local guard rejects manager commands before execution but allows ordinary subprocesses", () => {
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

test("NATIVE-VERIFY-03: P24 owner and durable regressions remain required lane coverage", () => {
  assert.ok(lanes.fast.files.includes("p24-owner-guards.test.js"));
  for (const name of ["V03-S1", "V03-S2", "V03-S3", "P08:", "A02:"]) assert.ok(lanes.fast.requiredNames.includes(name));
  for (const file of ["p24-deployment-gates.test.js", "p24-mail-boundaries.test.js", "p24-git-import.test.js"])
    assert.ok(lanes.durable.files.includes(file));
  for (const name of ["P01:", "P02:", "P03:", "P04:", "P05:", "P06:", "P07: sha1", "P07: sha256"])
    assert.ok(lanes.durable.requiredNames.includes(name));
});

/* FJ-9: the local runner's hygiene -- a serial entry that names a file no
 * longer in the suite fails loudly instead of silently losing its isolation,
 * and any argument is refused instead of silently running everything. */

/** A minimal repo-shaped fixture: dist/test and test name sets that agree,
 * the required native files present, and optionally the serial files. */
function localRunnerFixture(root, { serial = true } = {}) {
  mkdirSync(join(root, "packages"), { recursive: true });
  mkdirSync(join(root, "dist", "test"), { recursive: true });
  mkdirSync(join(root, "test"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  const stub = `import test from "node:test";\ntest("stub", () => {});\n`;
  const files = [...nativeExecutionTestFiles, "smoke.test.js"];
  if (serial) files.push(...serialEntries());
  for (const file of files) {
    writeFileSync(join(root, "dist", "test", file), stub);
    writeFileSync(join(root, "test", file.replace(/\.js$/, ".ts")), stub);
  }
}
/** The serial names the real runner isolates, read from its own source so the
 * fixture tracks the list it exercises. */
function serialEntries() {
  const source = readFileSync(new URL("../scripts/test-local.mjs", import.meta.url), "utf8");
  return [...source.matchAll(/"(dist\/test\/[^"]+\.test\.js)"/g)].map(match => match[1].slice("dist/test/".length));
}
const TEST_LOCAL = fileURLToPath(new URL("../scripts/test-local.mjs", import.meta.url));
function runLocal(root, args) {
  // A spawned node --test inherits NODE_TEST_CONTEXT* and believes it is a
  // nested test file rather than the driver: it "skips running files". The
  // fixture is a suite of its own, so the context is stripped like a real
  // invocation's.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("NODE_TEST_CONTEXT")));
  return spawnSync(process.execPath, [TEST_LOCAL, ...args], { cwd: root, env, encoding: "utf8", timeout: 60000 });
}

test("FJ-9: serialTestFiles returns only discovered files, and a missing entry fails by name", () => {
  assert.deepEqual(serialTestFiles(["dist/test/a.test.js"], new Set(["dist/test/a.test.js"])), ["dist/test/a.test.js"]);
  assert.throws(
    () => serialTestFiles(["dist/test/a.test.js"], new Set(["dist/test/a.test.js", "dist/test/renamed-away.test.js"])),
    /serial test files missing from the discovered suite: dist\/test\/renamed-away\.test\.js/);
});

test("FJ-9: a serial entry left behind by a removed test stops the run, not the isolation", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-testlocal-serial-"));
  try {
    // The fixture's suite has no serial files at all: every real SERIAL entry
    // is drift here, and the audited filter would have run them as nothing.
    localRunnerFixture(root, { serial: false });
    const result = runLocal(root, []);
    assert.equal(result.status, 1, `the drift was refused:\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /serial test files missing from the discovered suite/);
    assert.match(result.stderr, /status-responsiveness\.test\.js/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FJ-9: the runner refuses argv instead of silently running the whole suite", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-testlocal-argv-"));
  try {
    localRunnerFixture(root);
    const result = runLocal(root, ["priority-0"]);
    assert.equal(result.status, 1, `the stray argument was refused:\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /takes no arguments/);
    assert.match(result.stderr, /priority-0/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FJ-9: a complete fixture still runs serial and parallel phases to a pass", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-testlocal-healthy-"));
  try {
    localRunnerFixture(root);
    const result = runLocal(root, []);
    assert.equal(result.status, 0, `the healthy fixture passed:\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /LOCAL ONLY: \d+ files \(\d+ parallel at concurrency \d+, \d+ serial\)/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
