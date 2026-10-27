import test from "node:test";
import assert from "node:assert/strict";
import {
  runProcessSync, runProcess, decodeProcessText,
  type CommandSpec, type NativeSyncResult, type SyncInvoker,
} from "@oma/process/run";
import { requireTextExit } from "@oma/process/policies";
import { StoreError } from "@oma/domain/errors";

const spec: CommandSpec = {
  executable: "/usr/bin/git", argv: ["--version"],
  env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent", LANG: "C" },
  cwd: "/tmp", timeoutMs: 1000, stdoutBytes: 32, stderrBytes: 16,
};
const native = (changes: Partial<NativeSyncResult> = {}): NativeSyncResult => ({
  status: 0, signal: null, stdout: Buffer.from("ok\n"), stderr: Buffer.alloc(0), ...changes,
});
const errorWithCode = (code: string) => Object.assign(new Error(code), { code });
const matches = (code: string) => (error: unknown) => error instanceof StoreError && error.code === code;

// These tests exercise the process boundary, not Git or cgroup safety proofs.
// They are authored here but have not been executed in the refactoring session.
test("R19: argv, environment, cwd and finite native limits are explicit and copied", () => {
  const invoke: SyncInvoker = (command, argv, options) => {
    assert.equal(command, spec.executable);
    assert.deepEqual(argv, ["--version"]);
    assert.notEqual(argv, spec.argv);
    assert.deepEqual(options.env, spec.env);
    assert.notEqual(options.env, spec.env);
    assert.equal(options.cwd, "/tmp");
    assert.equal(options.shell, false);
    assert.equal(options.encoding, "buffer");
    assert.equal(options.timeout, 1000);
    assert.equal(options.killSignal, "SIGKILL");
    assert.equal(options.maxBuffer, 32, "do not silently double the legacy native capture cap");
    return native();
  };
  const result = runProcessSync(spec, invoke);
  assert.equal(result.kind, "exited");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.toString("utf8"), "ok\n");
});

test("R19: known nonzero exits remain facts instead of invented successful empty reads", () => {
  const result = runProcessSync(spec, () => native({ status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from("not found") }));
  assert.equal(result.kind, "exited");
  assert.equal(result.exitCode, 1);
  assert.deepEqual(requireTextExit(result, "fixture"), { status: 1, stdout: "", stderr: "not found" });
});

test("R19: timeout, output overflow, signals and missing exit observations are distinct", () => {
  const cases: Array<{ result: NativeSyncResult; kind: string; error: string }> = [
    { result: native({ status: null, signal: "SIGKILL", error: errorWithCode("ETIMEDOUT") }), kind: "timed-out", error: "DEADLINE_EXCEEDED" },
    { result: native({ status: null, signal: "SIGKILL", error: errorWithCode("ENOBUFS") }), kind: "output-limited", error: "LIMIT_EXCEEDED" },
    { result: native({ status: null, signal: "SIGTERM" }), kind: "signalled", error: "INTERNAL_ERROR" },
    { result: native({ status: null }), kind: "unobserved", error: "INTERNAL_ERROR" },
    { result: native({ status: null, error: errorWithCode("ENOENT") }), kind: "spawn-failed", error: "INTERNAL_ERROR" },
  ];
  for (const item of cases) {
    const result = runProcessSync(spec, () => item.result);
    assert.equal(result.kind, item.kind);
    assert.throws(() => requireTextExit(result, "fixture"), matches(item.error));
  }
  const thrown = runProcessSync(spec, () => { throw errorWithCode("EACCES"); });
  assert.equal(thrown.kind, "spawn-failed");
  assert.equal(thrown.exitCode, null);
  assert.equal(thrown.errorCode, "EACCES");
});

test("R19: returned prefixes are bounded and cannot become decision output after truncation", () => {
  const result = runProcessSync(spec, () => native({ stdout: Buffer.alloc(33, 65), stderr: Buffer.alloc(17, 66) }));
  assert.equal(result.kind, "output-limited");
  assert.equal(result.stdout.length, 32);
  assert.equal(result.stderr.length, 16);
  assert.equal(result.stdoutTruncated, true);
  assert.equal(result.stderrTruncated, true);
  assert.throws(() => requireTextExit(result, "fixture"), matches("LIMIT_EXCEEDED"));
});

test("R19: diagnostic discard is explicit and cannot exempt overflowing decision stdout", () => {
  const diagnostic = runProcessSync({ ...spec, stderrOverflow: "discard" }, () => native({ stderr: Buffer.alloc(17) }));
  assert.equal(diagnostic.kind, "exited");
  assert.equal(diagnostic.stderr.length, 16);
  assert.equal(diagnostic.stderrTruncated, true);
  const decision = runProcessSync({ ...spec, stderrOverflow: "discard" }, () => native({ stdout: Buffer.alloc(33) }));
  assert.equal(decision.kind, "output-limited");
  const nativeOverflow = runProcessSync({ ...spec, stderrOverflow: "discard" }, () => native({ status: null, error: errorWithCode("ENOBUFS") }));
  assert.equal(nativeOverflow.kind, "output-limited");
});

test("R19: invalid UTF-8 and invalid numeric limits never reach text decision parsers", () => {
  assert.throws(() => decodeProcessText(Buffer.from([0xff])));
  const observation = runProcessSync(spec, () => native({ stdout: Buffer.from([0xff]) }));
  assert.throws(() => requireTextExit(observation, "fixture"), matches("INTERNAL_ERROR"));
  for (const timeoutMs of [0, -1, NaN, Infinity, 1.5, 0x80000000])
    assert.throws(() => runProcessSync({ ...spec, timeoutMs }, () => assert.fail("invalid limits must not invoke native code")), RangeError);
  for (const stdoutBytes of [-1, NaN, Infinity, 1.5])
    assert.throws(() => runProcessSync({ ...spec, stdoutBytes }, () => assert.fail("invalid budget must not invoke native code")), RangeError);
});

const childSpec = (script: string, overrides: Partial<CommandSpec> = {}): CommandSpec => ({
  executable: process.execPath, argv: ["-e", script], env: { ...process.env },
  timeoutMs: 5000, stdoutBytes: 1024, stderrBytes: 1024, ...overrides,
});

test("R19: asynchronous execution settles a known child exit with both output channels", async () => {
  const result = await runProcess(childSpec("process.stdout.write('out'); process.stderr.write('err'); process.exitCode = 7;"));
  assert.equal(result.kind, "exited");
  assert.equal(result.exitCode, 7);
  assert.equal(result.stdout.toString("utf8"), "out");
  assert.equal(result.stderr.toString("utf8"), "err");
});

test("R19: stdout and stderr floods are bounded and cannot return an exited success", async () => {
  for (const channel of ["stdout", "stderr"] as const) {
    const result = await runProcess(childSpec(`process.${channel}.write(Buffer.alloc(65536)); setInterval(() => {}, 1000);`));
    assert.equal(result.kind, "output-limited");
    assert.ok(result.stdout.length <= 1024);
    assert.ok(result.stderr.length <= 1024);
    assert.equal(channel === "stdout" ? result.stdoutTruncated : result.stderrTruncated, true);
    assert.notEqual(result.signal, null, "the fixture remains alive until the output-limit termination request");
  }
});

test("R19: a timeout records termination without claiming that an external cgroup is empty", async () => {
  const result = await runProcess(childSpec("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);", { timeoutMs: 100 }));
  assert.equal(result.kind, "timed-out");
  assert.notEqual(result.kind, "exited");
  assert.ok(result.elapsedMs >= 0);
  // No populated/empty cgroup assertion can be derived from this process result.
});
