import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, readdirSync, existsSync, readFileSync, writeFileSync, statSync, symlinkSync, linkSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@oma/storage";
import { sha256Hex } from "@oma/domain/canonical-json";
import { MailModule } from "@oma/mail";
import { publishImmutableFile } from "@oma/storage/immutable-file";
import { makeValidAgent } from "./fixtures/spec.js";
import { TEST_VIEW_LIMITS } from "./fixtures/limits.js";
import type { AuthContext, MailInput } from "@oma/contracts";
import { gitFixture, gitAuth, seedGit, gitCommand, submitFixture } from "./fixtures/git-crash.js";
import { lifecycleFixture } from "./fixtures/lifecycle-crash.js";
import { removeTree } from "./fixtures/cleanup.js";

import { requireSystemdTestManager } from "./fixtures/systemd.js";
requireSystemdTestManager();
const auth: AuthContext = { actor: "a", incarnation: 1, role: "resident", channel: "trusted-runner", capabilities: new Set(["mail.send"]), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), cgroup: null } };
const input: MailInput = { to: ["a", "b", "c"], subject: "crash", kind: "message", body: "immutable payload" };
const files = (path: string) => existsSync(path) ? readdirSync(path) : [];
function seedAgents(store: Store, names: readonly string[] = ["a", "b", "c"]): void {
  store.transaction(tx => { for (const name of names) tx.insertAgent(makeValidAgent(name)); });
  for (const name of names) assert.equal(store.getAgent(name)?.name, name, "normal setup must decode before fault injection");
}

async function killAt(root: string, point: string): Promise<void> {
  const child = fork(new URL("./fixtures/crash-worker.js", import.meta.url), [root, point], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let stderr = "";
  child.stderr!.on("data", bytes => { stderr += String(bytes); });
  try {
    await new Promise<void>((resolve, reject) => {
      let reached = false;
      const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`checkpoint timeout: ${point}: ${stderr}`)); }, 10000);
      child.once("error", error => { clearTimeout(timeout); reject(error); });
      child.once("message", message => {
        if ((message as { point: string }).point !== point) return;
        reached = true;
        child.kill("SIGKILL");
      });
      child.once("close", (code, signal) => {
        clearTimeout(timeout);
        if (signal === "SIGKILL" && reached) resolve();
        else reject(new Error(`worker did not die at ${point}: ${code}/${signal}: ${stderr}`));
      });
    });
  } finally { child.kill("SIGKILL"); }
}

