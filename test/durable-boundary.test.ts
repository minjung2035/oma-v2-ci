import { createGitModule } from "#oma-test/app/broker/git-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { serializePlanIntent } from "./fixtures/plan.js";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitModule } from "@oma/git";
import { MailModule } from "@oma/mail";
import { Store } from "@oma/storage";
import { StoreError } from "@oma/domain/errors";
import { requestHash } from "@oma/domain/request-identity";
import { sha256Hex } from "@oma/domain/canonical-json";
import { publishedRefFor, submitBundleFor, messageIdForOperation } from "@oma/domain/derived";
import { buildFrozenMessage } from "@oma/mail/serialize";
import { messagePlanFrom } from "@oma/mail/facts";
import type { AuthContext, MessagePlan, OperationPlan } from "@oma/contracts";
import { makeValidAgent } from "./fixtures/spec.js";
import { makeValidOperation, makeValidMessagePlan } from "./fixtures/valid.js";
import { corruptOperationForTest, replaceArtifactBytes } from "./fixtures/corruption.js";
import { seedGit, gitCommand } from "./fixtures/git-crash.js";
const OP = "op-00000000-0000-4000-8000-000000000001";
const CREATE_OP = "op-00000000-0000-4000-8000-000000000002";
const ACK_OP = "op-00000000-0000-4000-8000-000000000003";
const ACK_MESSAGE = "m-00000000-0000-4000-8000-000000000004-0";
const MAIL_OP = "op-00000000-0000-4000-8000-000000000005";
const SUBMIT_REF_OP = "op-00000000-0000-4000-8000-000000000006";
const SUBMIT_PATH_OP = "op-00000000-0000-4000-8000-000000000007";
const SUBMIT_RECOVERY_OP = "op-00000000-0000-4000-8000-000000000008";
const corrupt = (error: unknown) => error instanceof StoreError && error.code === "STORE_CORRUPT";
function fixture(t: TestContext) {
    const root = mkdtempSync(join(tmpdir(), "oma-durable-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const path = join(root, "runtime.sqlite");
    const store = new Store(path);
    store.transaction(() => store.insertAgent(makeValidAgent("alice", { incarnation: 0 })));
    assert.equal(store.getAgent("alice")?.name, "alice", "normal agent control must decode");
    return { root, path, store };
}
function seedRoute(store: Store, root: string): void {
    store.transaction(() => store.insertOperation(makeValidOperation({ stateRoot: root, id: OP })));
    assert.equal(store.getOperation("alice", "durable")?.state, "pending", "normal operation control must decode");
}
function assertCorruptReads(store: Store, id: string, key: string): void {
    assert.throws(() => store.getOperation("alice", key), corrupt);
    assert.throws(() => store.getOperationById(id), corrupt);
}
function insertOwned(store: Store, id: string, key: string, payload: unknown, plan: OperationPlan, message: MessagePlan): void {
    store.transaction(() => {
        store.insertOperation({ id, actor: "alice", requestKey: key, requestHash: requestHash(plan.kind, payload), kind: plan.kind,
            payloadJson: JSON.stringify(payload), planJson: serializePlanIntent(plan) });
        store.insertDeliveries(message.recipients.map(recipient => ({ messageId: message.id, recipient, operationId: id })));
    });
    assert.equal(store.getOperationById(id)?.state, "pending", "owned operation control must decode before corruption");
}
function submitFixture(root: string, id: string, bytes = Buffer.from("fixture bundle\n")) {
    const candidate = "1".repeat(40);
    const exportRef = `refs/oma/export/req-${id.slice(-2)}`;
    const digest = { bytes: bytes.length, sha256: sha256Hex(bytes) };
    const message = makeValidMessagePlan(id, { kind: "result" });
    const payload = { candidate, exportRef, prerequisites: [], to: ["alice"], subject: "candidate", body: "fixture", paths: [],
        bundle: { ...digest, mediaType: "application/x-git-bundle" } };
    const plan = { kind: "git.submit" as const, candidate, exportRef, prerequisites: [], bundle: { path: join(root, submitBundleFor(id)), ...digest },
        publishedRef: publishedRefFor("alice", id), message };
    return { payload, plan, message };
}
test("DB-009: unknown durable plan fields fail closed before recovery use", t => {
    const { root, path, store } = fixture(t);
    seedRoute(store, root);
    const plan = store.getOperationById(OP)!.plan;
    store.close();
    corruptOperationForTest(path, OP, "plan_json", JSON.stringify({ ...plan, injectedPath: "/tmp/escape" }));
    const reopened = new Store(path);
    try {
        assertCorruptReads(reopened, OP, "durable");
    }
    finally {
        reopened.close();
    }
});
test("DB-009: message identity and object path are derived from the operation", t => {
    const { path, store } = fixture(t);
    const message = makeValidMessagePlan(MAIL_OP);
    const payload = { to: ["alice"], subject: "mail", kind: "message", body: "fixture" };
    insertOwned(store, MAIL_OP, "mail-relation", payload, { kind: "mail.send", message }, message);
    store.close();
    corruptOperationForTest(path, MAIL_OP, "plan_json", JSON.stringify({ kind: "mail.send", message: { ...message, id: "m-00000000-0000-4000-8000-000000000099-0" } }));
    const reopened = new Store(path);
    try {
        assertCorruptReads(reopened, MAIL_OP, "mail-relation");
    }
    finally {
        reopened.close();
    }
});
test("DB-009: git.submit published ref and bundle path are operation-derived", t => {
    const { root, path, store } = fixture(t);
    const ref = submitFixture(root, SUBMIT_REF_OP);
    const bundle = submitFixture(root, SUBMIT_PATH_OP);
    insertOwned(store, SUBMIT_REF_OP, "bad-ref", ref.payload, ref.plan, ref.message);
    insertOwned(store, SUBMIT_PATH_OP, "bad-path", bundle.payload, bundle.plan, bundle.message);
    store.close();
    corruptOperationForTest(path, SUBMIT_REF_OP, "plan_json", JSON.stringify({ ...ref.plan, publishedRef: publishedRefFor("alice", "op-00000000-0000-4000-8000-000000000099") }));
    corruptOperationForTest(path, SUBMIT_PATH_OP, "plan_json", JSON.stringify({ ...bundle.plan, bundle: { ...bundle.plan.bundle, path: join(root, "outside", "upload.bundle") } }));
    const reopened = new Store(path);
    try {
        assertCorruptReads(reopened, SUBMIT_REF_OP, "bad-ref");
        assertCorruptReads(reopened, SUBMIT_PATH_OP, "bad-path");
    }
    finally {
        reopened.close();
    }
});
test("ERR-001/REC-006: accepted submit bundle corruption cannot become terminal STREAM_INVALID", async (t) => {
    const { root, store } = fixture(t);
    seedGit(root);
    const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 8);
    const git = createGitModule({ stateRoot: root, projectGit: join(root, "repos/project.git"), contextGit: join(root, "repos/context.git"), worldDir: join(root, "world"), society: "demo" }, store, mail);
    try {
        const bytes = readFileSync(join(root, "candidate.bundle"));
        const initial = submitFixture(root, SUBMIT_RECOVERY_OP, bytes);
        const candidate = gitCommand(join(root, "seed"), ["rev-parse", "HEAD"]);
        const base = gitCommand(join(root, "seed"), ["rev-parse", "HEAD^"]);
        const payload = { ...initial.payload, candidate, exportRef: "refs/oma/export/crash", prerequisites: [base] };
        const eml = await buildFrozenMessage({ id: messageIdForOperation(SUBMIT_RECOVERY_OP, 0), sender: "alice", society: "demo", to: ["alice"], kind: "result", contextRevision: null,
            replyHeaders: { replyTo: ["alice"], inReplyTo: null, references: [] } }, { subject: payload.subject, body: payload.body });
        const message = messagePlanFrom(eml, ["alice"]);
        mail.freezeObject(message.id, eml);
        const plan = { ...initial.plan, candidate, exportRef: payload.exportRef, prerequisites: [base], message };
        mkdirSync(join(root, "staging", `submit-${SUBMIT_RECOVERY_OP}`), { recursive: true });
        writeFileSync(plan.bundle.path, bytes);
        insertOwned(store, SUBMIT_RECOVERY_OP, "submit-recovery", payload, plan, message);
        assert.equal(sha256Hex(readFileSync(plan.bundle.path)), plan.bundle.sha256, "artifact control matches its frozen digest");
        replaceArtifactBytes(plan.bundle.path, "deliberately corrupt accepted bundle");
        await assert.rejects(git.reconcile(SUBMIT_RECOVERY_OP), corrupt);
        assert.equal(store.getOperationById(SUBMIT_RECOVERY_OP)?.state, "pending", "recovery corruption must not be rewritten as a client STREAM_INVALID failure");
    }
    finally {
        store.close();
    }
});
test("ERR-001: preaccept-only failures cannot terminalize an accepted operation", t => {
    const { root, store } = fixture(t);
    seedRoute(store, root);
    try {
        for (const code of ["STREAM_INVALID", "LIMIT_EXCEEDED", "STORAGE_FULL"] as const) {
            assert.throws(() => store.transaction(() => store.setOperationFailed(OP, code)), corrupt, code);
            assert.equal(store.getOperationById(OP)?.state, "pending");
        }
    }
    finally {
        store.close();
    }
});
test("ERR-001: persisted failed preaccept-only code is STORE_CORRUPT", t => {
    const { root, path, store } = fixture(t);
    seedRoute(store, root);
    store.transaction(() => store.setOperationFailed(OP, "INTERNAL_ERROR"));
    assert.equal(store.getOperationById(OP)?.state, "failed");
    store.close();
    corruptOperationForTest(path, OP, "error_code", "STREAM_INVALID");
    const reopened = new Store(path);
    try {
        assertCorruptReads(reopened, OP, "durable");
    }
    finally {
        reopened.close();
    }
});
test("ERR-001: persisted operation error code is a closed runtime enum", t => {
    const { root, path, store } = fixture(t);
    seedRoute(store, root);
    store.transaction(() => store.setOperationFailed(OP, "INTERNAL_ERROR"));
    assert.equal(store.getOperationById(OP)?.errorCode, "INTERNAL_ERROR");
    store.close();
    corruptOperationForTest(path, OP, "error_code", "BOGUS_ERROR");
    const reopened = new Store(path);
    try {
        assertCorruptReads(reopened, OP, "durable");
    }
    finally {
        reopened.close();
    }
});
test("DB-009: scalar message ids are not treated as MessagePlan objects", t => {
    const { store } = fixture(t);
    try {
        const payload = { message: ACK_MESSAGE };
        store.transaction(() => store.insertOperation({ id: ACK_OP, actor: "alice", requestKey: "ack", requestHash: requestHash("mail.ack", payload), kind: "mail.ack",
            payloadJson: JSON.stringify(payload), planJson: serializePlanIntent({ kind: "mail.ack", recipient: "alice", message: ACK_MESSAGE }) }));
        assert.equal(store.getOperation("alice", "ack")?.id, ACK_OP);
        assert.equal(store.getOperationById(ACK_OP)?.kind, "mail.ack");
    }
    finally {
        store.close();
    }
});
test("DB-009: parseable wrong result fails closed for every operation read", t => {
    const { root, path, store } = fixture(t);
    seedRoute(store, root);
    store.transaction(() => store.setOperationSucceeded(OP, JSON.stringify({ kind: "route.follow", topic: "dev", subscribed: true })));
    assert.equal(store.getOperationById(OP)?.state, "succeeded");
    store.close();
    corruptOperationForTest(path, OP, "result_json", JSON.stringify({ kind: "route.follow", topic: "dev", subscribed: true, extra: "corrupt" }));
    const reopened = new Store(path);
    try {
        assertCorruptReads(reopened, OP, "durable");
    }
    finally {
        reopened.close();
    }
});
test("DB-009: create initial EML is an immutable object before acceptance", async (t) => {
    const { root, store } = fixture(t);
    const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 8);
    const auth: AuthContext = { actor: "alice", incarnation: 0, role: "resident", channel: "actor", capabilities: new Set(["agent.create"]),
        peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } };
    try {
        const { message } = await mail.freezeCreateInitial(auth, CREATE_OP, "bob", "frozen brief");
        const object = mail.objectPath(message.id);
        assert.equal(existsSync(object), true);
        const bytes = readFileSync(object);
        assert.equal(bytes.length, message.bytes);
        assert.equal(createHash("sha256").update(bytes).digest("hex"), message.sha256);
    }
    finally {
        store.close();
    }
});
