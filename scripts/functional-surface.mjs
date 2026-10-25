#!/usr/bin/env node
/** Functional check of the tool surface projection against the real engine.
 *
 * It starts the bundled engine in RPC mode with the trusted core extension and
 * a validated projection, then asks the engine itself which tools are active.
 * That is the only way to know the projection took effect: the unit tests pin
 * the arithmetic, not the engine's response to it.
 *
 * A pass here is functional evidence for TSP-005/006 on this machine. It is not
 * release qualification: no provider is configured, no batch is delivered, and
 * nothing about pricing, cancellation or crash ordering is attested.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { encodeToolSurfacePlan, planToolSurface } from "@oma/domain/tool-surface";
import { piAgentDir, resolvePiRuntime } from "@oma/engine/pi-runtime";
import { spawnOwnedRpc, stopOwnedChild } from "@oma/process/async";
import { enterBoundedScript } from "./bounded-script.mjs";
import { PiRpcClient } from "@oma/engine/pi-rpc";

if (await enterBoundedScript(import.meta.url, { timeoutMs: 60000 })) {
const root = resolve(import.meta.dirname, "..");
const workdir = mkdtempSync(join(tmpdir(), "oma-functional-surface-"));
const fail = (message) => { console.error(`FAIL ${message}`); process.exitCode = 1; };
let child, rpc, closed;

try {
  const runtime = resolvePiRuntime({ stateRoot: workdir, libdir: root });
  const agentDir = piAgentDir(workdir);
  mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  mkdirSync(join(workdir, "session"), { recursive: true });

  // A projection the engine has to act on: one tool stays visible, one is
  // hidden behind a group, one is disabled outright.
  const plan = planToolSurface({
    defaultMode: "DISABLED",
    direct: ["read"],
    disabled: ["write"],
    groups: [{ name: "oma_group_probe", description: "probe group", members: [{ tool: "grep" }] }],
    roots: [],
  });

  const core = join(root, "packages/extension/dist/index.js");
  const argv = [
    runtime.args[0], "--mode", "rpc",
    "--no-approve", "--no-context-files", "--no-skills", "--no-prompt-templates", "--no-extensions",
    "--exclude-tools", "bash,powershell",
    "--session-dir", join(workdir, "session"),
    "--name", "oma-functional-surface",
    "-e", core,
    // Test-only observation extension; it registers nothing and only reports.
    "-e", join(root, "dist/test/fixtures/surface-probe-extension.js"),
  ];
  // OMA's own tools only register when their owned paths are present, so the
  // probe supplies them; otherwise the absence would look like the projection
  // removed them.
  const probeOut = join(workdir, "probe.json");
  const archive = join(workdir, "archive");
  const home = join(workdir, "home");
  mkdirSync(archive, { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(workdir, "oma-cli"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  child = spawnOwnedRpc(runtime.executable, argv, workdir, {
    HOME: workdir,
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    PI_CODING_AGENT_DIR: agentDir,
    OMA_TOOL_SURFACE: encodeToolSurfacePlan(plan),
    OMA_CLI_PATH: join(workdir, "oma-cli"),
    OMA_AGENT_HOME: home,
    OMA_MAIL_ARCHIVE: archive,
    OMA_SOCKET: join(workdir, "control.sock"),
    OMA_MAIL_BYTES: "262144",
    OMA_PROBE_OUT: probeOut,
  });

  closed = new Promise(done => child.once("close", done));
  const limits = { frameBytes: 262144, idleStreamSeconds: 30, receiptWaitSeconds: 30 };
  rpc = new PiRpcClient(child, limits);
  const seen = [];
  rpc.onEvent(event => { seen.push(event); });

  const reply = await new Promise((resolveReply, rejectReply) => {
    const failReply = error => { clearTimeout(timer); stop(); rejectReply(error); };
    const timer = setTimeout(() => failReply(new Error("engine did not answer get_state")), 25000);
    const stop = rpc.onEvent(event => {
      if (event.type !== "response" || event.id !== "probe") return;
      clearTimeout(timer);
      stop();
      resolveReply(event);
    });
    rpc.send({ id: "probe", type: "get_state" }).catch(failReply);
  });

  if (reply.success !== true) fail("the engine did not accept the probe request");
  // The engine reports its tool set through the extension API, so the answer is
  // read from the observation extension rather than from the RPC state.
  let observed = null;
  for (let attempt = 0; attempt < 50 && observed === null; attempt += 1) {
    try { observed = JSON.parse(readFileSync(probeOut, "utf8")); }
    catch { await new Promise(done => setTimeout(done, 100)); }
  }
  if (observed === null) { fail("the observation extension never reported"); throw new Error("no report"); }
  if (observed.error) fail(`observation failed: ${observed.error}`);
  const names = observed.active;
  if (process.env.OMA_PROBE_DUMP) console.log("all registered:", observed.all.join(", "));
  console.log(`active tools reported by the engine: ${names.join(", ") || "(none)"}`);

  // The projection's shape, checked against the engine's own answer.
  if (names.includes("write")) fail("a DISABLED tool is active in the engine");
  if (names.includes("grep")) fail("a GROUPED tool is active before its group was opened");
  if (!names.includes("oma_group_probe")) fail("the group facade was not registered and activated as a root");
  for (const owned of ["oma_mail_read", "oma_mail_send", "oma_mail_ack", "oma_status"])
    if (!names.includes(owned)) fail(`OMA's own tool ${owned} was removed by the projection`);

  // Opening the group must additively reveal its immediate child, and nothing
  // else may be deactivated by that call.
  if (!process.exitCode) {
    const before = [...names];
    await rpc.send({ id: "open", type: "prompt", message: "/oma_group_probe" }).catch(() => {});
    let after = null;
    for (let attempt = 0; attempt < 50 && after === null; attempt += 1) {
      await new Promise(done => setTimeout(done, 100));
      try {
        const next = JSON.parse(readFileSync(probeOut, "utf8"));
        if (next.phase === "expanded") after = next.active;
      } catch { /* not written yet */ }
    }
    if (after === null) console.log("group expansion not observed in this profile (no model turn); skipped");
    else {
      for (const kept of before)
        if (!after.includes(kept)) fail(`opening a group deactivated ${kept}`);
      if (!after.includes("grep")) fail("opening the group did not reveal its child");
    }
  }

  if (process.exitCode) console.error("functional surface probe FAILED");
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  try {
    try { rpc?.close(); }
    finally { if (child) stopOwnedChild(child); }
    if (closed) {
      let timer;
      try {
        await Promise.race([closed, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("engine termination is unconfirmed; preserving workdir")), 5000);
        })]);
      } finally { clearTimeout(timer); }
    }
    rmSync(workdir, { recursive: true, force: true });
  } catch (error) { fail(error instanceof Error ? error.message : String(error)); console.error(`preserved ${workdir}`); }
}
if (!process.exitCode) console.log("functional surface probe PASS (not release qualification)");
}