// Real SIGKILL + SQLite/filesystem recovery, not a claim of broker IPC or VM power-cut coverage.
for (const point of ["stage", "object", "accepted", "archive", "inbox-a", "inbox-b", "prepared", "cur"]) {
  test(`T18–T22/T27 primitive SIGKILL at ${point}: stable recovery and immutable bytes`, async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-crash-"));
    let store = new Store(join(root, "runtime.sqlite"));
    let open = true;
    try {
      seedAgents(store);
      let mail = createMailModule({ stateRoot: root, society: "crash" }, store, 64, TEST_VIEW_LIMITS.batchMaxMessages, TEST_VIEW_LIMITS);
      const batchPoint = point === "prepared" || point === "cur";
      if (batchPoint) await mail.send(auth, "crash-send", input);
      store.close();
      open = false;
      await killAt(root, point);
      store = new Store(join(root, "runtime.sqlite"));
      open = true;
      mail = createMailModule({ stateRoot: root, society: "crash" }, store, 64, TEST_VIEW_LIMITS.batchMaxMessages, TEST_VIEW_LIMITS);
      const accepted = store.getOperation("a", "crash-send");
      if (point === "stage" || point === "object") {
        assert.equal(accepted, null);
        assert.deepEqual(files(join(root, "mail", "archive", "cur")), []);
        assert.deepEqual(files(join(root, "mail", "inboxes", "a", "new")), []);
        assert.equal((await mail.send(auth, "crash-send", input)).state, "succeeded");
      } else {
        assert.ok(accepted);
        const message = JSON.parse(accepted.planJson).intent.message;
        const original = readFileSync(mail.objectPath(message.id));
        if (point === "inbox-b") mail.moveToCur("b", [message.id]);
        await mail.reconcilePending();
        assert.equal(store.getOperation("a", "crash-send")!.id, accepted.id);
        assert.deepEqual(readFileSync(mail.objectPath(message.id)), original);
        if (batchPoint) {
          const prepared = store.preparedBatches("a")[0]!;
          assert.ok(prepared);
          store.transaction(() => { store.updateAgent({ name: "a", incarnation: 2 }); });
          const recovered = await mail.prepare({ ...auth, incarnation: 2 });
          assert.equal(recovered!.id, prepared.id);
          assert.equal(recovered!.incarnation, 2, "DR9: presented in the new lease's attempt");
          assert.equal(store.getBatch(prepared.id)!.incarnation, prepared.incarnation, "DR9: the batch row is not rewritten");
          assert.deepEqual(recovered!.messageIds, JSON.parse(prepared.messageIdsJson));
          assert.deepEqual(files(join(root, "mail", "inboxes", "a", "new")), []);
        }
        if (point === "inbox-b") assert.deepEqual(files(join(root, "mail", "inboxes", "b", "new")), []);
        for (const actor of ["a", "b", "c"]) {
          const inbox = join(root, "mail", "inboxes", actor);
          const names = [...files(join(inbox, "new")), ...files(join(inbox, "cur"))];
          assert.equal(names.length, 1, `${point}: one delivery to ${actor}`);
          const path = existsSync(join(inbox, "new", names[0]!)) ? join(inbox, "new", names[0]!) : join(inbox, "cur", names[0]!);
          assert.deepEqual(readFileSync(path), original);
        }
      }
    } finally { if (open) store.close(); removeTree(root); }
  });
}

test("T23 real cross-filesystem immutable copy rejects corrupt and symlink destinations", () => {
  const sourceRoot = mkdtempSync(join(tmpdir(), "oma-copy-source-"));
  const destinationRoot = mkdtempSync("/dev/shm/oma-copy-destination-");
  try {
    assert.notEqual(statSync(sourceRoot).dev, statSync(destinationRoot).dev, "this test requires distinct real filesystems");
    const source = join(sourceRoot, "source");
    const destination = join(destinationRoot, "destination");
    const bytes = Buffer.from([0, 255, 192, 128, 10]);
    writeFileSync(source, bytes);
    publishImmutableFile(source, destination);
    publishImmutableFile(source, destination);
    assert.deepEqual(readFileSync(destination), bytes);
    assert.deepEqual(readdirSync(destinationRoot), ["destination"]);
    chmodSync(destination, 0o600); // explicit corruption of an otherwise immutable artifact
    writeFileSync(destination, "corrupt");
    assert.throws(() => publishImmutableFile(source, destination), { code: "STORE_CORRUPT" });
    rmSync(destination);
    symlinkSync(source, destination);
    assert.throws(() => publishImmutableFile(source, destination), { code: "STORE_CORRUPT" });
  } finally { removeTree(sourceRoot); removeTree(destinationRoot); }
});

test("T23 real SIGKILL during cross-filesystem copy never publishes a partial destination", async () => {
  const sourceRoot = mkdtempSync(join(tmpdir(), "oma-copy-kill-source-"));
  const root = mkdtempSync("/dev/shm/oma-copy-kill-");
  try {
    assert.notEqual(statSync(sourceRoot).dev, statSync(root).dev);
    const source = join(sourceRoot, "source");
    const destination = join(root, "destination");
    writeFileSync(source, "complete immutable bytes");
    writeFileSync(join(root, "source-path"), source);
    await killAt(root, "copy");
    assert.equal(existsSync(destination), false, "partial copy must remain unpublished");
    publishImmutableFile(source, destination);
    assert.deepEqual(readFileSync(destination), readFileSync(source));
  } finally { removeTree(sourceRoot); removeTree(root); }
});

