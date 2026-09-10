import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync, readdirSync, existsSync, readFileSync, writeFileSync, statSync, symlinkSync, linkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { sha256Hex } from "../src/hash.js";
import { MailModule, publishImmutableFile } from "../src/mail.js";
import { resolvedSpec, ALL_CAPS } from "./fixtures/spec.js";
import type { AuthContext, MailInput } from "../implementation/contracts.js";
import { gitFixture, gitAuth, seedGit, gitCommand, submitFixture } from "./fixtures/git-crash.js";
import { lifecycleFixture } from "./fixtures/lifecycle-crash.js";

const auth: AuthContext = { actor: "a", incarnation: 1, role: "resident", channel: "trusted-runner", capabilities: new Set(["mail.send"]), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), cgroup: null } };
const input: MailInput = { to: ["a", "b", "c"], subject: "crash", kind: "message", body: "immutable payload" };
const files = (path: string) => existsSync(path) ? readdirSync(path) : [];

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
      store.transaction(() => {
        for (const name of ["a", "b", "c"]) store.insertAgent({ name, role: "resident", profile: "p", desired: "enabled", incarnation: 1, specHash: "fixture", specJson: resolvedSpec(ALL_CAPS, "p", name), createdBy: null });
      });
      let mail = new MailModule({ stateRoot: root, society: "crash" }, store, 64);
      const batchPoint = point === "prepared" || point === "cur";
      if (batchPoint) await mail.send(auth, "crash-send", input);
      store.close();
      open = false;
      await killAt(root, point);
      store = new Store(join(root, "runtime.sqlite"));
      open = true;
      mail = new MailModule({ stateRoot: root, society: "crash" }, store, 64);
      const accepted = store.getOperation("a", "crash-send");
      if (point === "stage" || point === "object") {
        assert.equal(accepted, null);
        assert.deepEqual(files(join(root, "mail", "archive", "cur")), []);
        assert.deepEqual(files(join(root, "mail", "inboxes", "a", "new")), []);
        assert.equal((await mail.send(auth, "crash-send", input)).state, "succeeded");
      } else {
        assert.ok(accepted);
        const message = JSON.parse(accepted.planJson).message;
        const original = readFileSync(mail.objectPath(message.id));
        if (point === "inbox-b") mail.moveToCur("b", [message.id]);
        await mail.reconcilePending();
        assert.equal(store.getOperation("a", "crash-send")!.id, accepted.id);
        assert.deepEqual(readFileSync(mail.objectPath(message.id)), original);
        if (batchPoint) {
          const prepared = store.preparedBatches("a")[0]!;
          assert.ok(prepared);
          store.transaction(() => { store.updateAgent({ name: "a", incarnation: 2 }); store.reassignPreparedBatches("a", 2); });
          const recovered = await mail.prepare({ ...auth, incarnation: 2 });
          assert.equal(recovered!.id, prepared.id);
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
    } finally { if (open) store.close(); rmSync(root, { recursive: true, force: true }); }
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
    writeFileSync(destination, "corrupt");
    assert.throws(() => publishImmutableFile(source, destination), /hash mismatch/);
    rmSync(destination);
    symlinkSync(source, destination);
    assert.throws(() => publishImmutableFile(source, destination), /hash mismatch/);
  } finally { rmSync(sourceRoot, { recursive: true, force: true }); rmSync(destinationRoot, { recursive: true, force: true }); }
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
  } finally { rmSync(sourceRoot, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

for (const point of ["submit-accepted", "submit-ref", "submit-mail", "int-before", "int-cas", "int-done", "ctx-accepted", "ctx-accepted-missing", "ctx-cas", "ctx-snapshot", "ctx-link", "ctx-mail"]) {
  const format = ["submit-ref", "int-cas", "ctx-accepted", "ctx-cas"].includes(point) ? "sha256" : "sha1";
  test(`T57/T58/T63/T66 primitive SIGKILL at ${point} (${format}): exact ref and fixed receipt recovery`, async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-git-crash-"));
    let store = new Store(join(root, "runtime.sqlite"));
    let open = true;
    try {
      store.transaction(() => {
        for (const name of ["a", "b", "c"]) store.insertAgent({ name, role: "resident", profile: "p", desired: "enabled", incarnation: 1, specHash: "fixture", specJson: resolvedSpec(ALL_CAPS, "p", name), createdBy: null });
      });
      seedGit(root, format);
      if (point === "ctx-accepted-missing") rmSync(join(root, "repos/context.git"), { recursive: true });
      const info = JSON.parse(readFileSync(join(root, "git-fixture.json"), "utf8"));
      if (point.startsWith("int-")) await submitFixture(root, gitFixture(root, store).git, "pre-published");
      store.close();
      open = false;
      await killAt(root, point);
      store = new Store(join(root, "runtime.sqlite"));
      open = true;
      const { git, mail, paths } = gitFixture(root, store);
      const accepted = store.getOperation("a", "git-crash");
      assert.ok(accepted, "durable acceptance must survive SIGKILL");
      const plan = JSON.parse(accepted.planJson);
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
        assert.notEqual(JSON.parse(other.planJson).bundle.path, plan.bundle.path);
        assert.equal(sha256Hex(readFileSync(plan.bundle.path)), plan.bundle.sha256);
      }
      if (point === "ctx-accepted") {
        const ref = join(paths.contextGit, "refs/heads/main");
        writeFileSync(ref, "corrupt-ref\n");
        await assert.rejects(git.reconcile(accepted.id), { code: "INTERNAL_ERROR" });
        assert.equal(readFileSync(ref, "utf8"), "corrupt-ref\n", "unknown is not an absent ref");
        assert.equal(store.getOperationById(accepted.id)!.state, "pending");
        rmSync(ref);
      }
      await git.reconcile(accepted.id);
      await git.reconcile(accepted.id);
      const recovered = store.getOperation("a", "git-crash")!;
      assert.equal(recovered.id, accepted.id);
      assert.equal(recovered.state, "succeeded");
      if (point.startsWith("submit-")) {
        assert.equal(gitCommand(root, ["--git-dir", paths.projectGit, "rev-parse", plan.publishedRef]), info.candidate);
        assert.equal(gitCommand(root, ["--git-dir", paths.projectGit, "rev-parse", "refs/heads/main"]), info.base);
      } else if (point.startsWith("int-")) {
        assert.equal(gitCommand(root, ["--git-dir", paths.projectGit, "rev-parse", "refs/heads/main"]), info.candidate);
      } else {
        const candidate = JSON.parse(recovered.planJson).candidate;
        if (plan.candidate) assert.equal(candidate, plan.candidate);
        assert.equal(candidate.length, format === "sha1" ? 40 : 64);
        assert.equal(gitCommand(root, ["--git-dir", paths.contextGit, "rev-parse", "refs/heads/main"]), candidate);
        assert.equal(readFileSync(join(paths.worldDir, "context/current/GOAL.md"), "utf8"), "# GOAL\nverify crash recovery\n");
      }
      if (original) assert.deepEqual(readFileSync(mail.objectPath(plan.message.id)), original);
      assert.equal(files(join(root, "mail/archive/cur")).length, 1, "recovery must not duplicate result mail");
    } finally { if (open) store.close(); rmSync(root, { recursive: true, force: true }); }
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
      store.transaction(() => {
        for (const name of ["a", "b", "c"]) store.insertAgent({ name, role: "resident", profile: "p", desired: "enabled", incarnation: 1, specHash: "fixture", specJson: resolvedSpec(ALL_CAPS, "p", name), createdBy: null });
      });
      store.close(); open = false;
      const outcome = fault(point);
      if (point.startsWith("error-stage-")) {
        assert.equal(outcome.code, point.endsWith("before") ? "ENOSPC" : "EIO");
        store = new Store(join(root, "runtime.sqlite")); open = true;
        assert.equal(store.getOperation("a", "crash-send"), null);
        assert.deepEqual(files(join(root, "mail/archive/cur")), []);
        const mail = new MailModule({ stateRoot: root, society: "crash" }, store, 64);
        assert.equal((await mail.send(auth, "crash-send", input)).state, "succeeded");
      } else {
        assert.equal(outcome.state, "pending");
        for (const retry of ["error-recovery-before", "error-recovery-after"]) assert.equal(fault(retry).remaining, 1);
        store = new Store(join(root, "runtime.sqlite")); open = true;
        assert.equal(store.getOperation("a", "crash-send")!.id, outcome.operation);
        assert.equal(store.getOperation("a", "crash-send")!.state, "pending");
        const mail = new MailModule({ stateRoot: root, society: "crash" }, store, 64);
        await mail.reconcilePending();
        assert.equal(store.getOperation("a", "crash-send")!.state, "succeeded");
        assert.equal(store.getOperation("a", "crash-send")!.id, outcome.operation);
      }
      assert.equal(files(join(root, "mail/archive/cur")).length, 1);
      for (const actor of ["a", "b", "c"]) assert.equal(files(join(root, "mail/inboxes", actor, "new")).length, 1);
    } finally { if (open) store.close(); rmSync(root, { recursive: true, force: true }); }
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
      if (point === "boot-stage") assert.equal(store.listAgents().length, 0);
      else {
        assert.equal(store.listAgents().length, 3, "all bootstrap identities commit together");
        assert.ok(before.every(Boolean));
        for (const op of before) {
          const message = JSON.parse(op!.planJson).initialMessage;
          if (existsSync(fixture.mail.objectPath(message.id))) rmSync(join(root, "staging", `${message.id}.eml`), { force: true });
        }
      }
      await fixture.lifecycle.bootstrap(fixture.config);
      for (const id of store.recoverableOperations()) await fixture.lifecycle.reconcileCreate(id, false);
      for (const [index, name] of ["child", "peer"].entries()) {
        const op = store.getOperation("principal", `bootstrap-${name}`)!;
        if (before[index]) assert.equal(op.id, before[index]!.id);
        assert.equal(op.state, "succeeded");
        const plan = JSON.parse(op.planJson);
        assert.equal(gitCommand(root, ["-C", plan.workspacePath, "rev-parse", "HEAD"]), plan.spec.from);
        assert.equal(store.getAgent(name)!.incarnation, 0, "pre-GOAL must not execute a runner");
        assert.equal(fixture.units.observe(name).activeState, "inactive");
        assert.equal(files(join(root, "mail/inboxes", name, "new")).length, 1);
      }
      assert.equal(files(join(root, "mail/objects")).length, 2);
      assert.equal(files(join(root, "mail/archive/cur")).length, 2);
      await fixture.lifecycle.bootstrap({ ...fixture.config, initialResidents: [] });
      assert.equal(store.listAgents().length, 3);
    } finally { cleanup(); if (open) store.close(); rmSync(root, { recursive: true, force: true }); }
  });
}

