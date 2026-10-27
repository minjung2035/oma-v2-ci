#!/usr/bin/env node
/** P9: a separate failure model from the SIGKILL crash lane.
 * prepare/verify on a guarded disposable VM exercises an abrupt guest restart
 * (SysRq-b), not physical power loss. SIGKILL results are never reused as power-loss proof.
 * Test-only ports exercise the same checkpoint judgment without any host power effect.
 */
import fs from "node:fs";
import path, { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const VM_MARKER = "/etc/oma-powercut-vm";
const ACK = "OMA_POWERCUT_ACK";
const SYSRQ = "/proc/sysrq-trigger";
const SELF = import.meta.dirname;
const bootId = () => fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
const uuid = value => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const healthy = observation => observation?.exitCode === 0 && observation.report?.status === "PASS";

function emit(code, payload) {
  console.log(JSON.stringify(payload));
  process.exitCode = code;
}
/** Every guard fails closed; an unguarded restart would destroy a real host. */
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
  const fd = fs.openSync(target, "wx", 0o600);
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

/** Own the direct child through close; never block the event loop waiting for
 * its readiness or abandon it at timeout. stderr is a bounded diagnostic tail. */
export function runRecovery(executable, args, { env, timeoutMs = 120000, stopMs = 5000 } = {}) {
  return new Promise(resolveResult => {
    let output = "", started = false, timedOut = false, forced = false, failure = null, stopping = false;
    let stopTimer;
    const child = spawn(executable, args, { env, stdio: ["ignore", "ignore", "pipe"] });
    const stop = () => {
      if (stopping) return;
      stopping = true;
      child.kill("SIGTERM");
      stopTimer = setTimeout(() => { forced = true; child.kill("SIGKILL"); }, stopMs);
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    child.stderr.on("data", bytes => {
      output = (output + bytes.toString()).slice(-4096);
      if (!started && /broker (ready|listening)/.test(output)) { started = true; stop(); }
    });
    child.on("error", error => { failure = error.message; });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer); clearTimeout(stopTimer);
      resolveResult({ started, exitCode, signal, timedOut, forced, error: failure,
        ok: started && exitCode === 0 && signal === null && !timedOut && !forced && failure === null,
        stderrTail: output.slice(-400) });
    });
  });
}
function recover(stateRoot, society) {
  return runRecovery(process.execPath, [path.join(SELF, "..", "apps", "oma", "dist", "entry", "broker.js"), "--society", society], {
    env: { ...process.env, XDG_DATA_HOME: path.dirname(path.dirname(stateRoot)), NOTIFY_SOCKET: "" },
  });
}

/** Ports are supplied by the guarded CLI or test fixtures, never selected by
 * an untrusted command-line simulation/skip-guards flag. */
export async function prepareCheckpoint(context, ports) {
  const before = await ports.observe();
  if (!healthy(before)) throw new Error("checkpoint observation is not a successful integrity check");
  const start = await ports.bootId();
  if (!uuid(start) || !["simulation", "guest-reset"].includes(context.failureModel)) throw new Error("invalid checkpoint identity");
  const expectation = { schema: 2, runId: randomUUID(), stateRoot: context.stateRoot, society: context.society,
    failureModel: context.failureModel, bootId: start, before, checkpointAt: new Date().toISOString() };
  await ports.persist(expectation);
  await ports.cut();
  return expectation;
}
export async function verifyCheckpoint(context, expectation, ports) {
  const valid = expectation?.schema === 2 && uuid(expectation.runId) && uuid(expectation.bootId) &&
    expectation.stateRoot === context.stateRoot && expectation.society === context.society &&
    expectation.failureModel === context.failureModel && ["simulation", "guest-reset"].includes(context.failureModel) &&
    healthy(expectation.before);
  if (!valid) throw new Error("checkpoint evidence is absent, invalid or belongs to another state");
  const currentBoot = await ports.bootId();
  if (!uuid(currentBoot) || currentBoot === expectation.bootId) throw new Error("no new boot observed after checkpoint");
  const first = await ports.observe();
  const recovery = await ports.recover();
  const second = await ports.observe();
  const passed = healthy(first) && healthy(second) && recovery?.ok === true && recovery.started === true &&
    recovery.exitCode === 0 && recovery.signal === null && recovery.timedOut === false && recovery.forced === false && recovery.error === null;
  return { schema: 2, lane: "powercut", phase: "verify", runId: expectation.runId, failureModel: context.failureModel,
    status: passed ? "PASS" : "FAIL", beforeCut: expectation.before, afterReboot: first, recovery, afterReconcile: second,
    simulationPassed: context.failureModel === "simulation" && passed,
    guestRestartProven: context.failureModel === "guest-reset" && passed,
    powerLossProven: false, sigkillLaneReplaced: false,
    note: "simulation and guest reset do not prove external VM or physical power loss" };
}

export async function main(argv = process.argv) {
  const value = name => { const index = argv.indexOf(name); return index < 0 ? undefined : argv[index + 1]; };
  const phase = value("--phase"), stateRoot = value("--state"), society = value("--society"), out = value("--out");
  if (!["prepare", "verify"].includes(phase ?? ""))
    return emit(4, { status: "UNSUPPORTED_PROFILE", lane: "powercut", failures: ["--phase must be prepare or verify"], powerLossProven: false });
  const failures = powercutGuards({ stateRoot, society, out });
  if (failures.length > 0)
    return emit(4, { status: "UNSUPPORTED_PROFILE", lane: "powercut", failures, powerLossProven: false });
  const context = { stateRoot, society, failureModel: "guest-reset" };
  const ports = { observe: () => observe(stateRoot, society), bootId, recover: () => recover(stateRoot, society) };
  try {
    if (phase === "prepare") {
      // A run owns a fresh directory; old evidence cannot authorize a new cut.
      fs.mkdirSync(out);
      await prepareCheckpoint(context, { ...ports,
        persist: expectation => { fsyncFile(path.join(out, "expectation.json"), JSON.stringify(expectation, null, 2) + "\n"); fsyncPath(out); fsyncPath(path.dirname(out)); },
        cut: () => { fs.writeFileSync(SYSRQ, "b"); throw new Error("guest restart request returned without restarting"); },
      });
    } else {
      const expectation = JSON.parse(fs.readFileSync(path.join(out, "expectation.json"), "utf8"));
      const comparison = await verifyCheckpoint(context, expectation, ports);
      fsyncFile(path.join(out, `comparison-${randomUUID()}.json`), JSON.stringify(comparison, null, 2) + "\n");
      fsyncPath(out);
      emit(comparison.status === "PASS" ? 0 : 1, comparison);
    }
  } catch (error) {
    emit(1, { status: "FAIL", lane: "powercut", error: error.message, powerLossProven: false });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