for (const format of ["sha1", "sha256"] as const) {
  test(`R20 primitive SIGKILL at submit-stage (${format}): no accepted intent or published result`, async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-submit-stage-"));
    let store = new Store(join(root, "runtime.sqlite"));
    let open = true;
    try {
      seedAgents(store); seedGit(root, format);
      store.close(); open = false;
      await killAt(root, "submit-stage");
      store = new Store(join(root, "runtime.sqlite")); open = true;
      const { git, paths } = gitFixture(root, store);
      assert.equal(store.getOperation("a", "git-crash"), null);
      assert.equal(gitCommand(root, ["--git-dir", paths.projectGit, "for-each-ref", "--format=%(refname)", "refs/oma/published/"]), "");
      assert.deepEqual(files(join(root, "mail/archive/cur")), []);
      const oldNames = files(join(root, "staging")).filter(name => name.startsWith("submit-"));
      assert.equal(oldNames.length, 1);
      const orphan = join(root, "staging", oldNames[0]!, "upload.bundle");
      const original = readFileSync(orphan);
      assert.equal((await submitFixture(root, git)).state, "succeeded");
      assert.deepEqual(readFileSync(orphan), original, "a new preparation must not delete an unclaimed earlier operation artifact");
      assert.equal(files(join(root, "mail/archive/cur")).length, 1);
    } finally { if (open) store.close(); removeTree(root); }
  });
}

for (const point of ["submit-accepted", "submit-import", "submit-ref", "submit-mail", "submit-done", "int-before", "int-cas", "int-done", "ctx-accepted", "ctx-accepted-missing", "ctx-cas", "ctx-snapshot", "ctx-link", "ctx-mail"]) {
  const format = ["submit-ref", "submit-done", "int-cas", "ctx-accepted", "ctx-cas"].includes(point) ? "sha256" : "sha1";
  test(`T57/T58/T63/T66 primitive SIGKILL at ${point} (${format}): exact ref and fixed receipt recovery`, async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-git-crash-"));
    let store = new Store(join(root, "runtime.sqlite"));
    let open = true;
    try {
      seedAgents(store);
      seedGit(root, format);
      if (point === "ctx-accepted-missing") rmSync(join(root, "repos/context.git"), { recursive: true });
      const info = JSON.parse(readFileSync(join(root, "git-fixture.json"), "utf8"));
      if (point.startsWith("int-")) await submitFixture(root, gitFixture(root, store).git, "pre-published");
      store.close(); open = false;
      await killAt(root, point);
      store = new Store(join(root, "runtime.sqlite")); open = true;
      const { git, mail, paths } = gitFixture(root, store);
      const accepted = store.getOperation("a", "git-crash");
      assert.ok(accepted, "durable acceptance must survive SIGKILL");
      const plan = JSON.parse(accepted.planJson).intent;
      const original = plan.message ? readFileSync(mail.objectPath(plan.message.id)) : null;
      if (point === "submit-accepted") {
        const bad = Buffer.from("not a Git bundle\n");
        await assert.rejects(git.submit({ ...gitAuth, actor: "b" }, "git-crash", {
          candidate: info.candidate, exportRef: info.exportRef, prerequisites: [info.base], to: ["a"],
          subject: "malformed", body: "other actor", paths: [],
          bundle: { bytes: bad.length, sha256: sha256Hex(bad), mediaType: "application/x-git-bundle" },
        }, (async function* () { yield bad; })()), { code: "BUNDLE_INVALID" });
        const other = store.getOperation("b", "git-crash")!;
        assert.equal(other.state, "failed");
        assert.notEqual(JSON.parse(other.planJson).intent.bundle.path, plan.bundle.path);
        assert.equal(sha256Hex(readFileSync(plan.bundle.path)), plan.bundle.sha256);
      }
      if (point === "ctx-accepted") {
        const ref = join(paths.contextGit, "refs/heads/main");
        writeFileSync(ref, "corrupt-ref\n");
        await assert.rejects(git.reconcile(accepted.id), { code: "REF_STATE_UNKNOWN" });
        assert.equal(readFileSync(ref, "utf8"), "corrupt-ref\n", "unknown is not an absent ref");
        // A corrupt ref file cannot prove the effect did or did not happen, so
        // the operation stays explicitly unknown rather than retryable-pending.
        assert.equal(store.getOperationById(accepted.id)!.state, "unknown");
        rmSync(ref);
      }
      await git.reconcile(accepted.id);
      const firstResult = store.getOperationById(accepted.id)!.resultJson;
      await git.reconcile(accepted.id);
      const recovered = store.getOperation("a", "git-crash")!;
      assert.equal(recovered.id, accepted.id);
      assert.equal(recovered.state, "succeeded");
      assert.equal(recovered.resultJson, firstResult, "terminal result bytes are never rewritten on repeated recovery");
      assert.equal(recovered.planJson, accepted.planJson, "recovery must consume the original immutable plan");
      if (point.startsWith("submit-")) {
        assert.equal(gitCommand(root, ["--git-dir", paths.projectGit, "rev-parse", plan.publishedRef]), info.candidate);
        assert.equal(gitCommand(root, ["--git-dir", paths.projectGit, "rev-parse", "refs/heads/main"]), info.base);
        assert.equal(sha256Hex(readFileSync(plan.bundle.path)), plan.bundle.sha256, "accepted bundle is retained after settlement");
      } else if (point.startsWith("int-")) {
        assert.equal(gitCommand(root, ["--git-dir", paths.projectGit, "rev-parse", "refs/heads/main"]), info.candidate);
      } else {
        const candidate = JSON.parse(recovered.planJson).intent.candidate;
        if (plan.candidate) assert.equal(candidate, plan.candidate);
        assert.equal(candidate.length, format === "sha1" ? 40 : 64);
        assert.equal(gitCommand(root, ["--git-dir", paths.contextGit, "rev-parse", "refs/heads/main"]), candidate);
        assert.equal(readFileSync(join(paths.worldDir, "context/current/GOAL.md"), "utf8"), "# GOAL\nverify crash recovery\n");
      }
      if (original) assert.deepEqual(readFileSync(mail.objectPath(plan.message.id)), original);
      assert.equal(files(join(root, "mail/archive/cur")).length, 1, "recovery must not duplicate result mail");
    } finally { if (open) store.close(); removeTree(root); }
  });
}

