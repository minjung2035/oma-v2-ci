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
  readdirSync,
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

test("001. Native execution tests are required and never excluded from local discovery", () => {
  const files = [...nativeExecutionTestFiles, "domain-policy.test.js"];
  assert.deepEqual(localTestFiles(files), files);
  for (const file of nativeExecutionTestFiles) {
    assert.ok(lanes.kernel.files.includes(file));
    assert.throws(() => localTestFiles(files.filter(value => value !== file)), /required native execution test file missing/);
  }
  assert.equal(lanes.all.files, "all");
  assert.equal(lanes.kernel.environment, "linux-native");
});
test("002. Local guard rejects manager commands before execution but allows ordinary subprocesses", () => {
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

test("003. Owner and durable regressions remain required lane coverage", () => {
  assert.ok(lanes.fast.files.includes("p24-owner-guards.test.js"));
  for (const name of ["001. Durable plan owner itself rejects a mismatched resolved spec digest", "002. Acceptance authority owner checks durable capability independently of a permissive live lease", "003. Store update owner forbids every retired state exit without workflow help", "004. Missing activation gates fail at construction and an explicit closed gate emits no start effect", "005. A second same-process lock open cannot borrow the first descriptor's authority"]) assert.ok(lanes.fast.requiredNames.includes(name));
  for (const file of ["p24-deployment-gates.test.js", "p24-mail-boundaries.test.js", "p24-git-import.test.js"])
    assert.ok(lanes.durable.files.includes(file));
  for (const name of ["005. Native storage exhaustion has STORAGE_FULL vocabulary, never a terminal accepted failure",
    "006. Staging exhaustion plus cleanup flush failure remains preaccept STORAGE_FULL", "001. Canonical deployment manifest pins every selected byte independent of root and traversal order",
    "002. Installed broker refuses deployment mismatch BEFORE SQLite or unit effects", "001. Immutable observation distinguishes present, absent, unavailable and corrupt",
    "002. Unavailable recovery retains reason and pending evidence, then converges", "003. First cur parent flush precedes removing new; a flush fault preserves prepared recovery", "003. Symlinked host ancestors are explicitly unsupported, not store corruption", "004. Successful and concurrent sends leave no per-request directory or staging alias", "001. Git import: sha1", "001. Git import: sha256"])
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
function runLocal(root, args, overrides = {}) {
  // A spawned node --test inherits NODE_TEST_CONTEXT* and believes it is a
  // nested test file rather than the driver: it "skips running files". The
  // fixture is a suite of its own, so the context is stripped like a real
  // invocation's.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("NODE_TEST_CONTEXT")));
  return spawnSync(process.execPath, [TEST_LOCAL, ...args], { cwd: root, env: { ...env, ...overrides }, encoding: "utf8", timeout: 60000 });
}

test("004. SerialTestFiles returns only discovered files, and a missing entry fails by name", () => {
  assert.deepEqual(serialTestFiles(["dist/test/a.test.js"], new Set(["dist/test/a.test.js"])), ["dist/test/a.test.js"]);
  assert.throws(
    () => serialTestFiles(["dist/test/a.test.js"], new Set(["dist/test/a.test.js", "dist/test/renamed-away.test.js"])),
    /serial test files missing from the discovered suite: dist\/test\/renamed-away\.test\.js/);
});

test("005. A serial entry left behind by a removed test stops the run, not the isolation", () => {
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

test("006. The runner refuses argv instead of silently running the whole suite", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-testlocal-argv-"));
  try {
    localRunnerFixture(root);
    const result = runLocal(root, ["priority-0"]);
    assert.equal(result.status, 1, `the stray argument was refused:\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /takes no arguments/);
    assert.match(result.stderr, /priority-0/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("007. A complete fixture still runs serial and parallel phases to a pass", () => {
  assert.ok(serialEntries().includes("contained-tools.test.js"), "real child progress deadlines need their declared CPU isolation");
  const root = mkdtempSync(join(tmpdir(), "oma-testlocal-healthy-"));
  try {
    localRunnerFixture(root);
    const result = runLocal(root, []);
    assert.equal(result.status, 0, `the healthy fixture passed:\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /LOCAL ONLY: \d+ files \(\d+ parallel at concurrency \d+, \d+ serial\)/);
    const timingPath = join(root, ".scratch/local-test-durations.tsv");
    const timings = readFileSync(timingPath, "utf8");
    assert.match(timings, /dist\/test\/smoke\.test\.js\t[\d.]+/);
    // A stale cache changes order only: changed tests must still execute and
    // files outside the discovered inventory must never be admitted by it.
    writeFileSync(timingPath, timings + "not-a-test.js\t999999\ndist/test/smoke.test.js\t999999\n");
    writeFileSync(join(root, "dist/test/smoke.test.js"),
      `import test from 'node:test'; test('changed since cached pass', () => { throw new Error('fresh failure'); });`);
    const started = join(root, "started.txt");
    for (const file of readdirSync(join(root, "dist/test"))) {
      if (serialEntries().includes(file)) continue;
      const path = join(root, "dist/test", file);
      writeFileSync(path, `import {appendFileSync} from 'node:fs'; appendFileSync(${JSON.stringify(started)}, ${JSON.stringify(file + "\n")});\n` + readFileSync(path, "utf8"));
    }
    const changed = runLocal(root, [], { OMA_TEST_CONCURRENCY: "1" });
    const evidence = /Raw TAP retained for the failed or incomplete run: (.+)/.exec(changed.stderr)?.[1];
    try {
      assert.equal(changed.status, 1, changed.stderr);
      assert.ok(evidence, changed.stderr);
      assert.match(readFileSync(join(evidence, "summary-parallel.tap"), "utf8"), /fresh failure/);
      assert.doesNotMatch(readFileSync(timingPath, "utf8"), /not-a-test/);
      assert.equal(readFileSync(started, "utf8").split("\n")[0], "smoke.test.js", "longest measured file must actually start first");
    } finally { if (evidence) rmSync(evidence, { recursive: true, force: true }); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const state of ["skip", "todo", "fail", "cancelled"]) test(`008. Local runner: ${state} remains a failed whole run with original raw TAP retained`, () => {
  const root = mkdtempSync(join(tmpdir(), "oma-testlocal-unrun-"));
  let evidence, settled = false;
  try {
    localRunnerFixture(root);
    const source = `import test from 'node:test';\ntest('unrun-or-failed oracle', ${state === "fail" ? "() => { throw new Error('original failure'); }" : state === "cancelled" ? "{ timeout: 20 }, () => new Promise(() => {})" : `{ ${state}: true }, () => {}`} );\n`;
    writeFileSync(join(root, "dist/test/smoke.test.js"), source);
    const result = runLocal(root, []);
    settled = result.error === undefined && result.signal === null && result.status !== null;
    if (!settled) console.error(`Failed fixture owner did not settle; retain its root and descendants for diagnosis: ${root}`);
    assert.equal(result.status, 1, result.stderr);
    const retained = /Raw TAP retained for the failed or incomplete run: (.+)/.exec(result.stderr);
    assert.ok(retained, result.stderr);
    evidence = retained[1];
    const raw = readFileSync(join(evidence, "summary-parallel.tap"), "utf8");
    assert.match(raw, /unrun-or-failed oracle/);
    if (state === "fail") { assert.match(raw, /# fail 1/); assert.match(raw, /original failure/); }
    else if (state === "cancelled") { assert.match(raw, /# cancelled 1/); assert.match(result.stderr, /NOT A PASS/); }
    else {
      assert.match(result.stderr, /NOT A PASS/);
      assert.match(raw, new RegExp(`# ${state === "skip" ? "skipped" : "todo"} 1`));
      assert.match(raw, new RegExp(`# ${state.toUpperCase()}\\b`));
    }
  } finally {
    // Only this independent fixture's evidence is removed, after assertions.
    if (settled && evidence) rmSync(evidence, { recursive: true, force: true });
    if (settled) rmSync(root, { recursive: true, force: true });
  }
});

test("009. File and portable guard imports share one patch without blocking fixed pre-exec placement", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-guard-placement-"));
  const guard = new URL("../scripts/local-test-guard.mjs", import.meta.url).href;
  const portable = `data:text/javascript;base64,${Buffer.from(readFileSync(new URL(guard))).toString("base64")}`;
  const marker = join(root, "placement-marker");
  writeFileSync(marker, "");
  // A regular marker exercises only the guard's fixed-launcher contract. The
  // cgroup suite separately verifies real placement before any workload exec.
  const script = `import assert from 'node:assert/strict';
    import {spawn} from 'node:child_process'; import {once} from 'node:events';
    import {openSync,closeSync,readFileSync} from 'node:fs';
    const fd=openSync(${JSON.stringify(marker)},'w');
    const fixed='builtin printf 0 >&3 || builtin exit 125; builtin exec 3>&-; builtin exec /usr/bin/env -i "$@"';
    const argv=['--noprofile','--norc','-c',fixed,'oma-workload','/usr/bin/printf','placed'];
    const options={env:{},shell:false,stdio:['ignore','pipe','pipe',fd]};
    try {
      for(const [args,opts] of [
        [['-c','echo forbidden'],options],
        [[...argv.slice(0,3),fixed+'; echo forbidden',...argv.slice(4)],options],
        [argv,{...options,env:{FORGED:'1'}}],
        [argv,{...options,stdio:['ignore','pipe','pipe','ignore']}],
      ]) assert.throws(()=>spawn('/bin/bash',args,opts),/BLOCKED/);
      assert.throws(()=>spawn('systemctl',['--user','show']),/BLOCKED/);
      const child=spawn('/bin/bash',argv,options); let out=''; child.stdout.on('data',c=>out+=c);
      const [code,signal]=await once(child,'close'); assert.equal(code,0); assert.equal(signal,null);
      assert.equal(out,'placed'); assert.equal(readFileSync(${JSON.stringify(marker)},'utf8'),'0');
    } finally {closeSync(fd);}`;
  try {
    const result = spawnSync(process.execPath, [`--import=${guard}`, `--import=${portable}`, "--input-type=module", "-e", script],
      { encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 0, result.stderr); assert.equal(result.signal, null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
