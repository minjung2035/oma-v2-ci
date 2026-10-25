import { createReconcileModule } from "#oma-test/app/broker/reconcile-composition";
/** Second-pass contract oracles. Run after build with the local-test guard.
 * REQUIRED behavior is asserted; failures document unfixed defects.
 * Only disposable Git/SQLite/files and a fixture Unix socket are used.
 * No manager, VM, real engine, credential or provider is invoked.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { fixture, messages, workerFile } from "../../dist/test/fixtures/review-fixture.js";
import { AdmissionGate, bindAdmissionGate } from "../../dist/src/domain/admission.js";
import { publishedRefFor } from "../../dist/src/domain/derived.js";
import { StoreError } from "../../dist/src/domain/errors.js";
import { ReconcileModule } from "@oma/reconcile";
import { registerOmaTools } from "../../dist/src/extension/mail-tools.js";
import { prepareReplyEffects } from "#oma-test/app/cli/effects/mail";
import { FrameParser, encodeFrame } from "../../dist/src/frame.js";
import { principalMailbox, readMailbox } from "../../dist/src/tui/sources/mail.js";
import { defaultHostConfig } from "../../dist/src/config/defaults.js";
import { validateConfig } from "../../dist/src/config.js";

test("AV-20261003-09: observed challenge-ref corruption must immediately fence fresh acceptance", async t => {
  const f = fixture();
  try {
    const candidate = f.candidateWith({ "a.txt": "a" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "LOW", candidate }, "open");
    assert.equal(f.applyOp("alice", "open").state, "succeeded");
    const gate = new AdmissionGate();
    bindAdmissionGate(f.store, gate);
    const real = f.mail.freezeReviewMessage.bind(f.mail);
    let conflictedRef = null;
    f.mail.freezeReviewMessage = async (...args) => {
      const frozen = await real(...args);
      if (args[2] === "bob" && conflictedRef === null) {
        // Physical corruption fault: this operation's intended published
        // ref holds a valid but DIFFERENT commit. Store rows stay untouched.
        conflictedRef = publishedRefFor("bob", args[0]);
        f.git(["update-ref", conflictedRef, f.base]);
      }
      return frozen;
    };
    const challenge = await f.challenge("bob", { merge: f.requestName("open"), tier: "HIGH" }, "challenge");
    const gateAtAnswer = gate.state;
    let fresh = null;
    let freshError = null;
    try { fresh = await f.mail.send(f.auth("carol"), "fresh-after-corruption",
      { to: ["bob"], subject: "another intent", kind: "message", body: "hello" }); }
    catch (error) { freshError = error.code; }
    // Control: the actual sweep DOES recognize exactly the same ref conflict
    // and closes the same gate. This is a foreground/background divergence.
    const reconcile = createReconcileModule(f.store, f.mail, f.module, null,
      { observeAsync: async () => ({ activeState: "inactive" }), confirmDead: () => true }, {},
      { projectGit: f.projectGit, hasGoal: () => false, activationAllowed: () => false });
    await assert.rejects(reconcile.sweep(), { code: "STORE_CORRUPT" });
    assert.equal(gate.state, "corrupt");
    t.diagnostic(JSON.stringify({ challenge: challenge.state, conflictedRef,
      gateAtAnswer, fresh: fresh?.state ?? null, freshError, gateAfterSweep: gate.state }));
    assert.equal(gateAtAnswer, "corrupt", "logging known corruption must not leave new acceptance healthy");
  } finally { f.close(); }
});

test("AV-20261003-10: a Worker can reply with oma_mail_send to the worker-only mail it can read", async t => {
  const f = fixture();
  const changed = ["OMA_CLI_PATH", "OMA_AGENT_HOME", "OMA_MAIL_ARCHIVE", "OMA_WORKER_ARCHIVE", "OMA_SOCKET", "OMA_SOCIETY"];
  const previous = new Map(changed.map(key => [key, process.env[key]]));
  const sockets = new Set();
  let server;
  try {
    const candidate = f.candidateWith({ "a.txt": "a" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "MEDIUM", candidate }, "open");
    const thread = messages(f, "alice", "open")[0];
    const archive = join(f.root, "mail", "archive", "cur");
    const home = join(f.root, "tool-home");
    mkdirSync(archive, { recursive: true });
    mkdirSync(home);
    assert.equal(existsSync(join(archive, `${thread.id}:2,`)), false);
    assert.equal(prepareReplyEffects(workerFile(f.root, thread.id), false).replyToMessage, thread.id);
    // An in-process fixture endpoint supplies real frames and real mail
    // acceptance if the CLI gets as far as transport. It authenticates as bob
    // by construction; this does not exercise native pidfd/cgroup auth.
    const path = join(f.root, "tools.sock");
    let frames = 0;
    server = createServer(socket => {
      sockets.add(socket); socket.on("close", () => sockets.delete(socket)); socket.on("error", () => {});
      const parser = new FrameParser(262144);
      socket.on("data", bytes => {
        for (const { raw } of parser.feed(bytes)) {
          frames++;
          void (async () => {
            assert.equal(raw.method, "mail.send");
            const result = await f.mail.send(f.auth("bob"), raw.request, raw.params);
            socket.write(encodeFrame({ v: 1, id: raw.id, ok: true, result }));
          })().catch(error => socket.end(encodeFrame({ v: 1, id: raw.id, ok: false,
            error: { code: error.code ?? "INTERNAL_ERROR", message: error.message, retry: "never" } })));
        }
      });
    });
    await new Promise((done, fail) => { server.once("error", fail); server.listen(path, done); });
    Object.assign(process.env, { OMA_CLI_PATH: resolve("dist/src/cli.js"), OMA_AGENT_HOME: home,
      OMA_MAIL_ARCHIVE: archive, OMA_WORKER_ARCHIVE: join(f.root, "mail", "workers", "cur"),
      OMA_SOCKET: path, OMA_SOCIETY: "demo" });
    const tools = new Map();
    registerOmaTools({ registerTool: tool => tools.set(tool.name, tool) }, f.root);
    const read = await tools.get("oma_mail_read").execute("read", { messageId: thread.id });
    assert.ok(read.content[0].text.includes(f.requestName("open")));
    let error = null;
    try { await tools.get("oma_mail_send").execute("reply", { to: ["residents"], subject: "reply",
      body: "I read this request", replyTo: workerFile(f.root, thread.id), request: "reply-to-thread" }); }
    catch (caught) { error = caught.message; }
    t.diagnostic(JSON.stringify({ workerRead: "succeeded", replyError: error, frames,
      acceptedReply: f.store.getOperation("bob", "reply-to-thread")?.state ?? null }));
    assert.equal(error, null, "reply resolution must use the same permitted archives as reading");
    assert.equal(f.store.getOperation("bob", "reply-to-thread")?.state, "succeeded");
  } finally {
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    for (const socket of sockets) socket.destroy();
    if (server?.listening) await new Promise(done => server.close(done));
    f.close();
  }
});

test("AV-20261003-11: Mail lists a recovered new arrival by its delivery time", async t => {
  const f = fixture();
  try {
    const real = f.mail.materialize.bind(f.mail);
    let once = true;
    f.mail.materialize = async id => {
      if (once) { once = false; throw new StoreError("BROKER_UNAVAILABLE", "injected post-accept publication outage"); }
      return real(id);
    };
    const first = await f.mail.send(f.auth("alice"), "delayed", {
      to: ["principal"], subject: "arrives later through recovery", kind: "message", body: "first accepted" });
    assert.equal(first.state, "pending");
    // Separate the actual inode freeze timestamps; no metadata is rewritten.
    await new Promise(done => setTimeout(done, 15));
    const second = await f.mail.send(f.auth("alice"), "immediate", {
      to: ["principal"], subject: "arrives first", kind: "message", body: "second accepted" });
    assert.equal(second.state, "succeeded");
    const id1 = f.store.getOperation("alice", "delayed").plan.message.id;
    const id2 = f.store.getOperation("alice", "immediate").plan.message.id;
    const box = principalMailbox(f.root);
    assert.deepEqual(readMailbox(box).rows.map(row => row.id), [id2]);
    const frozen = statSync(join(f.root, "mail", "objects", `${id1}.eml`));
    assert.deepEqual(await f.mail.reconcilePending(), { examined: 1, repaired: 1, remaining: 0 });
    const delivered = statSync(join(box.newDir, id1));
    assert.equal(delivered.ino, frozen.ino);
    assert.equal(delivered.mtimeMs, frozen.mtimeMs);
    const order = readMailbox(box).rows.map(row => row.id);
    t.diagnostic(JSON.stringify({ realArrivalOrder: [id2, id1], shownNewestFirst: order,
      usesFreezeTime: delivered.mtimeMs === frozen.mtimeMs }));
    assert.deepEqual(order, [id1, id2], "immutable inode mtime predates deferred delivery and is not arrival evidence");
  } finally { f.close(); }
});

test("AV-20261003-12: a long bounded thread retains a way to vote or cancel", { timeout: 60000 }, async t => {
  const config = defaultHostConfig({ society: "demo", node: process.execPath, libdir: "/opt/oma",
    rootfs: "/tmp/oma-audit-rootfs", deploymentDigest: "a".repeat(64) });
  config.limits.mailBodyBytes = 2048;
  assert.equal(validateConfig(config).limits.mailBodyBytes, 2048);
  const f = fixture({ mailBodyBytes: 2048 });
  try {
    const candidate = f.candidateWith({ "a.txt": "a" });
    await f.submit("alice", candidate);
    await f.open("alice", { tier: "MEDIUM", candidate }, "open");
    const name = f.requestName("open");
    let count = 0;
    let reviewError = null;
    // Long, individually valid entries first exercise the anchored omission
    // path. Then fill the remaining space with short entries. The smaller
    // supported mail bound makes the same history boundary cheap to reach.
    for (; count < 80; count++) {
      try { await f.review("bob", name, `review-${count}`, "r".repeat(500)); }
      catch (error) { reviewError = error.code; break; }
    }
    for (; count < 100; count++) {
      try { await f.review("bob", name, `short-${count}`, "looked"); }
      catch (error) { reviewError = error.code; break; }
    }
    let voteError = null;
    let cancelError = null;
    try { await f.vote("carol", name, "approve", "ok", "short-vote"); }
    catch (error) { voteError = error.code; }
    if (voteError !== null) {
      try { await f.cancel("alice", name, "cancel"); }
      catch (error) { cancelError = error.code; }
    }
    let afterRestart = null;
    if (voteError !== null && cancelError !== null) {
      f.reopen();
      try { await f.cancel("alice", name, "cancel"); }
      catch (error) { afterRestart = error.code; }
    }
    t.diagnostic(JSON.stringify({ mailBodyBytes: 2048, acceptedReviews: count,
      reviewError, voteError, cancelError, cancelAfterRestart: afterRestart, display: f.stateOf(name).display }));
    assert.ok(voteError === null || cancelError === null,
      "an accepted request must not be permanently locked by its own bounded-history rendering");
  } finally { f.close(); }
});
