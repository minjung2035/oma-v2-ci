/** Actual START_SUSPENDED + public dynamic Security validation experiment.
 * PID lookup is safe only because this controller owns the unreaped child;
 * it is not message-origin authentication or an expected-Broker producer. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { constants as osConstants } from "node:os";

assert.equal(process.platform, "darwin", "suspended-image observations require the actual Darwin kernel");
assert.equal(process.argv[2], "suspended-image");
const root = realpathSync(process.cwd()), started = performance.now(), commands = [];
const observation = { fixtureOnly: true, scope: "main-image-only", commands };
function run(executable, argv, env = process.env, required = true) {
  const remaining = 80000 - (performance.now() - started);
  assert.ok(remaining > 0, "suspended-image fixture deadline");
  const result = spawnSync(executable, argv, { cwd: root, env, encoding: "utf8",
    timeout: Math.max(1, Math.min(15000, Math.floor(remaining))), killSignal: "SIGKILL", maxBuffer: 2 * 1024 * 1024 });
  const record = { executable, argv, exitCode: result.status, signal: result.signal,
    error: result.error?.message, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  commands.push(record);
  assert.equal(result.error, undefined, JSON.stringify(record));
  assert.equal(result.signal, null, JSON.stringify(record));
  if (required) assert.equal(result.status, 0, JSON.stringify(record));
  return record;
}
async function digest(path) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest("hex");
}
async function signature(path) {
  const arches = run("/usr/bin/xcrun", ["lipo", "-archs", path]).stdout.trim().split(/\s+/);
  const hashes = [];
  for (const arch of arches) {
    const signed = run("/usr/bin/codesign", ["--display", "--verbose=4", "--arch", arch, path]);
    const hash = /^CDHash=([0-9a-f]{40})$/m.exec(signed.stderr)?.[1];
    assert.ok(hash, JSON.stringify(signed)); hashes.push(hash);
  }
  const cdhashes = [...new Set(hashes)].sort();
  return { path, arches, cdhashes, sha256: await digest(path),
    requirement: cdhashes.map(hash => `cdhash H"${hash}"`).join(" or ") };
}
// File-backed output avoids pipe inheritance confusing wait(timeout). A timeout
// has not reaped the session leader, so only its fixture group is signalled.
const supervise = String.raw`import json, os, signal, subprocess, sys
argv, directory = json.loads(sys.argv[1]), sys.argv[2]
with open(directory + "/controller.stdout", "xb") as out, open(directory + "/controller.stderr", "xb") as err:
    child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=out, stderr=err, start_new_session=True)
    timed_out = False
    try:
        code = child.wait(timeout=8)
    except subprocess.TimeoutExpired:
        timed_out = True
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        code = child.wait(timeout=5)
print(json.dumps({"exitCode": code, "timedOut": timed_out, "joined": True}))`;
let controller;
function attempt(name, executable, argv, expected, alternate, restore) {
  const directory = join(root, name); mkdirSync(directory, { mode: 0o700 });
  const env = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: root, TMPDIR: root, LANG: "C", LC_ALL: "C",
    PROBE_MARKER_DIRECTORY: directory };
  const supervised = run("python3", ["-c", supervise,
    JSON.stringify([controller, expected.requirement, alternate?.requirement ?? "-", restore ?? "-", directory, executable, ...argv]), directory], env);
  const owner = JSON.parse(supervised.stdout);
  const stdout = readFileSync(join(directory, "controller.stdout"), "utf8"), stderr = readFileSync(join(directory, "controller.stderr"), "utf8");
  assert.equal(owner.timedOut, false, JSON.stringify({ owner, stdout, stderr }));
  assert.equal(owner.joined, true); assert.equal(owner.exitCode, 0, JSON.stringify({ owner, stdout, stderr }));
  const result = JSON.parse(stdout);
  result.supervisorJoined = true;
  result.targetStdout = readFileSync(join(directory, "target.stdout"), "utf8");
  result.targetStderr = readFileSync(join(directory, "target.stderr"), "utf8");
  for (const marker of ["constructor", "main"]) {
    const path = join(directory, `${marker}.json`);
    result[marker] = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  }
  return result;
}
function positive(result) {
  assert.equal(result.stopped, true, JSON.stringify(result));
  assert.equal(result.stopSignal, osConstants.signals.SIGSTOP);
  assert.deepEqual(result.beforeRelease, { constructor: false, main: false, stdoutBytes: 0, stderrBytes: 0 });
  assert.equal(result.copyStatus, 0, JSON.stringify(result));
  assert.deepEqual(result.primary, { parseStatus: 0, validationStatus: 0 });
  assert.equal(result.released, true); assert.equal(result.childReaped, true);
  assert.equal(result.exitCode, 0, JSON.stringify(result)); assert.equal(result.signal, null);
}
try {
  observation.sip = run("/usr/bin/csrutil", ["status"], process.env, false);
  const controllerSource = fileURLToPath(new URL("./darwin-suspended-image.c", import.meta.url));
  const targetSource = fileURLToPath(new URL("./darwin-image-target.c", import.meta.url));
  observation.sourceSha256 = { controller: await digest(controllerSource), target: await digest(targetSource) };
  controller = join(root, "controller");
  run("/usr/bin/xcrun", ["clang", "-Wall", "-Wextra", "-Werror", controllerSource,
    "-framework", "Security", "-framework", "CoreFoundation", "-o", controller]);
  const binaries = [];
  for (const variant of [1, 2]) {
    const binary = join(root, `image-${variant}`);
    run("/usr/bin/xcrun", ["clang", "-Wall", "-Wextra", "-Werror", `-DPROBE_VARIANT=${variant}`, targetSource, "-o", binary]);
    run("/usr/bin/codesign", ["--force", "--sign", "-", binary]); binaries.push(await signature(binary));
  }
  const [a, b] = binaries;
  assert.ok(a.cdhashes.every(hash => !b.cdhashes.includes(hash)), "controlled images require distinct hashes");
  observation.images = { a, b };
  const first = attempt("positive-a", a.path, [], a), second = attempt("positive-b", b.path, [], b);
  positive(first); positive(second);
  for (const [result, variant] of [[first, 1], [second, 2]]) {
    assert.equal(result.constructor.variant, variant); assert.equal(result.main.variant, variant);
    assert.equal(result.constructor.pid, result.main.pid);
  }
  observation.positive = { a: first, b: second };
  observation.mismatch = attempt("mismatch-b", b.path, [], a, b);
  const selected = join(root, "selected"), restored = join(root, "restored-a");
  copyFileSync(b.path, selected); copyFileSync(a.path, restored);
  observation.restoredPath = attempt("mapped-b-restored-a", selected, [], a, b, restored);
  assert.equal(await digest(selected), a.sha256, "the name must identify A after B was spawned");
  for (const result of [observation.mismatch, observation.restoredPath]) {
    assert.equal(result.stopped, true); assert.equal(result.childReaped, true);
    assert.deepEqual(result.beforeRelease, { constructor: false, main: false, stdoutBytes: 0, stderrBytes: 0 });
    assert.equal(typeof result.released, "boolean");
    if (result.released) {
      assert.equal(result.constructor.variant, 2); assert.equal(result.main.variant, 2);
      assert.equal(result.exitCode, 0); assert.equal(result.signal, null);
    } else {
      assert.equal(result.constructor, null); assert.equal(result.main, null);
      assert.equal(result.exitCode, null); assert.equal(result.signal, 9);
    }
  }
  const node = await signature(realpathSync(process.execPath));
  const git = await signature(realpathSync(run("/usr/bin/xcrun", ["--find", "git"]).stdout.trim()));
  const compiler = await signature(realpathSync(run("/usr/bin/xcrun", ["--find", "clang"]).stdout.trim()));
  const shell = await signature(realpathSync("/bin/sh"));
  observation.tools = { node, git, compiler, shell };
  const nodeCode = `import {writeFileSync} from 'node:fs';writeFileSync(process.env.PROBE_MARKER_DIRECTORY+'/main.json',JSON.stringify({kind:'node',pid:process.pid}));`;
  const nodeResult = attempt("normal-node", node.path, ["--input-type=module", "-e", nodeCode], node);
  const gitResult = attempt("normal-git", git.path, ["--version"], git);
  const compilerResult = attempt("normal-compiler", compiler.path, ["--version"], compiler);
  for (const result of [nodeResult, gitResult, compilerResult]) positive(result);
  assert.equal(nodeResult.main.kind, "node"); assert.match(gitResult.targetStdout, /^git version /);
  assert.match(compilerResult.targetStdout, /clang version/);
  const script = join(root, "script.sh");
  writeFileSync(script, '#!/bin/sh\nprintf \'{"kind":"script"}\\n\' > "$PROBE_MARKER_DIRECTORY/main.json"\n', { mode: 0o700 });
  const scriptResult = attempt("normal-script", script, [], shell);
  positive(scriptResult); assert.equal(scriptResult.main.kind, "script");
  Object.assign(observation.positive, { node: nodeResult, git: gitResult, compiler: compilerResult, script: scriptResult });
  observation.scriptRequirementNamesInterpreter = true;
  observation.unreapedPidControl = true;
  observation.ownedChildrenJoined = true;
  observation.limitations = ["main-image validation is not a script/module/library-content binding", "no descendant lifetime or sender-role authentication is inferred"];
} catch (error) {
  await new Promise((resolve, reject) => process.stderr.write(
    JSON.stringify({ case: "suspended-image", error: String(error), observation }) + "\n",
    failure => failure ? reject(failure) : resolve()));
  throw error;
}
console.log(JSON.stringify({ case: "suspended-image", suspendedImage: observation }));