for (const point of ["error-stage-before", "error-stage-after", "error-archive-before", "error-archive-after"]) {
  test(`T70 injected ENOSPC/EIO at ${point}: no false receipt, repeated recovery remains retryable`, async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-io-fault-"));
    let store = new Store(join(root, "runtime.sqlite"));
    let open = true;
    const fault = (name: string) => {
      const child = spawnSync(process.execPath, [fileURLToPath(new URL("./fixtures/crash-worker.js", import.meta.url)), root, name], { encoding: "utf8", timeout: 10000 });
      assert.equal(child.status, 0, child.stderr);
      return JSON.parse(readFileSync(join(root, "failure.json"), "utf8"));
    };
    try {
      seedAgents(store);
      store.close(); open = false;
      const outcome = fault(point);
      if (point.startsWith("error-stage-")) {
        assert.equal(outcome.code, point.endsWith("before") ? "ENOSPC" : "EIO");
        store = new Store(join(root, "runtime.sqlite")); open = true;
        assert.equal(store.getOperation("a", "crash-send"), null);
        assert.deepEqual(files(join(root, "mail/archive/cur")), []);
        const mail = createMailModule({ stateRoot: root, society: "crash" }, store, 64, TEST_VIEW_LIMITS.batchMaxMessages, TEST_VIEW_LIMITS);
        assert.equal((await mail.send(auth, "crash-send", input)).state, "succeeded");
      } else {
        assert.equal(outcome.state, "pending");
        for (const retry of ["error-recovery-before", "error-recovery-after"]) assert.equal(fault(retry).remaining, 1);
        store = new Store(join(root, "runtime.sqlite")); open = true;
        assert.equal(store.getOperation("a", "crash-send")!.id, outcome.operation);
        assert.equal(store.getOperation("a", "crash-send")!.state, "pending");
        const mail = createMailModule({ stateRoot: root, society: "crash" }, store, 64, TEST_VIEW_LIMITS.batchMaxMessages, TEST_VIEW_LIMITS);
        await mail.reconcilePending();
        assert.equal(store.getOperation("a", "crash-send")!.state, "succeeded");
        assert.equal(store.getOperation("a", "crash-send")!.id, outcome.operation);
      }
      assert.equal(files(join(root, "mail/archive/cur")).length, 1);
      for (const actor of ["a", "b", "c"]) assert.equal(files(join(root, "mail/inboxes", actor, "new")).length, 1);
    } finally { if (open) store.close(); removeTree(root); }
  });
}

