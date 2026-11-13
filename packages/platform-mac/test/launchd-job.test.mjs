import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { renderLaunchdJob, submitLaunchdJob } from "@oma/platform-mac/launchd-job";

const definition = () => ({ label: "com.oma.execution.test", machServices: ["com.oma.execution.test.control"], startSuspended: true,
  command: { executable: "/selected/helper", argv: ["quoted <&>\"'\n雪😀", "$(literal);"], cwd: "/owned/work",
    env: JSON.parse('{"PATH":"/usr/bin:/bin","__proto__":"ordinary-data","WITH_XML":"<&>"}'),
    timeoutMs: null, stdoutBytes: 0, stderrBytes: 0 } });

test("001. One-shot job bytes preserve exact exec arguments and environment in an independent plist reader", () => {
  const input = definition(), expected = structuredClone(input.command), bytes = renderLaunchdJob(input);
  input.command.argv[0] = "changed"; input.command.env.PATH = "/changed";
  const decoded = spawnSync("python3", ["-c", "import json,plistlib,sys;print(json.dumps(plistlib.loads(sys.stdin.buffer.read())))"],
    { input: bytes, encoding: "utf8", timeout: 10000 });
  assert.equal(decoded.error, undefined); assert.equal(decoded.signal, null); assert.equal(decoded.status, 0, decoded.stderr);
  const value = JSON.parse(decoded.stdout);
  assert.equal(value.Program, expected.executable); assert.deepEqual(value.ProgramArguments, [expected.executable, ...expected.argv]);
  assert.deepEqual(value.EnvironmentVariables, expected.env); assert.equal(value.WorkingDirectory, expected.cwd);
  assert.equal(value.LaunchOnlyOnce, true); assert.equal(value.SessionCreate, true);
  assert.equal(value.WaitForDebugger, true);
  assert.equal(value.RunAtLoad, false); assert.equal(value.KeepAlive, false); assert.equal(value.AbandonProcessGroup, false);
  assert.equal(value.LimitLoadToSessionType, "Background"); assert.deepEqual(value.MachServices, { "com.oma.execution.test.control": true });
  assert.equal(value.StandardOutPath, "/dev/null"); assert.equal(value.StandardErrorPath, "/dev/null");
  const diagnostic = spawnSync("python3", ["-c", "import plistlib,sys;print(plistlib.loads(sys.stdin.buffer.read())['StandardErrorPath'])"],
    { input: renderLaunchdJob({ ...definition(), stderrPath: "/private/owned/oma-job-x/stderr" }), encoding: "utf8", timeout: 10000 });
  assert.equal(diagnostic.status, 0, diagnostic.stderr); assert.equal(diagnostic.stdout.trim(), "/private/owned/oma-job-x/stderr");
});

test("002. One-shot helper refuses ignored input/capture controls and invalid XML before registration", () => {
  for (const patch of [{ input: "unforwarded" }, { stdinFd: 7 }, { stdoutBytes: 1 }, { stderrBytes: 1 },
    { timeoutMs: 1000 }, { stdoutSpool: "/owned/log" }, { executable: "relative" }, { argv: ["\u0001"] }, { argv: ["\ud800"] }])
    assert.throws(() => renderLaunchdJob({ ...definition(), command: { ...definition().command, ...patch } }));
  assert.throws(() => renderLaunchdJob({ ...definition(), machServices: ["same", "same"] }));
  assert.throws(() => renderLaunchdJob({ ...definition(), startSuspended: "true" }));
  for (const stderrPath of ["relative/stderr", "/owned/../stderr", "/owned/./stderr", 7])
    assert.throws(() => renderLaunchdJob({ ...definition(), stderrPath }), TypeError);
  if (process.platform !== "darwin") assert.throws(() => submitLaunchdJob(definition(), 1000), { code: "UNSUPPORTED_PROFILE" });
});
