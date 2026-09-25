/** AV3: an actor's model tools work in a directory that holds nothing the
 * product keeps for itself.
 *
 * The Principal's engine used to be started with its private space as its
 * workspace, so the model's read/write/edit tools reached the Human's session
 * history beside it (PR-003/PR-004). The rule now has one owner
 * (`modelWorkspaceFor`) and one check (`assertModelScope`), applied where each
 * kind of engine is started.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertModelScope, modelWorkspacePathAt, sessionDirPathAt, workspacePathAt, runnerSessionDirPathAt, runnerViewPathAt, agentRootPathAt } from "../src/storage/paths.js";
import { principalEnvironment, PrincipalSession } from "../src/tui/session.js";
import { planPiSpawn } from "../src/runtime/pi-spawn-plan.js";
import { guardWorkspaceTools } from "../src/extension/workspace-guard.js";

const code = (error: unknown): string | undefined => (error as { code?: string }).code;

test("AV3: the Principal's model scope holds neither the Human's session history nor the CLI's home", async () => {
  const state = mkdtempSync(join(tmpdir(), "oma-av3-"));
  try {
    const workspace = modelWorkspacePathAt(state, "principal");
    const sessions = sessionDirPathAt(state, "principal");
    const home = principalEnvironment({ stateRoot: state, runRoot: join(state, "run"), libdir: "/opt/oma" },
      { society: "demo", provider: "p", model: "m", extensions: [], workspaceBytes: 1024 },
      { frameBytes: 1024, mailBodyBytes: 1024, batchMaxMessages: 4 }).HOME!;
    assert.doesNotThrow(() => assertModelScope(workspace, [sessions], [home]));
    // The home holds the workspace, never the other way round.
    assert.throws(() => assertModelScope(home, [sessions]), (error: unknown) => code(error) === "UNSUPPORTED_PROFILE");
    // The guard the model's tools pass through, on that workspace, refuses the
    // session file beside it.
    mkdirSync(workspace, { recursive: true }); mkdirSync(sessions, { recursive: true });
    const history = join(sessions, "2026-09-25.jsonl"); writeFileSync(history, "{}\n");
    let handler: ((event: { toolName: string; input: Record<string, unknown> }) => unknown) | null = null;
    guardWorkspaceTools({ on: (_name: string, listener: typeof handler) => { handler = listener; } } as never, workspace, 1024);
    for (const toolName of ["read", "write", "edit"]) {
      const verdict = handler!({ toolName, input: { path: history, content: "x", newText: "x" } }) as { block?: boolean } | undefined;
      assert.equal(verdict?.block, true, `${toolName} reached the session history`);
      const relative = handler!({ toolName, input: { path: "../sessions/2026-09-25.jsonl", content: "x", newText: "x" } }) as { block?: boolean } | undefined;
      assert.equal(relative?.block, true, `${toolName} reached the session history by a relative path`);
    }
  } finally { rmSync(state, { recursive: true, force: true }); }
});

test("AV3: an engine whose workspace overlaps what the product keeps is refused before it starts", () => {
  const state = "/srv/oma-av3";
  const privateSpace = join(state, "principal", "private");
  // The former Principal layout: the workspace was the private space itself.
  assert.throws(() => PrincipalSession.start({ piCommand: "/nonexistent/pi", coreExtension: "/nonexistent/ext.js",
    sessionDir: sessionDirPathAt(state, "principal"), workspace: privateSpace, home: privateSpace },
  { society: "demo", provider: "p", model: "m", extensions: [], workspaceBytes: 1024 },
  { frameBytes: 1024, idleStreamSeconds: 1, receiptWaitSeconds: 1, batchMaxMessages: 4, mailBodyBytes: 1024 } as never, {},
  { onLine: () => {}, onBusy: () => {}, onEnd: () => {}, onPromptFailed: () => {} }),
  (error: unknown) => code(error) === "UNSUPPORTED_PROFILE");
  // A Resident plan with the same overlap, in each direction, is refused the same way.
  const paths = (workspace: string) => ({ piCommand: "/usr/bin/node", coreExtension: "/opt/oma/ext.js", cli: "/opt/oma/cli.js",
    workspace, sessionDir: runnerSessionDirPathAt(state, "alice"), agentHome: join(agentRootPathAt(state, "alice"), "home"),
    mailArchive: join(state, "mail", "archive", "cur"), batchView: runnerViewPathAt(state, "alice"), socket: "/run/oma/control.sock" });
  const options = (workspace: string) => ({ actor: "alice", society: "demo", paths: paths(workspace),
    profile: { provider: "p", model: "m", turnSeconds: 1, prompt: "", workspaceBytes: 1024, extensions: [] },
    limits: { frameBytes: 1024, idleStreamSeconds: 1, receiptWaitSeconds: 1, batchMaxMessages: 4, mailBodyBytes: 1024 } }) as never;
  for (const workspace of [agentRootPathAt(state, "alice"), join(runnerSessionDirPathAt(state, "alice"), "w")])
    assert.throws(() => planPiSpawn(options(workspace)), (error: unknown) => code(error) === "UNSUPPORTED_PROFILE", workspace);
  assert.doesNotThrow(() => planPiSpawn(options(workspacePathAt(state, "alice"))));
});
