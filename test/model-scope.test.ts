import { residentEngineEffects } from "#oma-test/app/engine/resident-effects";
import { engineStartEffects } from "#oma-test/app/engine/start-effects";
/** AV3: an actor's model tools work in a directory that holds nothing the
 * product keeps from the model (PR-003/PR-004), and the Principal's CLI cache
 * is in that same private scratch (FS-003).
 *
 * The Principal's engine used to be started with its private space as its
 * workspace, so the model's read/write/edit tools reached the Human's session
 * history beside it. Where an actor's model works has one owner
 * (`modelWorkspaceFor`, INV04) and one check where each engine starts
 * (`assertModelScope`, INV09).
 */
import test from "node:test";
import { residentOptions } from "./fixtures/resident.js";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertModelScope, modelWorkspacePathAt, sessionDirPathAt, workspacePathAt, runnerSessionDirPathAt, runnerViewPathAt, agentRootPathAt } from "@oma/domain/paths";
import { principalEnvironment, principalWorkspace, PrincipalSession } from "@oma/engine/principal-session";
import { planPiSpawn } from "@oma/engine/pi-spawn-plan";
import { piAgentDir } from "@oma/engine/pi-runtime";
import { guardWorkspaceTools } from "@oma/tool-runtime/workspace-guard";

const code = (error: unknown): string | undefined => (error as { code?: string }).code;

test("AV3 / PR-003, PR-004, FS-003: the Principal's model scope holds neither the Human's session history nor the engine's credentials", async () => {
  const state = mkdtempSync(join(tmpdir(), "oma-av3-"));
  try {
    const workspace = modelWorkspacePathAt(state, "principal");
    assert.equal(principalWorkspace(state), workspace);
    const sessions = sessionDirPathAt(state, "principal");
    const environment = principalEnvironment({ stateRoot: state, runRoot: join(state, "run"), libdir: "/opt/oma" },
      { society: "demo", provider: "p", model: "m", extensions: [] },
      { frameBytes: 1024, mailBodyBytes: 1024, batchMaxMessages: 4, addresses: 64, contextBytes: 4096, bundleBytes: 8192 });
    // FS-003: the CLI's home, and so its request cache, is the private scratch.
    assert.equal(environment.HOME, workspace);
    assert.equal(environment.OMA_AGENT_HOME, workspace);
    assert.doesNotThrow(() => assertModelScope(workspace, [sessions, piAgentDir(state)]));
    // The former layout -- the private space itself -- holds the session history.
    assert.throws(() => assertModelScope(join(state, "principal", "private"), [sessions]), (error: unknown) => code(error) === "UNSUPPORTED_PROFILE");
    // The guard the model's tools pass through, on that workspace, refuses the
    // session file beside it.
    mkdirSync(workspace, { recursive: true }); mkdirSync(sessions, { recursive: true });
    const history = join(sessions, "2026-09-25.jsonl"); writeFileSync(history, "{}\n");
    let handler: ((event: { toolName: string; input: Record<string, unknown> }) => unknown) | null = null;
    guardWorkspaceTools({ on: (_name: string, listener: typeof handler) => { handler = listener; } } as never, workspace);
    for (const toolName of ["read", "write", "edit"]) {
      const verdict = handler!({ toolName, input: { path: history, content: "x", newText: "x" } }) as { block?: boolean } | undefined;
      assert.equal(verdict?.block, true, `${toolName} reached the session history`);
      const relative = handler!({ toolName, input: { path: "../sessions/2026-09-25.jsonl", content: "x", newText: "x" } }) as { block?: boolean } | undefined;
      assert.equal(relative?.block, true, `${toolName} reached the session history by a relative path`);
    }
  } finally { rmSync(state, { recursive: true, force: true }); }
});

test("AV3 / INV04, INV09, PR-004: an engine whose workspace overlaps what the product keeps is refused before it starts", () => {
  const state = "/srv/oma-av3";
  const privateSpace = join(state, "principal", "private");
  // The former Principal layout: the workspace was the private space itself.
  assert.throws(() => PrincipalSession.start(engineStartEffects, { piCommand: "/nonexistent/pi", coreExtension: "/nonexistent/ext.js",
    sessionDir: sessionDirPathAt(state, "principal"), workspace: privateSpace, home: privateSpace, piAgentDir: piAgentDir(state) },
  { society: "demo", provider: "p", model: "m", extensions: [] },
  { frameBytes: 1024, idleStreamSeconds: 1, receiptWaitSeconds: 1, batchMaxMessages: 4, mailBodyBytes: 1024 } as never, {},
  { onLine: () => {}, onBusy: () => {}, onEnd: () => {}, onPromptFailed: () => {} }),
  (error: unknown) => code(error) === "UNSUPPORTED_PROFILE");
  // A workspace inside the engine's own agent directory would hand the model the
  // provider credentials (PR-004), whatever else it avoids.
  assert.throws(() => PrincipalSession.start(engineStartEffects, { piCommand: "/nonexistent/pi", coreExtension: "/nonexistent/ext.js",
    sessionDir: sessionDirPathAt(state, "principal"), workspace: join(piAgentDir(state), "scratch"), home: join(piAgentDir(state), "scratch"),
    piAgentDir: piAgentDir(state) },
  { society: "demo", provider: "p", model: "m", extensions: [] },
  { frameBytes: 1024, idleStreamSeconds: 1, receiptWaitSeconds: 1, batchMaxMessages: 4, mailBodyBytes: 1024 } as never, {},
  { onLine: () => {}, onBusy: () => {}, onEnd: () => {}, onPromptFailed: () => {} }),
  (error: unknown) => code(error) === "UNSUPPORTED_PROFILE");
  // A Resident plan with the same overlap, in each direction, is refused the same way.
  const base = residentOptions(state);
  const options = (workspace: string) => ({ ...base, paths: { ...base.paths, workspace } });
  for (const workspace of [agentRootPathAt(state, "alice"), join(runnerSessionDirPathAt(state, "alice"), "w")])
    assert.throws(() => planPiSpawn(residentEngineEffects.sandbox, options(workspace)), (error: unknown) => code(error) === "UNSUPPORTED_PROFILE", workspace);
  assert.doesNotThrow(() => planPiSpawn(residentEngineEffects.sandbox, options(workspacePathAt(state, "alice"))));
});