for (const point of ["boot-stage", "boot-intent", "boot-object", "boot-workspace", "boot-unit", "boot-ready", "boot-mail"]) {
  const format = point === "boot-intent" ? "sha256" : "sha1";
  test(`T39/LIFE-009/M-004 primitive SIGKILL at ${point} (${format}): frozen bootstrap converges without transaction I/O`, async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-boot-crash-"));
    let store = new Store(join(root, "runtime.sqlite"));
    let open = true;
    const cleanup = lifecycleFixture(root, store).cleanup;
    try {
      seedGit(root, format);
      store.close(); open = false;
      await killAt(root, point);
      store = new Store(join(root, "runtime.sqlite")); open = true;
      const fixture = lifecycleFixture(root, store);
      const before = ["child", "peer"].map(name => store.getOperation("principal", `bootstrap-${name}`));
      if (point === "boot-stage" || point === "boot-object") assert.equal(store.listAgents().length, 0);
      else {
        assert.equal(store.listAgents().length, 3, "all bootstrap identities commit together");
        assert.ok(before.every(Boolean));
        for (const op of before) {
          const message = JSON.parse(op!.planJson).intent.initialMessage;
          if (existsSync(fixture.mail.objectPath(message.id))) rmSync(join(root, "staging", `${message.id}.eml`), { force: true });
        }
      }
      await fixture.lifecycle.bootstrap(fixture.config);
      for (const id of store.recoverableOperations()) await fixture.lifecycle.reconcileCreate(id, false);
      for (const [index, name] of ["child", "peer"].entries()) {
        const op = store.getOperation("principal", `bootstrap-${name}`)!;
        if (before[index]) assert.equal(op.id, before[index]!.id);
        assert.equal(op.state, "succeeded");
        const plan = JSON.parse(op.planJson).intent;
        assert.equal(gitCommand(root, ["-C", plan.workspacePath, "rev-parse", "HEAD"]), plan.spec.from);
        assert.equal(store.getAgent(name)!.incarnation, 0, "pre-GOAL must not execute a runner");
        assert.equal(fixture.units.observe(name).activeState, "inactive");
        assert.equal(files(join(root, "mail/inboxes", name, "new")).length, 1);
      }
      // A kill before the bootstrap intent leaves an unreferenced object; FS-007
      // forbids automatic removal, so it survives as an orphan next to the two
      // accepted initial messages.
      const bootObjects = files(join(root, "mail/objects"));
      assert.equal(bootObjects.length, point === "boot-object" ? 3 : 2, JSON.stringify(bootObjects));
      for (const name of ["child", "peer"]) {
        const initial = JSON.parse(store.getOperation("principal", `bootstrap-${name}`)!.planJson).intent.initialMessage.id;
        assert.ok(bootObjects.includes(`${initial}.eml`), JSON.stringify(bootObjects));
      }
      assert.equal(files(join(root, "mail/archive/cur")).length, 2);
      await fixture.lifecycle.bootstrap({ ...fixture.config, initialResidents: [] });
      assert.equal(store.listAgents().length, 3);
    } finally { cleanup(); if (open) store.close(); removeTree(root); }
  });
}

