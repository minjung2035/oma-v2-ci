import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitModule } from "../src/git.js";
import { MailModule } from "../src/mail.js";
import { Store, StoreError } from "../src/store.js";
import type { AuthContext } from "../implementation/contracts.js";
import { resolvedSpec, ALL_CAPS } from "./fixtures/spec.js";

const OP = "op-00000000-0000-4000-8000-000000000001";
const CREATE_OP = "op-00000000-0000-4000-8000-000000000002";
const ACK_OP = "op-00000000-0000-4000-8000-000000000003";
const ACK_MESSAGE = "m-00000000-0000-4000-8000-000000000004-0";
const MAIL_OP = "op-00000000-0000-4000-8000-000000000005";
const SUBMIT_REF_OP = "op-00000000-0000-4000-8000-000000000006";
const SUBMIT_PATH_OP = "op-00000000-0000-4000-8000-000000000007";
const SUBMIT_RECOVERY_OP = "op-00000000-0000-4000-8000-000000000008";

function seed(path: string): Store {
  const store = new Store(path);
  store.transaction(() => {
    store.insertAgent({
      name: "alice",
      specHash: "alice",
      role: "resident",
      desired: "enabled",
      incarnation: 0,
      profile: "p",
      createdBy: null,
      specJson: resolvedSpec(ALL_CAPS, "p", "alice"),
    });
    store.insertOperation({
      id: OP,
      actor: "alice",
      requestKey: "durable",
      requestHash: "hash",
      kind: "route.follow",
      payloadJson: JSON.stringify({ topic: "dev" }),
      planJson: JSON.stringify({
        kind: "route.follow",
        topic: "dev",
        agent: "alice",
      }),
    });
  });
  return store;
}

function messagePlan(operationId: string, id = `m-${operationId.slice(3)}-0`) {
  return {
    id,
    objectPath: `mail/objects/${id}.eml`,
    sha256: "a".repeat(64),
    bytes: 1,
    dateMs: 1,
    to: ["alice"],
    recipients: ["alice"],
    kind: "message" as const,
    contextRevision: null,
    replyHeaders: { replyTo: ["alice"], inReplyTo: null, references: [] },
  };
}

function insertAlice(store: Store): void {
  store.insertAgent({
    name: "alice",
    specHash: "alice",
    role: "resident",
    desired: "enabled",
    incarnation: 0,
    profile: "p",
    createdBy: null,
    specJson: resolvedSpec(ALL_CAPS, "p", "alice"),
  });
}

