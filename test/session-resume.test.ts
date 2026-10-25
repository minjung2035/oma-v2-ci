import { residentEngineEffects } from "#oma-test/app/engine/resident-effects";
/** AV14 -- arch §7: the runner joins one Pi session to the mail queue, and an
 * activation resumes it ("resume Pi session or create a new session"); PR-003/TUI-004:
 * the Principal's Human context stays in its existing session.
 *
 * The functional run with a real provider found every Resident activation
 * starting a new session, so a Resident woken by new mail had lost what it had
 * done, and every TUI run starting a new Principal session. These run the real
 * bundled engine with the argv the product builds and ask it which session it
 * opened.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PiAdapter } from "@oma/engine/pi-adapter";
import { residentOptions, prepareResident, RESIDENT_TEST_OPTIONS } from "./fixtures/resident.js";
import { spawnSandboxed } from "@oma/platform-linux/worker-spawn";
import { RESIDENT_PATHS } from "@oma/domain/resident-paths";
import { resolvePiRuntime } from "@oma/engine/pi-runtime";
import { sessionArgv } from "@oma/engine/principal-session";

const LIBDIR = fileURLToPath(new URL("../../", import.meta.url));
const LIMITS = { frameBytes: 1 << 20, idleStreamSeconds: 60, receiptWaitSeconds: 30, batchMaxMessages: 4, mailBodyBytes: 1 << 16, addresses: 64, contextBytes: 1 << 20, bundleBytes: 1 << 20 };

/** Starts the engine with this argv and returns the session file it reports. */
async function openedSession(command: string, args: readonly string[], cwd: string, env: Record<string, string>, filter?: Uint8Array): Promise<string> {
  const child = filter === undefined ? spawn(command, [...args], { cwd, env, stdio: ["pipe", "pipe", "pipe"] })
    : spawnSandboxed([command, ...args], env, filter, cwd);
  try {
    let out = "";
    child.stdout.setEncoding("utf8");
    const answer = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`the engine did not answer: ${out.slice(0, 300)}`)), 20_000);
      child.stdout.on("data", chunk => {
        out += chunk;
        for (const line of out.split("\n")) {
          let frame: { id?: string; data?: { sessionFile?: string } };
          try { frame = JSON.parse(line) as typeof frame; } catch { continue; }
          if (frame.id === "state") { clearTimeout(timer); resolve(frame.data?.sessionFile ?? ""); }
        }
      });
    });
    child.stdin.write(`${JSON.stringify({ id: "state", type: "get_state" })}\n`);
    return await answer;
  } finally { await stopped(child); }
}
/** INV02: a signal is not a death. The engine is asked to stop and then waited
 * for, so nothing it still writes (settings, the session file) races the test's
 * removal of its directories. */
async function stopped(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill();
  const forced = setTimeout(() => child.kill("SIGKILL"), 5_000);
  try { await exited; } finally { clearTimeout(forced); }
}
/** A session the agent already had: the header the engine writes (session-format.md). */
function priorSession(dir: string, cwd: string): string {
  const path = join(dir, "2026-01-01T00-00-00-000Z_prior.jsonl");
  writeFileSync(path, `${JSON.stringify({ type: "session", version: 3, id: "0190f000-0000-7000-8000-000000000001", timestamp: "2026-01-01T00:00:00.000Z", cwd })}\n`);
  return path;
}

test("AV14 / arch §7: a Resident's activation resumes its existing session instead of starting another", { ...RESIDENT_TEST_OPTIONS, timeout: 60_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-av14-resident-"));
  try {
    const runtime = resolvePiRuntime({ stateRoot: root, libdir: LIBDIR });
    const options = residentOptions(root, LIBDIR, runtime.args[0]!);
    prepareResident(options);
    const adapter = new PiAdapter(residentEngineEffects, { ...options, limits: LIMITS });
    const plan = adapter.spawnPlan();
    const prior = priorSession(options.paths.sessionDir, RESIDENT_PATHS.workspace);
    assert.equal(await openedSession(plan.command, plan.args, plan.cwd, plan.env, plan.input), join(RESIDENT_PATHS.sessions, prior.split("/").at(-1)!),
      "the activation started a new session beside the one the Resident had");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("AV14 / PR-003, TUI-004: a TUI run resumes the Principal's existing session", { timeout: 60_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-av14-principal-"));
  try {
    const runtime = resolvePiRuntime({ stateRoot: root, libdir: LIBDIR });
    const workspace = join(root, "workspace"); const sessions = join(root, "sessions"); const agent = join(root, "agent");
    for (const path of [workspace, sessions, agent]) mkdirSync(path, { recursive: true });
    const args = sessionArgv({ piCommand: runtime.executable, piArgs: [...runtime.args], coreExtension: join(LIBDIR, "packages/extension/dist/index.js"),
      sessionDir: sessions, workspace, home: workspace, piAgentDir: agent } as never,
      { society: "s", provider: "pi", model: "current", extensions: [] } as never);
    const prior = priorSession(sessions, workspace);
    assert.equal(await openedSession(runtime.executable, [...runtime.args, ...args], workspace,
      { HOME: workspace, PATH: "/usr/bin:/bin", PI_CODING_AGENT_DIR: agent }), prior,
      "the TUI started a new Principal session beside the Human's");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
