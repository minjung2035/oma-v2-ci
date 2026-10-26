import { createGitModule } from "#oma-test/app/broker/git-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
/** DR27/CTX: explicit mail intent, exact bytes and host-enforced document scope. */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { Store } from "@oma/storage";
import { ContextPublicationObserver } from "@oma/git/context-publication";
import { createCanonicalObserver } from "@oma/git/canonical-command";
import { StoreError } from "@oma/domain/errors";
import { GitModule } from "@oma/git";
import type { ContextInput } from "@oma/git/context";
import { MailModule } from "@oma/mail";
import { readableBody } from "@oma/mail/display";
import { sha256Hex } from "@oma/domain/canonical-json";
import type { AuthContext } from "@oma/contracts";
import { ALL_CAPS, makeValidAgent } from "./fixtures/spec.js";
import { gitCommand } from "./fixtures/git-crash.js";
import { removeTree } from "./fixtures/cleanup.js";
const auth: AuthContext = { actor: "principal", incarnation: 0, role: "principal", channel: "actor", capabilities: new Set(ALL_CAPS),
    peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } };
function input(files: Record<string, string>, expected: string | null, subject?: string) {
    const ordered = Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    const bytes = Buffer.from(ordered.map(([, body]) => body).join(""));
    const request: ContextInput = { expected, ...(subject === undefined ? {} : { goalMail: { subject } }),
        entries: ordered.map(([path, body]) => ({ path, bytes: Buffer.byteLength(body), sha256: sha256Hex(Buffer.from(body)) })),
        content: { bytes: bytes.length, sha256: sha256Hex(bytes), mediaType: "application/vnd.oma.context-v1" } };
    return { request, stream: async function* () { yield bytes; } };
}
function fixture(t: TestContext) {
    const root = mkdtempSync(join(tmpdir(), "oma-goal-"));
    mkdirSync(join(root, "repos"));
    const contextGit = join(root, "repos/context.git");
    gitCommand(root, ["init", "--bare", contextGit]);
    let store = new Store(join(root, "runtime.sqlite"));
    store.transaction(tx => { tx.insertAgent(makeValidAgent("principal")); tx.insertAgent(makeValidAgent("alice")); });
    const paths = { stateRoot: root, projectGit: join(root, "repos/project.git"), contextGit, worldDir: join(root, "world"), society: "demo" };
    let mail = createMailModule({ stateRoot: root, society: "demo" }, store, 64);
    let git = createGitModule(paths, store, mail);
    t.after(() => { store.close(); removeTree(root); });
    return { root, contextGit, get store() { return store; }, get mail() { return mail; }, get git() { return git; },
        reopen(change?: () => void) { store.close(); change?.(); store = new Store(join(root, "runtime.sqlite")); mail = createMailModule({ stateRoot: root, society: "demo" }, store, 64); git = createGitModule(paths, store, mail); },
        publish(key: string, files: Record<string, string>, expected: string | null, subject?: string, actor = auth) {
            const i = input(files, expected, subject);
            return git.publishContext(actor, key, i.request, i.stream());
        },
        operation(key: string) { const op = store.getOperation("principal", key); assert.ok(op?.kind === "context.publish"); return op; },
        revision() { return gitCommand(root, ["--git-dir", contextGit, "rev-parse", "refs/heads/main"]); },
    };
}
test("DR27: GOAL mail and published document have the exact sender bytes", async (t) => {
    const f = fixture(t);
    let base: string | null = null;
    for (const [index, body] of ["plain", "plain\n", "a\nb\n", "﻿goal", "Goal\r\nSecond\n", "한글\n"].entries()) {
        const key = `goal-${index}`;
        const receipt = await f.publish(key, { "GOAL.md": body }, base, "  Goal  ");
        assert.equal(receipt.state, "succeeded");
        const op = f.operation(key);
        base = op.plan.candidate;
        assert.equal(readableBody(readFileSync(f.mail.archivePath(op.plan.message.id), "utf8")), body);
        assert.deepEqual(readFileSync(join(f.root, "world/context/current/GOAL.md")), Buffer.from(body));
        assert.deepEqual(op.plan.message.recipients, ["alice"]);
        assert.deepEqual(await f.publish(key, { "GOAL.md": body }, op.plan.base, "  Goal  "), receipt);
    }
});
test("DR27: GOAL intent preserves all other documents; direct callers cannot add, edit or remove them", async (t) => {
    const f = fixture(t);
    const files = { "GOAL.md": "first", "RATIONALE.md": "why\r\n", "decisions/one.md": "decision\n" };
    await f.publish("seed", files, null);
    const base = f.revision();
    const attacks = [
        { "GOAL.md": "next" },
        { ...files, "GOAL.md": "next", "RATIONALE.md": "changed" },
        { ...files, "GOAL.md": "next", "decisions/one.md": "changed" },
        { ...files, "GOAL.md": "next", "decisions/two.md": "new" },
    ];
    for (const [i, changed] of attacks.entries()) {
        await assert.rejects(f.publish(`attack-${i}`, changed, base, "Goal"), { code: "INVALID_REQUEST" });
        assert.equal(f.store.getOperation("principal", `attack-${i}`), null);
        assert.equal(f.revision(), base);
        assert.equal(readdirSync(join(f.root, "mail/objects")).length, 1);
    }
    assert.equal((await f.publish("next", { ...files, "GOAL.md": "next" }, base, "Goal")).state, "succeeded");
    for (const path of ["RATIONALE.md", "decisions/one.md"] as const)
        assert.equal(readFileSync(join(f.root, "world/context/current", path), "utf8"), files[path]);
});
test("DR27: first GOAL cannot introduce other documents; a Resident or ordinary context mail has no GOAL authority", async (t) => {
    const f = fixture(t);
    await assert.rejects(f.publish("extra", { "GOAL.md": "first", "RATIONALE.md": "new" }, null, "Goal"), { code: "INVALID_REQUEST" });
    await assert.rejects(f.publish("resident", { "GOAL.md": "first" }, null, "Goal", { ...auth, actor: "alice", role: "resident", incarnation: 1 }), { code: "CAPABILITY_DENIED" });
    await f.mail.send(auth, "ordinary", { to: ["residents"], subject: "Not an intent", kind: "context", body: "GOAL.md: not authoritative" });
    assert.equal(f.git.hasCommittedContext(), false);
    assert.equal(f.store.getOperation("principal", "extra"), null);
    assert.equal(f.store.getOperation("alice", "resident"), null);
});
test("DR27/P0: stale GOAL is not accepted; a restarted same-key query retains original bytes and recipients", async (t) => {
    const f = fixture(t);
    const files = { "GOAL.md": "first" };
    const receipt = await f.publish("first", files, null, "Goal");
    const original = f.operation("first");
    const bytes = readFileSync(f.mail.archivePath(original.plan.message.id));
    f.reopen();
    f.store.transaction(tx => tx.insertAgent(makeValidAgent("bob")));
    assert.deepEqual(await f.publish("first", files, null, "Goal"), receipt);
    assert.deepEqual(f.operation("first"), original);
    assert.deepEqual(readFileSync(f.mail.archivePath(original.plan.message.id)), bytes);
    assert.equal(f.store.pendingDeliveries("bob").length, 0);
    await assert.rejects(f.publish("stale", { "GOAL.md": "new" }, null, "Goal"), { code: "CONTEXT_CONFLICT" });
    assert.equal(f.store.getOperation("principal", "stale"), null);
    await assert.rejects(f.publish("first", { "GOAL.md": "changed source" }, null, "Goal"), { code: "REQUEST_KEY_REUSED" });
});
test("DR27/P0: post-CAS GOAL publication finishes after stop and restart without re-rendering mail", async (t) => {
    const f = fixture(t);
    t.mock.method(f.mail, "publishGated", async () => { throw new Error("injected lost publication"); });
    await assert.rejects(f.publish("goal", { "GOAL.md": "exact\n" }, null, "Goal"));
    const original = f.operation("goal");
    const object = readFileSync(f.mail.objectPath(original.plan.message.id));
    assert.equal(f.revision(), original.plan.candidate);
    assert.equal(existsSync(f.mail.archivePath(original.plan.message.id)), false);
    f.store.transaction(tx => { tx.updateAgent({ name: "principal", desired: "stopped" }); tx.insertAgent(makeValidAgent("bob")); });
    f.reopen();
    await f.git.reconcile(original.id);
    assert.equal(f.operation("goal").state, "succeeded");
    assert.equal(f.operation("goal").planJson, original.planJson);
    assert.deepEqual(readFileSync(f.mail.archivePath(original.plan.message.id)), object);
    assert.equal(f.store.pendingDeliveries("bob").length, 0);
});
for (const wrong of ["body", "subject"] as const)
    test(`DR27/P0: even hash-valid accepted mail cannot contradict its GOAL ${wrong}`, async (t) => {
        const f = fixture(t);
        const prepare = f.mail.freezeNotification.bind(f.mail);
        // Inject a fully valid but unrelated immutable mail object at the producer seam.
        t.mock.method(f.mail, "freezeNotification", async (...args: Parameters<MailModule["freezeNotification"]>) => {
            const frozen = await prepare(...args);
            const id = frozen.message.id;
            const old = readFileSync(f.mail.objectPath(id), "utf8");
            const changed = wrong === "body" ? old.replace(Buffer.from("Goal bytes").toString("base64"), Buffer.from("Other body").toString("base64")) : old.replace("Subject: Goal", "Subject: Fake");
            assert.notEqual(old, changed);
            const altered = { text: changed, bytes: Buffer.byteLength(changed), sha256: sha256Hex(Buffer.from(changed)) };
            frozen.artifact.discardUnaccepted();
            return { message: { ...frozen.message, bytes: altered.bytes, sha256: altered.sha256 },
                artifact: f.mail.freezeObject(id, altered) };
        });
        await assert.rejects(f.publish("wrong", { "GOAL.md": "Goal bytes" }, null, "Goal"), { code: "STORE_CORRUPT" });
        const op = f.operation("wrong");
        assert.equal(op.state, "pending", "an applied ref is not undone by publication corruption");
        assert.equal(existsSync(f.mail.archivePath(op.plan.message.id)), false);
        assert.equal(f.revision(), op.plan.candidate);
    });
