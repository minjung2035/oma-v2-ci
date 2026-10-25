import { createMailModule } from "#oma-test/app/broker/mail-composition";
import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { generateBatchId } from "@oma/native/identity";
import { makeValidAgent } from "./fixtures/spec.js";
import { TEST_VIEW_LIMITS } from "./fixtures/limits.js";
import { gitFixture, gitAuth, seedGit, gitCommand, submitFixture } from "./fixtures/git-crash.js";
import { assertGlobalInvariants, type InvariantPhase } from "./invariants/index.js";
import { removeTree } from "./fixtures/cleanup.js";

async function killExistingCheckpoint(root: string, point: string): Promise<void> {
  const child = fork(new URL("./fixtures/crash-worker.js", import.meta.url), [root, point], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let diagnostic = Buffer.alloc(0); let reached = false;
  child.stderr!.on("data", (bytes: Buffer) => { diagnostic = Buffer.concat([diagnostic, bytes]).subarray(-64 * 1024); });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`checkpoint not reached: ${point}: ${diagnostic.toString()}`)); }, 10000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("message", message => {
        if (typeof message === "object" && message !== null && "point" in message && message.point === point) {
          reached = true; child.kill("SIGKILL");
        }
      });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        if (reached && signal === "SIGKILL") resolve(); else reject(new Error(`checkpoint ${point}: ${code}/${signal}: ${diagnostic.toString()}`));
      });
    });
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
}
function normal(root: string) {
  const store = new Store(join(root, "runtime.sqlite"), 0, { society: "crash" });
  if (store.listAgents().length === 0) store.transaction(tx => {
    for (const name of ["a", "b", "c"]) tx.insertAgent(makeValidAgent(name));
  });
  const mail = createMailModule({ stateRoot: root, society: "crash" }, store, 64, 24, TEST_VIEW_LIMITS);
  return { store, mail };
}
function context(root: string, phase: InvariantPhase) { return { stateRoot: root, society: "crash", phase, viewLimits: TEST_VIEW_LIMITS }; }
function mutateRawRowAfterClose(path: string, sql: string, parameters: (string | number | null)[] = []): void {
  const raw = new DatabaseSync(path);
  try { raw.exec("PRAGMA foreign_keys=ON"); raw.prepare(sql).run(...parameters); } finally { raw.close(); }
}

for (const point of ["stage", "object", "accepted", "archive", "inbox-a", "inbox-b", "prepared", "cur"]) {
  test(`R33 existing SIGKILL ${point}: allowed partial state and immutable settled recovery`, async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-global-mail-"));
    let fixture = normal(root); let open = true;
    try {
      assertGlobalInvariants(fixture.store, context(root, "settled"));
      if (point === "prepared" || point === "cur") await fixture.mail.send(gitAuth, "crash-send", { to: ["a", "b", "c"], subject: "crash", kind: "message", body: "immutable payload" });
      fixture.store.close(); open = false;
      await killExistingCheckpoint(root, point);
      fixture = normal(root); open = true;
      const before = assertGlobalInvariants(fixture.store, context(root, "partial-materialization")).ledger;
      if (before.operations.length === 0) await fixture.mail.send(gitAuth, "crash-send", { to: ["a", "b", "c"], subject: "crash", kind: "message", body: "immutable payload" });
      await fixture.mail.reconcilePending();
      if (point === "prepared" || point === "cur") await fixture.mail.prepare(gitAuth);
      const settled = assertGlobalInvariants(fixture.store, { ...context(root, "settled"), before });
      const repeated = assertGlobalInvariants(fixture.store, { ...context(root, "settled"), before: settled.ledger });
      assert.deepEqual(repeated.ledger.raw, settled.ledger.raw, "checker must not write rows or timestamps");
      assert.deepEqual(repeated.incomplete, []);
    } finally { if (open) fixture.store.close(); removeTree(root); }
  });
}