test("DB-009: unknown durable plan fields fail closed before recovery use", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-durable-plan-"));
  const path = join(root, "runtime.sqlite");
  let store = seed(path);
  store.close();
  const raw = new DatabaseSync(path);
  raw.prepare("UPDATE operations SET plan_json=? WHERE id=?").run(
    JSON.stringify({
      kind: "route.follow",
      topic: "dev",
      agent: "alice",
      injectedPath: "/tmp/escape",
    }),
    OP,
  );
  raw.close();
  store = new Store(path);
  try {
    assert.throws(
      () => store.getOperation("alice", "durable"),
      (error: unknown) =>
        error instanceof StoreError && error.code === "STORE_CORRUPT",
    );
    assert.throws(
      () => store.getOperationById(OP as never),
      (error: unknown) =>
        error instanceof StoreError && error.code === "STORE_CORRUPT",
    );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("DB-009: message identity and object path are derived from the operation", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-durable-message-relation-"));
  const store = new Store(join(root, "runtime.sqlite"));
  try {
    store.transaction(() => {
      insertAlice(store);
      const wrongMessage = "m-00000000-0000-4000-8000-000000000099-0";
      store.insertOperation({
        id: MAIL_OP,
        actor: "alice",
        requestKey: "mail-relation",
        requestHash: "hash",
        kind: "mail.send",
        payloadJson: "{}",
        planJson: JSON.stringify({
          kind: "mail.send",
          message: messagePlan(MAIL_OP, wrongMessage),
        }),
      });
    });
    assert.throws(
      () => store.getOperationById(MAIL_OP as never),
      (error: unknown) =>
        error instanceof StoreError && error.code === "STORE_CORRUPT",
    );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("DB-009: git.submit published ref and bundle path are operation-derived", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-durable-submit-relation-"));
  const store = new Store(join(root, "runtime.sqlite"));
  const validBundlePath = (operationId: string) =>
    join(root, "staging", `submit-${operationId}`, "upload.bundle");
  const submitPlan = (
    operationId: string,
    publishedRef: string,
    bundlePath: string,
  ) => ({
    kind: "git.submit" as const,
    candidate: "1".repeat(40),
    exportRef: `refs/oma/export/req-${operationId.slice(-2)}`,
    prerequisites: [],
    bundle: {
      path: bundlePath,
      sha256: "b".repeat(64),
      bytes: 1,
    },
    publishedRef,
    message: { ...messagePlan(operationId), kind: "result" as const },
  });
  try {
    store.transaction(() => {
      insertAlice(store);
      store.insertOperation({
        id: SUBMIT_REF_OP,
        actor: "alice",
        requestKey: "bad-ref",
        requestHash: "hash-ref",
        kind: "git.submit",
        payloadJson: "{}",
        planJson: JSON.stringify(
          submitPlan(
            SUBMIT_REF_OP,
            `refs/oma/published/alice/op-00000000-0000-4000-8000-000000000099`,
            validBundlePath(SUBMIT_REF_OP),
          ),
        ),
      });
      store.insertOperation({
        id: SUBMIT_PATH_OP,
        actor: "alice",
        requestKey: "bad-path",
        requestHash: "hash-path",
        kind: "git.submit",
        payloadJson: "{}",
        planJson: JSON.stringify(
          submitPlan(
            SUBMIT_PATH_OP,
            `refs/oma/published/alice/${SUBMIT_PATH_OP}`,
            join(root, "outside", "upload.bundle"),
          ),
        ),
      });
    });
    for (const operationId of [SUBMIT_REF_OP, SUBMIT_PATH_OP]) {
      assert.throws(
        () => store.getOperationById(operationId as never),
        (error: unknown) =>
          error instanceof StoreError && error.code === "STORE_CORRUPT",
      );
    }
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("ERR-001/REC-006: accepted submit bundle corruption cannot become terminal STREAM_INVALID", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-durable-submit-recovery-"));
  const projectGit = join(root, "project.git");
  const initialized = spawnSync("git", ["init", "-q", "--bare", projectGit], {
    encoding: "utf8",
  });
  assert.equal(initialized.status, 0, initialized.stderr);
  const store = new Store(join(root, "runtime.sqlite"));
  const mail = new MailModule({ stateRoot: root, society: "demo" }, store, 8);
  const git = new GitModule(
    {
      stateRoot: root,
      projectGit,
      contextGit: join(root, "context.git"),
      worldDir: join(root, "world"),
      society: "demo",
      quarantineTmpBytes: 1024 * 1024,
      quarantineResources: {
        cpuSeconds: 1,
        memoryBytes: 64 * 1024 * 1024,
        tasks: 32,
      },
      checkTimeoutSeconds: 1,
    },
    store,
    mail,
  );
  const message = { ...messagePlan(SUBMIT_RECOVERY_OP), kind: "result" as const };
  try {
    store.transaction(() => {
      insertAlice(store);
      store.insertOperation({
        id: SUBMIT_RECOVERY_OP,
        actor: "alice",
        requestKey: "submit-recovery",
        requestHash: "hash",
        kind: "git.submit",
        payloadJson: "{}",
        planJson: JSON.stringify({
          kind: "git.submit",
          candidate: "1".repeat(40),
          exportRef: "refs/oma/export/req-recovery",
          prerequisites: [],
          bundle: {
            path: join(
              root,
              "staging",
              `submit-${SUBMIT_RECOVERY_OP}`,
              "upload.bundle",
            ),
            sha256: "b".repeat(64),
            bytes: 1,
          },
          publishedRef: `refs/oma/published/alice/${SUBMIT_RECOVERY_OP}`,
          message,
        }),
      });
      store.insertDeliveries([
        {
          messageId: message.id,
          recipient: "alice",
          operationId: SUBMIT_RECOVERY_OP,
        },
      ]);
    });
    await assert.rejects(
      git.reconcile(SUBMIT_RECOVERY_OP),
      (error: unknown) =>
        error instanceof StoreError && error.code === "STORE_CORRUPT",
    );
    assert.equal(
      store.getOperationById(SUBMIT_RECOVERY_OP as never)?.state,
      "pending",
      "recovery corruption must not be rewritten as a client STREAM_INVALID failure",
    );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("ERR-001: persisted operation error code is a closed runtime enum", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-durable-error-code-"));
  const path = join(root, "runtime.sqlite");
  let store = seed(path);
  store.transaction(() => store.setOperationFailed(OP as never, "INTERNAL_ERROR"));
  store.close();
  const raw = new DatabaseSync(path);
  raw.prepare("UPDATE operations SET error_code=? WHERE id=?").run("BOGUS_ERROR", OP);
  raw.close();
  store = new Store(path);
  try {
    assert.throws(
      () => store.getOperationById(OP as never),
      (error: unknown) =>
        error instanceof StoreError && error.code === "STORE_CORRUPT",
    );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("DB-009: scalar message ids are not treated as MessagePlan objects", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-durable-ack-"));
  const path = join(root, "runtime.sqlite");
  const store = new Store(path);
  try {
    store.transaction(() => {
      insertAlice(store);
      store.insertOperation({
        id: ACK_OP,
        actor: "alice",
        requestKey: "ack",
        requestHash: "hash",
        kind: "mail.ack",
        payloadJson: JSON.stringify({ message: ACK_MESSAGE }),
        planJson: JSON.stringify({
          kind: "mail.ack",
          recipient: "alice",
          message: ACK_MESSAGE,
        }),
      });
    });
    assert.equal(store.getOperation("alice", "ack")?.id, ACK_OP);
    assert.equal(store.getOperationById(ACK_OP as never)?.kind, "mail.ack");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("DB-009: parseable wrong result fails closed for every operation read", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-durable-result-"));
  const path = join(root, "runtime.sqlite");
  let store = seed(path);
  store.transaction(() => {
    store.setOperationSucceeded(
      OP as never,
      JSON.stringify({ kind: "route.follow", topic: "dev", subscribed: true }),
    );
  });
  store.close();
  const raw = new DatabaseSync(path);
  raw.prepare("UPDATE operations SET result_json=? WHERE id=?").run(
    JSON.stringify({ kind: "route.follow", topic: "dev", subscribed: true, extra: "corrupt" }),
    OP,
  );
  raw.close();
  store = new Store(path);
  try {
    assert.throws(
      () => store.getOperation("alice", "durable"),
      (error: unknown) =>
        error instanceof StoreError && error.code === "STORE_CORRUPT",
    );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("DB-009: create initial EML is an immutable object before acceptance", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-create-preaccept-"));
  const store = new Store(join(root, "runtime.sqlite"));
  const mail = new MailModule({ stateRoot: root, society: "demo" }, store, 8);
  const auth: AuthContext = {
    actor: "alice",
    incarnation: 0,
    role: "resident",
    channel: "actor",
    capabilities: new Set(["agent.create"]),
    peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), cgroup: null },
  };
  try {
    const message = await mail.freezeCreateInitial(
      auth,
      CREATE_OP,
      "bob",
      "frozen brief",
    );
    const object = mail.objectPath(message.id);
    assert.equal(existsSync(object), true);
    const bytes = readFileSync(object);
    assert.equal(bytes.length, message.bytes);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), message.sha256);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