for (const point of ["create-stage", "create-intent", "create-object", "create-workspace", "create-unit", "create-ready", "create-mail"]) {
  test(`T39/M-004 primitive SIGKILL at ${point}: one child and one initial mail`, async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-create-crash-"));
    let store = new Store(join(root, "runtime.sqlite"));
    let open = true;
    const cleanup = lifecycleFixture(root, store).cleanup;
    try {
      store.transaction(() => store.insertAgent({ name: "a", role: "resident", profile: "p", desired: "enabled", incarnation: 1, specHash: "fixture", specJson: resolvedSpec(ALL_CAPS, "p", "a"), createdBy: null }));
      seedGit(root);
      const info = JSON.parse(readFileSync(join(root, "git-fixture.json"), "utf8"));
      const input = { name: "child", from: info.base, brief: "new child" };
      store.close(); open = false;
      await killAt(root, point);
      store = new Store(join(root, "runtime.sqlite")); open = true;
      const fixture = lifecycleFixture(root, store);
      const before = store.getOperation("a", "create-child");
      if (point === "create-stage") {
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
      assert.equal(files(join(root, "mail/objects")).length, 1);
      assert.equal(files(join(root, "mail/archive/cur")).length, 1);
      assert.equal(files(join(root, "mail/inboxes/child/new")).length, 1);
    } finally { cleanup(); if (open) store.close(); rmSync(root, { recursive: true, force: true }); }
  });
}

