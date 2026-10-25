/** AV4 -- FS-005, SB-006 and INV03: host code treats a directory a Resident
 * writes as untrusted input.
 *
 * A Resident's workspace, home and session directory are inside the state
 * tree and writable from its sandbox. Host code that names something in them
 * resolves it once, beneath the directory, following no link at any
 * component -- never "check the path, then open the path" -- and runs no tool
 * those directories configure once a run has had them.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs, { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync, copyFileSync, truncateSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { observeDeliveryReceipt, publishDeliveryReceipt } from "@oma/storage/delivery-receipt";
import { runnerReceiptPathAt, runnerSessionDirPathAt, workspacePathAt } from "@oma/domain/paths";
import { WorkspaceCoordinator } from "@oma/git/workspace";
import { CreationPublicationObserver } from "@oma/lifecycle/create-publication";
import { boundaryOf, completeSession, preparedFixture } from "./fixtures/delivery-receipt.js";
import { TEST_VIEW_LIMITS } from "./fixtures/limits.js";

/** Replaces `component` with a link to `elsewhere` the first time any
 * pathname check of the fs module is asked about something beneath it -- the
 * instant between "resolve the named path" and "open the path again". */
function trapBetweenCheckAndUse(component: string, elsewhere: string): () => void {
  const names = ["realpathSync", "lstatSync", "statSync", "existsSync", "accessSync"] as const;
  const originals = Object.fromEntries(names.map(name => [name, fs[name]])) as Record<(typeof names)[number], (...args: unknown[]) => unknown>;
  let sprung = false;
  for (const name of names) {
    (fs as unknown as Record<string, unknown>)[name] = function (this: unknown, path: unknown, ...rest: unknown[]) {
      const result = originals[name].call(this, path, ...rest);
      if (!sprung && typeof path === "string" && path.startsWith(`${component}/`)) {
        sprung = true;
        renameSync(component, `${component}.real`); symlinkSync(elsewhere, component);
      }
      return result;
    };
  }
  syncBuiltinESMExports();
  return () => { for (const name of names) (fs as unknown as Record<string, unknown>)[name] = originals[name]; syncBuiltinESMExports(); };
}

test("AV4 / FS-005, SB-006: a receipt's session is found beneath its directory in one resolution; a link at any component is never followed", async () => {
  const f = await preparedFixture();
  const outside = mkdtempSync(join(tmpdir(), "oma-av4-outside-"));
  try {
    const sessions = runnerSessionDirPathAt(f.root, "alice");
    mkdirSync(join(sessions, "sub"), { recursive: true, mode: 0o700 });
    const session = completeSession(f.root, f.batch, "sub/delivery.jsonl");
    // The boundary the receipt would name is complete, but outside: the
    // component on the way is a link to it. Publication finds the session in
    // one resolution that follows no link, so nothing is published.
    copyFileSync(session, join(outside, "delivery.jsonl"));
    rmSync(join(sessions, "sub"), { recursive: true, force: true });
    symlinkSync(outside, join(sessions, "sub"));
    assert.throws(() => publishDeliveryReceipt(f.root, f.batch, boundaryOf(f.batch, session), TEST_VIEW_LIMITS.frameBytes));
    assert.equal(existsSync(runnerReceiptPathAt(f.root, "alice", f.batch.id)), false, "a receipt was published from a session outside");
    // The same check-then-use trap on the session's directory: the one resolution sees the empty file inside.
    rmSync(join(sessions, "sub"));
    mkdirSync(join(sessions, "sub"), { mode: 0o700 });
    writeFileSync(session, "");
    const restore = trapBetweenCheckAndUse(join(sessions, "sub"), outside);
    try { assert.throws(() => publishDeliveryReceipt(f.root, f.batch, boundaryOf(f.batch, session), TEST_VIEW_LIMITS.frameBytes), { code: "SESSION_BOUNDARY_UNCONFIRMED" }); }
    finally { restore(); }
    // P0V-107: once published, a receipt is not judged by the session file again.
    completeSession(f.root, f.batch, "sub/delivery.jsonl");
    publishDeliveryReceipt(f.root, f.batch, boundaryOf(f.batch, session), TEST_VIEW_LIMITS.frameBytes);
    truncateSync(session, 0);
    assert.equal(observeDeliveryReceipt(f.root, f.batch, TEST_VIEW_LIMITS.frameBytes).kind, "verified");
  } finally { rmSync(outside, { recursive: true, force: true }); f.close(); }
});

function project(root: string): { projectGit: string; oid: string } {
  const git = (cwd: string, ...args: string[]) => {
    const run = spawnSync("git", args, { cwd, encoding: "utf8", env: { PATH: "/usr/bin:/bin", HOME: root,
      GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
    assert.equal(run.status, 0, run.stderr); return run.stdout.trim();
  };
  const source = join(root, "source"); mkdirSync(source);
  git(source, "init", "-q", "-b", "main"); writeFileSync(join(source, "README"), "x\n");
  git(source, "add", "README"); git(source, "commit", "-q", "-m", "base");
  const projectGit = join(root, "repos", "project.git"); mkdirSync(join(root, "repos"));
  git(root, "clone", "-q", "--bare", source, projectGit);
  return { projectGit, oid: git(source, "rev-parse", "HEAD") };
}

test("AV4 / INV03: once readiness is a settled fact, create recovery runs no Git in the workspace and walks nothing in it", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-av4-create-"));
  try {
    const { projectGit, oid } = project(root);
    const workspace = workspacePathAt(root, "alice");
    const plan = { spec: { name: "alice", from: oid, profile: "p" }, workspacePath: workspace, specHash: "h" } as never;
    const workspaces = new WorkspaceCoordinator({ stateRoot: root, projectGit });
    await workspaces.ensure(plan, false);
    // The Resident has had its workspace: its HEAD is whatever it wrote.
    writeFileSync(join(workspace, ".git", "HEAD"), "not a ref\n");
    await assert.rejects(() => workspaces.ensure(plan, false), (error: unknown) => (error as { code?: string }).code === "STORE_CORRUPT",
      "a workspace whose readiness is not yet proven is still verified");
    await workspaces.ensure(plan, true);
    // Readiness is the same rule, keyed on the recorded fact, not on whether a
    // run happens to have opened yet: enabled with no run, and enabled after one.
    let ensured = 0;
    const agent = { specHash: "h", incarnation: 0, desired: "enabled" };
    const store = { getAgent: () => agent, transaction: (body: (tx: unknown) => unknown) => body({ updateAgent: () => { throw new Error("no change is due"); } }) };
    const observer = new CreationPublicationObserver(store as never, { ensureResident: () => { ensured += 1; } } as never, root, workspaces);
    const operation = { id: "op", actor: "principal", planJson: "{}", state: "pending",
      plan: { existingCreation: null, initialMessage: {}, workspacePath: workspace, specHash: "h", spec: { name: "alice", from: oid, profile: "p" } } } as never;
    assert.doesNotThrow(() => observer.ready(operation));
    agent.incarnation = 1;
    assert.doesNotThrow(() => observer.ready(operation));
    assert.equal(ensured, 2);
    // While the agent is still provisioning it is the host's to verify, and it is wrong.
    agent.incarnation = 0; agent.desired = "provisioning";
    assert.throws(() => observer.ready(operation), (error: unknown) => (error as { code?: string }).code === "STORE_CORRUPT");
    // A provisioning agent with an opened run contradicts the only way a run opens.
    agent.incarnation = 1;
    assert.throws(() => observer.ready(operation), /a provisioning agent has opened a run/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
