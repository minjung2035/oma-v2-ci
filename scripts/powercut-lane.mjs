#!/usr/bin/env node
/** P9 power-cut lane. This is a SEPARATE failure model from the SIGKILL crash
 * lane: it never replaces it, and it must not run on a host that is not a
 * disposable VM.
 *
 *   node scripts/powercut-lane.mjs --phase prepare --state <abs> --society <name> --out <abs dir>
 *   node scripts/powercut-lane.mjs --phase verify  --state <abs> --society <name> --out <abs dir>
 *
 * prepare: observe read-only integrity, record the expectation, fsync it, then
 *          force an immediate power-off at that exact checkpoint.
 * verify:  after reboot, observe integrity, run the production startup recovery
 *          (broker entry), observe integrity again and compare with the record.
 *          SIGKILL results are never reused as power-loss proof, and the crash
 *          lane keeps its own evidence.
 */
import fs from "node:fs";
import path, { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const VM_MARKER = "/etc/oma-powercut-vm";
const ACK = "OMA_POWERCUT_ACK";
const SYSRQ = "/proc/sysrq-trigger";
const SELF = import.meta.dirname;

function emit(code, payload) {
  console.log(JSON.stringify(payload));
  process.exit(code);
}
/** Every guard fails closed; an unguarded power-off would destroy a real host. */
export function powercutGuards({ stateRoot, society, out, env = process.env,
  isRoot = process.getuid?.() === 0, markerExists = fs.existsSync(VM_MARKER) }) {
  const failures = [];
  if (!stateRoot || !path.isAbsolute(stateRoot)) failures.push("state root must be an absolute path");
  if (!out || !path.isAbsolute(out)) failures.push("evidence directory must be an absolute path");
  if (typeof society !== "string" || !/^[a-z][a-z0-9-]{0,31}$/.test(society)) failures.push("society name is invalid");
  if (env[ACK] !== "disposable-vm") failures.push(`${ACK} must be set to disposable-vm`);
  if (!markerExists) failures.push(`${VM_MARKER} must exist (disposable VM marker)`);
  if (!isRoot) failures.push("power-cut lane requires root inside the VM");
  if (!fs.existsSync(SYSRQ)) failures.push(`${SYSRQ} is unavailable; this kernel/platform has no audit path`);
  return failures;
}
function fsyncFile(target, text) {
  const fd = fs.openSync(target, "w", 0o600);
  try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function fsyncPath(target) {
  const fd = fs.openSync(target, "r");
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
/** Read-only observation. Exit codes: 0 PASS, 1 FAIL, 2 UNKNOWN. */
export function observe(stateRoot, society) {
  const result = spawnSync(process.execPath, [path.join(SELF, "check-state.mjs"), "--state", stateRoot,
    "--society", society, "--mode", "offline", "--quiesced"], { encoding: "utf8", timeout: 600000, maxBuffer: 32 * 1024 * 1024 });
  let report;
  try { report = JSON.parse(result.stdout); } catch { report = { status: "UNKNOWN", parseFailure: true }; }
  return { exitCode: result.status, report };
}
/** Startup recovery is the production path; no repair helper is called here. */
function recover(stateRoot, society) {
  const entry = path.join(SELF, "..", "dist", "src", "entry", "broker.js");
  const child = spawn(process.execPath, [entry, "--society", society], {
    env: { ...process.env, XDG_DATA_HOME: path.dirname(path.dirname(stateRoot)), NOTIFY_SOCKET: "" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let output = "";
  child.stderr.on("data", bytes => { output += bytes.toString(); });
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline && child.exitCode === null && !/broker (ready|listening)/.test(output))
    spawnSync(process.execPath, ["-e", "setTimeout(()=>{},50)"], { timeout: 5000 });
  try { child.kill("SIGTERM"); } catch { /* already gone */ }
  return { started: /broker (ready|listening)/.test(output), exitCode: child.exitCode, stderrTail: output.slice(-400) };
}

export function main(argv = process.argv, options = {}) {
  const value = name => { const index = argv.indexOf(name); return index < 0 ? undefined : argv[index + 1]; };
  const phase = value("--phase"), stateRoot = value("--state"), society = value("--society"), out = value("--out");
  if (!["prepare", "verify"].includes(phase ?? ""))
    emit(4, { status: "UNSUPPORTED_PROFILE", lane: "powercut", failures: ["--phase must be prepare or verify"], powerLossProven: false });
  const failures = powercutGuards({ stateRoot, society, out, ...options });
  if (failures.length > 0)
    emit(4, { status: "UNSUPPORTED_PROFILE", lane: "powercut", failures, powerLossProven: false });
  fs.mkdirSync(out, { recursive: true });

  if (phase === "prepare") {
    const before = observe(stateRoot, society);
    fsyncFile(path.join(out, "expectation.json"), JSON.stringify({ schema: 1, lane: "powercut", phase: "prepare",
      status: before.report.status, exitCode: before.exitCode, checkpointAt: new Date().toISOString() }, null, 2) + "\n");
    fsyncFile(path.join(out, "poweroff.json"), JSON.stringify({ method: "sysrq-b", at: new Date().toISOString() }) + "\n");
    fsyncPath(out); fsyncPath(stateRoot);
    // Exact checkpoint: nothing after this write is allowed to make progress.
    fs.writeFileSync(SYSRQ, "b");
    emit(0, { status: "POWER_OFF_REQUESTED", lane: "powercut", phase: "prepare", observation: before.report.status });
  }

  const expectation = JSON.parse(fs.readFileSync(path.join(out, "expectation.json"), "utf8"));
  const first = observe(stateRoot, society);
  const recovery = recover(stateRoot, society);
  const second = observe(stateRoot, society);
  const comparison = {
    schema: 1, lane: "powercut", phase: "verify",
    beforeCut: { status: expectation.status },
    afterReboot: { status: first.report.status },
    recovery,
    afterReconcile: { status: second.report.status },
    falseSuccess: first.report.status === "PASS" && expectation.status === "FAIL",
    powerLossProven: second.report.status === "PASS" && first.report.status !== "FAIL",
    sigkillLaneReplaced: false,
    note: "power-loss proof requires this comparison on a disposable VM; the in-process fault seam and the SIGKILL lane are different failure models",
  };
  fsyncFile(path.join(out, "comparison.json"), JSON.stringify(comparison, null, 2) + "\n");
  emit(comparison.powerLossProven ? 0 : 1, comparison);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
