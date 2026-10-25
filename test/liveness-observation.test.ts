/** AV6 -- INV02 applied to liveness: a process has ended only when the kernel
 * says so, and a question the kernel did not answer is neither "running" nor
 * "ended".
 *
 * The broker asks two such questions. Whether a peer's connector still runs
 * is asked of its pidfd with a zero-timeout `poll`, which a pending signal
 * interrupts; the broker reaps children constantly, and under load a live
 * Resident's request was refused as CAPABILITY_DENIED because EINTR was read
 * as an exit. Whether the Principal's engine still runs is asked of /proc,
 * and a read that failed for any reason retired the registration -- its
 * connections cut and its credential dropped -- although nothing had ended.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIDFD_POLL_ATTEMPTS, livenessFromPoll, pidfdLiveness, type PollAnswer } from "@oma/native/linux";

const EINTR = 4;
const EBADF = 9;
const ENOMEM = 12;
const interrupted: PollAnswer = { result: -1, errno: EINTR, revents: 0 };

/** A poll that gives these answers in turn, repeating the last. */
function scripted(answers: readonly PollAnswer[]): { ask: () => PollAnswer; readonly asked: number } {
  let asked = 0;
  return { ask: () => answers[Math.min(asked++, answers.length - 1)]!, get asked() { return asked; } };
}

test("AV6 / INV02, INV10: an interrupted poll of a pidfd is asked again, a bounded number of times, and is never an exit", () => {
  const recovering = scripted([interrupted, interrupted, { result: 0, errno: 0, revents: 0 }]);
  assert.deepEqual(livenessFromPoll(recovering.ask), { kind: "running" });
  assert.equal(recovering.asked, 3);
  const storm = scripted([interrupted]);
  assert.deepEqual(livenessFromPoll(storm.ask), { kind: "failed", errno: EINTR }, "an unanswered poll was read as an answer");
  assert.equal(storm.asked, PIDFD_POLL_ATTEMPTS, "the retry is not bounded");
  const other = scripted([{ result: -1, errno: ENOMEM, revents: 0 }]);
  assert.deepEqual(livenessFromPoll(other.ask), { kind: "failed", errno: ENOMEM });
  assert.equal(other.asked, 1, "only an interruption is asked again");
  assert.deepEqual(livenessFromPoll(scripted([{ result: 1, errno: 0, revents: 0x1 }]).ask), { kind: "exited" });
  assert.deepEqual(livenessFromPoll(scripted([{ result: 1, errno: 0, revents: 0x10 }]).ask), { kind: "exited" });
  assert.deepEqual(livenessFromPoll(scripted([{ result: 1, errno: 0, revents: 0x20 }]).ask), { kind: "failed", errno: EBADF });
  // The kernel's own answer for a descriptor that is not open is POLLNVAL.
  const fd = openSync("/dev/null", "r");
  closeSync(fd);
  assert.deepEqual(pidfdLiveness(fd), { kind: "failed", errno: EBADF });
});

test("AV6 / INV02: a Principal engine /proc cannot be read for is refused for now and not retired", () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-av6-"));
  try {
    const script = join(dir, "probe.mjs");
    const module = (specifier: string): string => JSON.stringify(import.meta.resolve(specifier));
    // The endpoint lives in a process with few descriptors, so that /proc can
    // be made unreadable to it -- EMFILE -- while the engine keeps running.
    writeFileSync(script, `
import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
const { PrincipalEndpoint } = await import(${module("@oma/broker/principal-endpoint")});
const { processEnded, processIdentity } = await import(${module("@oma/broker/process-ancestry")});
const turn = () => new Promise(resolve => setImmediate(resolve));
const engine = spawn("/bin/sleep", ["30"], { stdio: "ignore" });
await new Promise(resolve => engine.once("spawn", resolve));
let deliver = null;
const endpoint = new PrincipalEndpoint(
  { host: processIdentity(process.pid), ready() {}, grant() {}, refuse() {}, onSession(listener) { deliver = listener; } },
  { cleanupError() {} });
deliver(${JSON.stringify(randomBytes(16).toString("hex"))}, engine.pid);
const registered = endpoint.registeredEngine;
const identity = processIdentity(engine.pid);
const held = [];
try { for (;;) held.push(openSync("/dev/null", "r")); }
catch (error) { if (error.code !== "EMFILE") throw error; }
const unobserved = endpoint.registeredEngine;
const answer = processEnded(identity);
await turn();
for (const fd of held) closeSync(fd);
const afterwards = endpoint.registeredEngine;
engine.kill("SIGKILL");
await new Promise(resolve => engine.once("exit", resolve));
const ended = processEnded(identity);
const dead = endpoint.registeredEngine;
await turn();
console.log(JSON.stringify({ engine: engine.pid, registered, unobserved, answer, afterwards, ended, dead }));
`);
    // The descriptor bound is set with prlimit's direct argv: the local lane
    // forbids a shell, and `ulimit` exists only inside one.
    const run = spawnSync("prlimit", ["--nofile=64:64", process.execPath, script],
      { encoding: "utf8", timeout: 20000 });
    assert.equal(run.status, 0, run.stderr);
    const seen = JSON.parse(run.stdout) as Record<string, unknown>;
    assert.equal(seen.registered, seen.engine, "the engine was not registered");
    assert.equal(seen.unobserved, null, "an engine that could not be observed was answered for");
    assert.equal(seen.answer, "unknown", "an unreadable /proc was read as an ended process");
    assert.equal(seen.afterwards, seen.engine, "the registration was retired although nothing had ended");
    assert.equal(seen.ended, "ended");
    assert.equal(seen.dead, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