for (const kind of ["symlink", "hardlink"]) {
  test(`S-05 recovery rejects ${kind} staging even when bytes match the accepted bundle`, async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-bundle-link-"));
    let store = new Store(join(root, "runtime.sqlite"));
    let open = true;
    try {
      seedGit(root);
      store.transaction(() => {
        for (const name of ["a", "b"]) store.insertAgent({ name, role: "resident", profile: "p", desired: "enabled", incarnation: 1, specHash: "fixture", specJson: resolvedSpec(ALL_CAPS, "p", name), createdBy: null });
      });
      store.close(); open = false;
      await killAt(root, "submit-accepted");
      store = new Store(join(root, "runtime.sqlite")); open = true;
      const op = store.getOperation("a", "git-crash")!;
      const plan = JSON.parse(op.planJson);
      const external = join(root, "replacement.bundle");
      writeFileSync(external, readFileSync(plan.bundle.path));
      rmSync(plan.bundle.path);
      (kind === "symlink" ? symlinkSync : linkSync)(external, plan.bundle.path);
      assert.equal(sha256Hex(readFileSync(plan.bundle.path)), plan.bundle.sha256);
      const { git, paths } = gitFixture(root, store);
      await assert.rejects(git.reconcile(op.id), { code: "STREAM_INVALID" });
      assert.equal(store.getOperationById(op.id)!.state, "failed");
      assert.equal(gitCommand(root, ["--git-dir", paths.projectGit, "for-each-ref", "--format=%(refname)", "refs/oma/published"]), "");
      assert.equal(files(join(root, "mail/archive/cur")).length, 0);
    } finally { if (open) store.close(); rmSync(root, { recursive: true, force: true }); }
  });
}
