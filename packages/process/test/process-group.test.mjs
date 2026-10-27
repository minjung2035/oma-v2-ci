/** Real host Node/POSIX mechanics, never a complete execution-scope proof. */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, openSync, closeSync, fstatSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startProcess } from "../dist/async.js";

const root = mkdtempSync(join(tmpdir(), "oma-posix-group-")), binary = join(root, "group");
before(() => {
  assert.ok(["linux", "darwin"].includes(process.platform), "a real supported POSIX host is required");
  const source = fileURLToPath(new URL("./fixtures/process-group.c", import.meta.url));
  const compiled = spawnSync(process.platform === "darwin" ? "/usr/bin/xcrun" : "/usr/bin/cc",
    [...(process.platform === "darwin" ? ["clang"] : []), "-Wall", "-Wextra", "-Werror", "-O2", source, "-o", binary],
    { encoding: "utf8", timeout: 30000, killSignal: "SIGKILL", maxBuffer: 65536 });
  assert.equal(compiled.error, undefined); assert.equal(compiled.signal, null); assert.equal(compiled.status, 0, compiled.stderr);
});
after(() => rmSync(root, { recursive: true, force: true }));

function launch(mode, options = {}, timeoutMs = 10000) {
  let observe;
  const announced = new Promise(resolve => { observe = resolve; });
  let output = "";
  const task = startProcess({ executable: binary, argv: [mode], cwd: root,
    env: { PATH: "/usr/bin:/bin", LANG: "C" }, timeoutMs, stdoutBytes: 4096, stderrBytes: 4096 },
    { ...options, stdoutSink(bytes) {
      output += bytes.toString(); assert.ok(output.length <= 4096);
      if (output.includes("\n")) observe(JSON.parse(output));
    } });
  const ready = Promise.race([announced, task.result.then(result => {
    throw new Error("child ended before its identity observation", { cause: result });
  })]);
  void ready.catch(() => {});
  return { task, ready };
}
async function owned(run, effect) {
  try { return await effect(run); }
  finally { run.task.cancel(); await run.task.closed; }
}
function leader(observed) {
  assert.ok(Number.isSafeInteger(observed.pid) && observed.pid > 1);
  assert.equal(observed.group, observed.pid); assert.equal(observed.session, observed.pid);
}

test("POSIX group launch creates a real session leader while ordinary launch inherits its group", { timeout: 15000 }, async t => {
  await owned(launch("observe"), async ({ task, ready }) => {
    const info = await ready, result = await task.result; await task.closed;
    assert.equal(result.kind, "exited"); assert.equal(result.exitCode, 0);
    assert.notEqual(info.group, info.pid);
    t.diagnostic(JSON.stringify({ platform: process.platform, ordinary: info }));
  });
  await owned(launch("observe", { processGroup: true }), async ({ task, ready }) => {
    const info = await ready; leader(info);
    const result = await task.result; await task.closed;
    assert.equal(result.kind, "exited"); assert.equal(result.exitCode, 0); assert.equal(result.signal, null);
    t.diagnostic(JSON.stringify({ platform: process.platform, ownGroup: info }));
  });
});
test("POSIX group cancellation joins the actual child and streams", { timeout: 15000 }, async t => {
  await owned(launch("wait", { processGroup: true }), async ({ task, ready }) => {
    const info = await ready; leader(info); task.cancel(); task.cancel();
    const result = await task.result; await task.closed;
    assert.equal(result.kind, "aborted"); assert.equal(result.signal, "SIGKILL"); assert.equal(result.exitCode, null);
    t.diagnostic(JSON.stringify({ platform: process.platform, child: info, result: result.kind, signal: result.signal, directChildClosed: true }));
  });
});
test("POSIX group deadline retains the timeout result through actual child close", { timeout: 15000 }, async t => {
  await owned(launch("wait", { processGroup: true }, 2000), async ({ task, ready }) => {
    const info = await ready; leader(info);
    const result = await task.result; await task.closed;
    assert.equal(result.kind, "timed-out"); assert.equal(result.signal, "SIGKILL"); assert.equal(result.exitCode, null);
    t.diagnostic(JSON.stringify({ platform: process.platform, child: info, result: result.kind, signal: result.signal, directChildClosed: true }));
  });
});
test("POSIX group launch retains the explicitly supplied file descriptor", { timeout: 15000 }, async t => {
  const canary = join(root, "canary"); writeFileSync(canary, "fixture-owned identity");
  const fd = openSync(canary, "r");
  try {
    const expected = fstatSync(fd, { bigint: true });
    await owned(launch("descriptor", { processGroup: true, inheritedFds: [fd] }), async ({ task, ready }) => {
      const info = await ready; leader(info);
      assert.equal(info.device, String(expected.dev)); assert.equal(info.inode, String(expected.ino));
      const result = await task.result; await task.closed;
      assert.equal(result.kind, "exited"); assert.equal(result.exitCode, 0);
      t.diagnostic(JSON.stringify({ platform: process.platform, child: info, sameHeldInode: true }));
    });
  } finally { closeSync(fd); }
});