for (const point of ["create-stage", "create-intent", "create-object", "create-workspace", "create-unit", "create-ready", "create-mail"]) {
  test(`T39/M-004 primitive SIGKILL at ${point}: one child and one initial mail`, async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-create-crash-"));
    let store = new Store(join(root, "runtime.sqlite"));
    let open = true;
    const cleanup = lifecycleFixture(root, store).cleanup;
    try {
      seedAgents(store, ["a"]);
      seedGit(root);
      const info = JSON.parse(readFileSync(join(root, "git-fixture.json"), "utf8"));
      const input = { name: "child", from: info.base, brief: "new child" };
      store.close(); open = false;
      await killAt(root, point);
      store = new Store(join(root, "runtime.sqlite")); open = true;
      const fixture = lifecycleFixture(root, store);
      const before = store.getOperation("a", "create-child");
      // The initial EML is frozen before the create intent is durable, so both
      // boundaries leave no accepted operation behind.
      if (point === "create-stage" || point === "create-object") {
        assert.equal(before, null);
        assert.equal(store.getAgent("child"), null);
        await fixture.lifecycle.create(gitAuth, input, "create-child");
      } else {
        assert.ok(before);
        await fixture.lifecycle.reconcileCreate(before.id, false);
      }
      const op = store.getOperation("a", "create-child")!;
      assert.equal(op.state, "succeeded");
      if (before) assert.equal(op.id, before.id);
      const retry = await fixture.lifecycle.create(gitAuth, input, "create-child");
      assert.equal(retry.operation, op.id);
      assert.equal(store.listAgents().length, 2);
      assert.equal(gitCommand(root, ["-C", join(root, "agents/child/workspace"), "rev-parse", "HEAD"]), info.base);
      assert.equal(store.getAgent("child")!.incarnation, 0);
      assert.equal(fixture.units.observe("child").activeState, "inactive");
      // A kill after the object freeze but before the intent leaves an
      // unreferenced object; FS-007 forbids automatic removal, so it survives
      // next to the accepted initial message.
      const createObjects = files(join(root, "mail/objects"));
      const acceptedInitial = JSON.parse(op.planJson).intent.initialMessage.id;
      assert.ok(createObjects.includes(`${acceptedInitial}.eml`), JSON.stringify(createObjects));
      assert.equal(createObjects.length, point === "create-object" ? 2 : 1, JSON.stringify(createObjects));
      assert.equal(files(join(root, "mail/archive/cur")).length, 1);
      assert.equal(files(join(root, "mail/inboxes/child/new")).length, 1);
    } finally { cleanup(); if (open) store.close(); removeTree(root); }
  });
}

for (const kind of ["symlink", "hardlink"]) {
  test(`S-05 recovery rejects ${kind} staging even when bytes match the accepted bundle`, async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-bundle-link-"));
    let store = new Store(join(root, "runtime.sqlite"));
    let open = true;
    try {
      seedGit(root); seedAgents(store, ["a", "b"]);
      store.close(); open = false;
      await killAt(root, "submit-accepted");
      store = new Store(join(root, "runtime.sqlite")); open = true;
      const op = store.getOperation("a", "git-crash")!;
      const plan = JSON.parse(op.planJson).intent;
      const external = join(root, "replacement.bundle");
      writeFileSync(external, readFileSync(plan.bundle.path));
      rmSync(plan.bundle.path);
      (kind === "symlink" ? symlinkSync : linkSync)(external, plan.bundle.path);
      assert.equal(sha256Hex(readFileSync(plan.bundle.path)), plan.bundle.sha256);
      const { git, paths } = gitFixture(root, store);
      await assert.rejects(git.reconcile(op.id), { code: "STORE_CORRUPT" });
      assert.equal(store.getOperationById(op.id)!.state, "pending", "corrupt accepted evidence must not be rewritten as a terminal input failure");
      assert.equal(store.getOperationById(op.id)!.planJson, op.planJson);
      assert.equal(gitCommand(root, ["--git-dir", paths.projectGit, "for-each-ref", "--format=%(refname)", "refs/oma/published"]), "");
      assert.equal(files(join(root, "mail/archive/cur")).length, 0);
      assert.equal(sha256Hex(readFileSync(external)), plan.bundle.sha256);
    } finally { if (open) store.close(); removeTree(root); }
  });
}