test("CTX-003/P0: content-identical GOAL has a durable authorization witness and one notification", async (t) => {
    const f = fixture(t);
    const files = { "GOAL.md": "same" };
    await f.publish("first", files, null, "First");
    const base = f.revision();
    const receipt = await f.publish("same", files, base, "Again");
    const op = f.operation("same");
    assert.equal(receipt.state, "succeeded");
    assert.equal(op.plan.base, op.plan.candidate);
    assert.equal(op.plan.noopRef, `refs/oma/context/${op.id}`);
    assert.equal(gitCommand(f.root, ["--git-dir", f.contextGit, "rev-parse", op.plan.noopRef!]), base);
    const mail = readFileSync(f.mail.archivePath(op.plan.message.id));
    f.reopen();
    assert.deepEqual(await f.publish("same", files, base, "Again"), receipt);
    assert.deepEqual(readFileSync(f.mail.archivePath(op.plan.message.id)), mail);
    assert.equal(f.store.deliveriesForOperation(op.id).length, 1);
});
for (const stopped of [false, true])
    test(`CTX-003/P0: no-op without a witness ${stopped ? "cannot bypass a stop" : "can resume with current authority"}`, async (t) => {
        const f = fixture(t);
        const files = { "GOAL.md": "same" };
        await f.publish("first", files, null, "First");
        const base = f.revision();
        const mock = t.mock.method(ContextPublicationObserver.prototype, "authorizeNoop", () => { throw new StoreError("REF_STATE_UNKNOWN", "injected before authorization"); });
        await assert.rejects(f.publish("same", files, base, "Again"), { code: "REF_STATE_UNKNOWN" });
        mock.mock.restore();
        const before = f.operation("same");
        assert.equal(before.state, "unknown");
        assert.equal(existsSync(f.mail.archivePath(before.plan.message.id)), false);
        const observer = new ContextPublicationObserver(createCanonicalObserver(), f.contextGit);
        assert.throws(() => observer.observe(before), { code: "REF_STATE_UNKNOWN" }, "main equality cannot authorize the mail owner");
        if (stopped)
            f.store.transaction(tx => tx.updateAgent({ name: "principal", desired: "stopped" }));
        f.reopen();
        if (stopped) {
            await assert.rejects(f.git.reconcile(before.id), { code: "CANCELLED_BEFORE_COMMIT", effectKnowledge: "none" });
            assert.equal(f.operation("same").state, "failed");
            assert.equal(existsSync(f.mail.archivePath(before.plan.message.id)), false);
        }
        else {
            await f.git.reconcile(before.id);
            assert.equal(f.operation("same").state, "succeeded");
            assert.equal(readableBody(readFileSync(f.mail.archivePath(before.plan.message.id), "utf8")), "same");
        }
        assert.equal(f.operation("same").planJson, before.planJson);
        assert.equal(f.revision(), base);
    });