for (const point of ["submit-accepted", "submit-ref", "ctx-cas", "ctx-mail", "int-cas"]) {
  test(`R33 existing SIGKILL ${point}: global Git/mail relations after repeated recovery`, async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-global-git-")); let fixture = normal(root); let open = true;
    try {
      seedGit(root);
      const paths = gitFixture(root, fixture.store).paths;
      assertGlobalInvariants(fixture.store, { ...context(root, "settled"), git: paths });
      if (point.startsWith("int-")) await submitFixture(root, gitFixture(root, fixture.store).git, "pre-published");
      fixture.store.close(); open = false; await killExistingCheckpoint(root, point);
      fixture = normal(root); open = true;
      const before = assertGlobalInvariants(fixture.store, { ...context(root, "partial-materialization"), git: paths }).ledger;
      const { git } = gitFixture(root, fixture.store);
      for (const id of fixture.store.recoverableOperations()) await git.reconcile(id);
      const after = assertGlobalInvariants(fixture.store, { ...context(root, "settled"), git: paths, before });
      for (const operation of after.ledger.operations) await git.reconcile(operation.id);
      const again = assertGlobalInvariants(fixture.store, { ...context(root, "settled"), git: paths, before: after.ledger });
      assert.deepEqual(again.ledger.raw, after.ledger.raw);
    } finally { if (open) fixture.store.close(); removeTree(root); }
  });
}

for (const corruption of ["missing-source", "extra-delivery", "duplicate-batch-link"] as const) {
  test(`R33 checker negative control: ${corruption}`, async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-invariant-mutation-")); let fixture = normal(root); let open = true;
    try {
      const receipt = await fixture.mail.send(gitAuth, "valid", { to: ["b"], subject: "valid", kind: "message", body: "frozen" });
      assert.equal(receipt.state, "succeeded");
      const operation = fixture.store.getOperation("a", "valid")!;
      assert.equal(operation.kind, "mail.send"); if (operation.kind !== "mail.send") throw new Error("unexpected fixture");
      const message = operation.plan.message;
      if (corruption === "duplicate-batch-link") await fixture.mail.prepare({ ...gitAuth, actor: "b" });
      const healthy = assertGlobalInvariants(fixture.store, context(root, "settled"));
      const bytes = readFileSync(fixture.mail.objectPath(message.id));
      fixture.store.close(); open = false;
      if (corruption === "missing-source") rmSync(fixture.mail.objectPath(message.id));
      if (corruption === "extra-delivery") mutateRawRowAfterClose(join(root, "runtime.sqlite"),
        "INSERT INTO deliveries(message_id,recipient,operation_id,created_at_ms) VALUES(?,?,?,?)", [message.id, "c", operation.id, operation.createdAtMs]);
      if (corruption === "duplicate-batch-link") mutateRawRowAfterClose(join(root, "runtime.sqlite"),
        "INSERT INTO batches(id,agent,incarnation,message_ids_json,session_path,state,created_at_ms,completed_at_ms) SELECT ?,agent,incarnation,message_ids_json,session_path,state,created_at_ms,completed_at_ms FROM batches LIMIT 1", [generateBatchId()]);
      // Open only the Store's non-mutating existing-schema read path; never use
      // the normal seed helper to silently fix the corrupted fixture.
      const store = new Store(join(root, "runtime.sqlite"), 0, { society: "crash" });
      try { assert.throws(() => assertGlobalInvariants(store, { ...context(root, "settled"), before: healthy.ledger })); }
      finally { store.close(); }
      if (corruption !== "missing-source") assert.deepEqual(readFileSync(fixture.mail.objectPath(message.id)), bytes);
    } finally { if (open) fixture.store.close(); removeTree(root); }
  });
}

test("R33 checker negative control: immutable published ref points to another valid commit", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-ref-mutation-")); const fixture = normal(root);
  try {
    seedGit(root); const { git, paths } = gitFixture(root, fixture.store);
    await submitFixture(root, git, "valid");
    assertGlobalInvariants(fixture.store, { ...context(root, "settled"), git: paths });
    const operation = fixture.store.getOperation("a", "valid")!;
    if (operation.kind !== "git.submit") throw new Error("unexpected fixture");
    const base = gitCommand(root, ["--git-dir", paths.projectGit, "rev-parse", "refs/heads/main"]);
    gitCommand(root, ["--git-dir", paths.projectGit, "update-ref", operation.plan.publishedRef, base]);
    assert.throws(() => assertGlobalInvariants(fixture.store, { ...context(root, "settled"), git: paths }), /IMMUTABLE_PUBLISHED_REF/);
    assert.equal(gitCommand(root, ["--git-dir", paths.projectGit, "rev-parse", operation.plan.publishedRef]), base, "checker must not repair the bad ref");
  } finally { fixture.store.close(); removeTree(root); }
});
