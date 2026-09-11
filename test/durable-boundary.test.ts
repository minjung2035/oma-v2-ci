import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MailModule } from "../src/mail.js";
import { Store, StoreError } from "../src/store.js";
import type { AuthContext } from "../implementation/contracts.js";
import { resolvedSpec, ALL_CAPS } from "./fixtures/spec.js";

const OP = "op-00000000-0000-4000-8000-000000000001";
const CREATE_OP = "op-00000000-0000-4000-8000-000000000002";
const ACK_OP = "op-00000000-0000-4000-8000-000000000003";
const ACK_MESSAGE = "m-00000000-0000-4000-8000-000000000004-0";

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

test("DB-009: scalar message ids are not treated as MessagePlan objects", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-durable-ack-"));
  const path = join(root, "runtime.sqlite");
  const store = new Store(path);
  try {
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