test("CTX-003/P0: lost reply after the no-op witness settles after stop, never reauthorizes", async (t) => {
    const f = fixture(t);
    const files = { "GOAL.md": "same" };
    await f.publish("first", files, null, "First");
    const base = f.revision();
    const real = ContextPublicationObserver.prototype.authorizeNoop;
    const mock = t.mock.method(ContextPublicationObserver.prototype, "authorizeNoop", function (this: ContextPublicationObserver, op: Parameters<typeof real>[0]) {
        assert.equal(real.call(this, op), true);
        throw new StoreError("REF_STATE_UNKNOWN", "injected lost authorization reply");
    });
    await assert.rejects(f.publish("same", files, base, "Again"), { code: "REF_STATE_UNKNOWN" });
    mock.mock.restore();
    const before = f.operation("same");
    const bytes = readFileSync(f.mail.objectPath(before.plan.message.id));
    f.store.transaction(tx => tx.updateAgent({ name: "principal", desired: "stopped" }));
    f.reopen();
    t.mock.method(ContextPublicationObserver.prototype, "authorizeNoop", () => assert.fail("repeated historical authorization"));
    await f.git.reconcile(before.id);
    assert.equal(f.operation("same").state, "succeeded");
    assert.equal(f.operation("same").planJson, before.planJson);
    assert.deepEqual(readFileSync(f.mail.archivePath(before.plan.message.id)), bytes);
});
test("CTX-003/P0: a no-op witness naming another revision is corruption, not authorization", async (t) => {
    const f = fixture(t);
    await f.publish("first", { "GOAL.md": "first" }, null, "First");
    const old = f.revision();
    await f.publish("next", { "GOAL.md": "next" }, old, "Next");
    const base = f.revision();
    const mock = t.mock.method(ContextPublicationObserver.prototype, "authorizeNoop", () => { throw new StoreError("REF_STATE_UNKNOWN", "injected"); });
    await assert.rejects(f.publish("same", { "GOAL.md": "next" }, base, "Again"));
    mock.mock.restore();
    const op = f.operation("same");
    gitCommand(f.root, ["--git-dir", f.contextGit, "update-ref", op.plan.noopRef!, old]);
    f.reopen();
    await assert.rejects(f.git.reconcile(op.id), { code: "STORE_CORRUPT" });
    assert.equal(f.operation("same").state, "unknown");
    assert.equal(existsSync(f.mail.archivePath(op.plan.message.id)), false);
});
test("DR27/CTX-001: a full GOAL stream may retain zero-byte documents at the exact context bound", async (t) => {
    const f = fixture(t);
    await f.publish("seed", { "GOAL.md": "first", "RATIONALE.md": "why", "decisions/empty.md": "" }, null);
    const file = join(f.root, "goal.txt");
    writeFileSync(file, "x".repeat(125));
    const script = `import { prepareGoalEffects } from ${JSON.stringify(new URL(import.meta.resolve("#oma-test/app/cli/effects/goal")).href)};
    process.stdout.write(JSON.stringify(prepareGoalEffects(process.argv[1], process.argv[2])));`;
    const prepare = (maximum: number) => spawnSync(process.execPath, ["--input-type=module", "-e", script, file, f.revision()], { encoding: "utf8", timeout: 10000, env: { OMA_CONTEXT_GIT: f.contextGit, OMA_CONTEXT_BYTES: String(maximum) } });
    const exact = prepare(128);
    assert.equal(exact.status, 0, exact.stderr);
    const result = JSON.parse(exact.stdout);
    assert.equal(result.digest.bytes, 128);
    assert.deepEqual(result.entries.map((entry: {
        path: string;
        bytes: number;
    }) => [entry.path, entry.bytes]), [["GOAL.md", 125], ["RATIONALE.md", 3], ["decisions/empty.md", 0]]);
    const smaller = prepare(127);
    assert.notEqual(smaller.status, 0);
    assert.equal(f.store.getOperation("principal", "seed")!.state, "succeeded");
});
