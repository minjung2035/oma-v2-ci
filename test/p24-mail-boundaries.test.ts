import { createMailModule } from "#oma-test/app/broker/mail-composition";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import type { AuthContext } from "@oma/contracts";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import {
  StoreError,
  publicFailure,
  normalizeStorageFailure,
} from "@oma/domain/errors";
import { observeImmutableFile } from "@oma/storage/immutable-file";
import { HeldMailInbox } from "@oma/storage/mailbox";
import { makeValidAgent } from "./fixtures/spec.js";

function fixture() {
  const root = fs.mkdtempSync(join(tmpdir(), "oma-p24-mail-"));
  const store = new Store(join(root, "runtime.sqlite"));
  store.transaction((tx) => {
    tx.insertAgent(makeValidAgent("alice"));
    tx.insertAgent(makeValidAgent("bob"));
  });
  const mail = createMailModule(
    { stateRoot: root, society: "fixture" },
    store,
    64,
    24,
    { frameBytes: 262144, batchMaxMessages: 24 },
  );
  const auth: AuthContext = {
    actor: "alice",
    incarnation: 1,
    role: "resident",
    channel: "actor",
    capabilities: new Set(["mail.send"]),
    peer: { pid: process.pid, uid: 1000, gid: 1000 },
  };
  const input = {
    to: ["bob"],
    kind: "message" as const,
    subject: "fixture",
    body: "ordinary test message",
  };
  return {
    root,
    store,
    mail,
    auth,
    input,
    async pending(key = "pending") {
      const materialize = mail.materialize;
      mail.materialize = async () => {
        throw new StoreError("BROKER_UNAVAILABLE", "controlled outage");
      };
      try {
        assert.equal((await mail.send(auth, key, input)).state, "pending");
      } finally {
        mail.materialize = materialize;
      }
      const operation = store.getOperation("alice", key)!;
      if (operation.kind !== "mail.send") throw new Error("wrong fixture kind");
      return operation;
    },
    close() {
      store.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test("P03: immutable observation distinguishes present, absent, unavailable and corrupt", async (t) => {
  const f = fixture();
  try {
    const operation = await f.pending();
    const message = operation.plan.message;
    const path = f.mail.objectPath(message.id);
    const observe = () =>
      observeImmutableFile(path, message.sha256, message.bytes);
    assert.equal(observe().kind, "present");
    const original = fs.fstatSync;
    const mock = t.mock.method(fs, "fstatSync", ((
      ...args: Parameters<typeof fs.fstatSync>
    ) => {
      if (fs.readlinkSync(`/proc/self/fd/${args[0]}`) === path)
        throw Object.assign(new Error("observer denied"), { code: "EACCES" });
      return Reflect.apply(original, fs, args);
    }) as typeof fs.fstatSync);
    syncBuiltinESMExports();
    try {
      assert.equal(observe().kind, "unavailable");
    } finally {
      mock.mock.restore();
      syncBuiltinESMExports();
    }
    fs.chmodSync(path, 0o600);
    fs.writeFileSync(path, "invalid");
    assert.equal(observe().kind, "corrupt");
    fs.unlinkSync(path);
    assert.equal(observe().kind, "absent");
    await assert.rejects(f.mail.reconcilePending(), { code: "STORE_CORRUPT" });
    assert.equal(f.store.getOperationById(operation.id)?.state, "pending");
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    f.close();
  }
});

test("P03: unavailable recovery retains reason and pending evidence, then converges", async (t) => {
  const f = fixture();
  try {
    const operation = await f.pending();
    const object = f.mail.objectPath(operation.plan.message.id);
    const original = fs.fstatSync;
    const mock = t.mock.method(fs, "fstatSync", ((
      ...args: Parameters<typeof fs.fstatSync>
    ) => {
      if (fs.readlinkSync(`/proc/self/fd/${args[0]}`) === object)
        throw Object.assign(new Error("temporary I/O outage"), { code: "EIO" });
      return Reflect.apply(original, fs, args);
    }) as typeof fs.fstatSync);
    const diagnostics = t.mock.method(console, "error", () => undefined);
    syncBuiltinESMExports();
    try {
      assert.deepEqual(await f.mail.reconcilePending(), {
        examined: 1,
        repaired: 0,
        remaining: 1,
      });
      assert.equal(f.store.getOperationById(operation.id)?.state, "pending");
      assert.deepEqual(
        JSON.parse(diagnostics.mock.calls[0]!.arguments[0] as string),
        {
          event: "reconcile.mail",
          operation: operation.id,
          code: "BROKER_UNAVAILABLE",
        },
      );
    } finally {
      mock.mock.restore();
      syncBuiltinESMExports();
    }
    assert.deepEqual(await f.mail.reconcilePending(), {
      examined: 1,
      repaired: 1,
      remaining: 0,
    });
    assert.equal(
      f.store.getOperationById(operation.id)?.planJson,
      operation.planJson,
    );
    assert.deepEqual(await f.mail.reconcilePending(), {
      examined: 0,
      repaired: 0,
      remaining: 0,
    });
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    f.close();
  }
});

test("P04: first cur parent flush precedes removing new; a flush fault preserves prepared recovery", async (t) => {
  const f = fixture();
  try {
    const receipt = await f.mail.send(f.auth, "handoff", f.input);
    const operation = f.store.getOperation("alice", "handoff")!;
    assert.equal(receipt.state, "succeeded");
    if (operation.kind !== "mail.send") throw new Error("wrong fixture kind");
    const id = operation.plan.message.id;
    const from = f.mail.inboxNewPath("bob", id);
    const to = f.mail.inboxCurPath("bob", id);
    const mailbox = dirname(dirname(to));
    // The held mailbox now creates both folders during delivery. Establish
    // this test's first-cur condition explicitly, without removing any mail.
    assert.deepEqual(fs.readdirSync(dirname(to)), []);
    fs.rmdirSync(dirname(to));
    assert.equal(fs.existsSync(dirname(to)), false);
    const bob = { ...f.auth, actor: "bob" };
    const events: string[] = [];
    let fail = true;
    const sync = fs.fsyncSync;
    const move = HeldMailInbox.prototype.moveNewToCur;
    t.mock.method(fs, "fsyncSync", (fd: number) => {
      const path = fs.readlinkSync(`/proc/self/fd/${fd}`);
      if (path === mailbox && fail) {
        fail = false;
        throw Object.assign(new Error("parent flush unavailable"), {
          code: "EIO",
        });
      }
      sync(fd);
      events.push(`fsync:${path}`);
    });
    t.mock.method(
      HeldMailInbox.prototype,
      "moveNewToCur",
      function(this: HeldMailInbox, message: Parameters<typeof move>[0]) {
        move.call(this, message);
        events.push(`rename:${to}`);
      },
    );
    syncBuiltinESMExports();
    await assert.rejects(f.mail.prepare(bob), { code: "EIO" });
    assert.equal(f.store.preparedBatches("bob").length, 1);
    assert.equal(fs.existsSync(from), true);
    assert.equal(fs.existsSync(to), false);
    events.length = 0;
    const batch = await f.mail.prepare(bob);
    assert.deepEqual(batch?.messageIds, [id]);
    assert.ok(events.indexOf(`fsync:${mailbox}`) >= 0);
    assert.ok(
      events.indexOf(`fsync:${mailbox}`) < events.indexOf(`rename:${to}`),
    );
    assert.equal(fs.existsSync(from), false);
    assert.equal(fs.existsSync(to), true);
    assert.equal(f.store.getDelivery(id, "bob")?.presented, 0);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    f.close();
  }
});

test("P06: successful and concurrent sends leave no per-request directory or staging alias", async () => {
  const f = fixture();
  try {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        f.mail.send(f.auth, `send-${i}`, f.input),
      ),
    );
    assert.ok(results.every((result) => result.state === "succeeded"));
    await Promise.all([
      f.mail.send(f.auth, "same", f.input),
      f.mail.send(f.auth, "same", f.input),
    ]);
    assert.deepEqual(fs.readdirSync(join(f.root, "staging")), ["mail-objects"]);
    assert.deepEqual(fs.readdirSync(join(f.root, "staging/mail-objects")), []);
    // A concurrent loser published its object before acceptance; the object
    // directory must hold exactly the objects the accepted ledger names.
    const named = ["send-0", "send-1", "send-2", "send-3", "send-4", "same"]
      .map((key) => {
        const operation = f.store.getOperation("alice", key)!;
        if (operation.kind !== "mail.send") throw new Error("wrong fixture kind");
        return `${operation.plan.message.id}.eml`;
      })
      .sort();
    assert.equal(new Set(named).size, 6);
    assert.deepEqual(
      fs.readdirSync(join(f.root, "mail/objects")).sort(),
      named,
    );
  } finally {
    f.close();
  }
});

test("P01: native storage exhaustion has STORAGE_FULL vocabulary, never a terminal accepted failure", async (t) => {
  for (const error of [
    { code: "ENOSPC" },
    { code: "EDQUOT" },
    { code: "SQLITE_FULL" },
    { code: "ERR_SQLITE_ERROR", errcode: 13 },
    new AggregateError(
      [{ code: "ENOSPC" }, { code: "EIO" }],
      "write and cleanup failed",
    ),
  ]) {
    assert.equal(publicFailure(error).code, "STORAGE_FULL");
    assert.equal((normalizeStorageFailure(error) as Error).cause, error);
  }
  assert.equal(
    publicFailure({ code: "ERR_SQLITE_ERROR", errcode: 1 }).code,
    "INTERNAL_ERROR",
  );
  assert.equal(
    publicFailure(
      new AggregateError([
        new StoreError("STORE_CORRUPT", "primary integrity failure"),
        { code: "ENOSPC" },
      ]),
    ).code,
    "STORE_CORRUPT",
  );
  const f = fixture();
  try {
    const operation = await f.pending();
    const sync = fs.fsyncSync;
    t.mock.method(fs, "fsyncSync", (fd: number) => {
      if (fs.readlinkSync(`/proc/self/fd/${fd}`).includes("/mail/archive/"))
        throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
      sync(fd);
    });
    const diagnostics = t.mock.method(console, "error", () => undefined);
    syncBuiltinESMExports();
    assert.deepEqual(await f.mail.reconcilePending(), {
      examined: 1,
      repaired: 0,
      remaining: 1,
    });
    assert.equal(
      JSON.parse(diagnostics.mock.calls[0]!.arguments[0] as string).code,
      "STORAGE_FULL",
    );
    assert.equal(f.store.getOperationById(operation.id)?.state, "pending");
    assert.equal(
      f.store.getOperationById(operation.id)?.planJson,
      operation.planJson,
    );
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    f.close();
  }
});

test("P01: staging exhaustion plus cleanup flush failure remains preaccept STORAGE_FULL", async (t) => {
  const f = fixture();
  try {
    const sync = fs.fsyncSync;
    const stage = join(f.root, "staging/mail-objects");
    t.mock.method(fs, "fsyncSync", (fd: number) => {
      const path = fs.readlinkSync(`/proc/self/fd/${fd}`);
      if (path === stage || path.startsWith(stage + "/"))
        throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
      sync(fd);
    });
    syncBuiltinESMExports();
    await assert.rejects(
      f.mail.send(f.auth, "preaccept-full", f.input),
      (error) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(publicFailure(error).code, "STORAGE_FULL");
        return true;
      },
    );
    assert.equal(f.store.getOperation("alice", "preaccept-full"), null);
    assert.deepEqual(fs.readdirSync(stage), []);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    f.close();
  }
});
