import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  actorAddress,
  buildEml,
  listAddress,
  MailModule,
  publishImmutableFile,
} from "../src/mail.js";
import { Store, StoreError } from "../src/store.js";
import { generateMessageId } from "../src/ids.js";
import { requestHash } from "../src/hash.js";
import { ALL_CAPS, resolvedSpec, storedSpec } from "./fixtures/spec.js";

const OP = "op-00000000-0000-4000-8000-000000000071";

async function acceptedMail(
  root: string,
  deliveredRecipients: readonly ("alice" | "bob")[],
): Promise<{ store: Store; mail: MailModule; messageId: string }> {
  const store = new Store(join(root, "runtime.sqlite"));
  const mail = new MailModule({ stateRoot: root, society: "demo" }, store, 8);
  const messageId = generateMessageId(OP as never, 0);
  const eml = await buildEml({
    from: actorAddress("alice", "demo"),
    to: [listAddress("residents", "demo")],
    replyTo: [listAddress("residents", "demo")],
    subject: "recovery integrity",
    kind: "message",
    contextRevision: null,
    inReplyTo: null,
    references: [],
    messageId: `${messageId}@demo.oma.invalid`,
    body: "body",
  });
  mail.freezeObject(messageId, eml);
  const payload = { to: ["residents"], subject: "recovery integrity", body: "body", kind: "message" };
  store.transaction(() => {
    for (const name of ["alice", "bob"] as const) {
      store.insertAgent({
        name,
        ...storedSpec(ALL_CAPS, "p", name),
        role: "resident",
        profile: "p",
        desired: "enabled",
        incarnation: 0,
        createdBy: null,
      });
    }
    store.insertOperation({
      id: OP,
      actor: "alice",
      requestKey: "mail-integrity",
      requestHash: requestHash("mail.send", payload),
      kind: "mail.send",
      payloadJson: JSON.stringify(payload),
      planJson: JSON.stringify({
        kind: "mail.send",
        message: {
          id: messageId,
          objectPath: `mail/objects/${messageId}.eml`,
          sha256: eml.sha256,
          bytes: eml.bytes,
          dateMs: eml.dateMs,
          to: ["residents"],
          recipients: ["alice", "bob"],
          kind: "message",
          contextRevision: null,
          replyHeaders: {
            replyTo: ["residents"],
            inReplyTo: null,
            references: [],
          },
        },
      }),
    });
    store.insertDeliveries(
      deliveredRecipients.map((recipient) => ({
        messageId,
        recipient,
        operationId: OP,
      })),
    );
  });
  return { store, mail, messageId };
}

test("DB-005/006: missing delivery from the accepted recipient snapshot fails closed", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-mail-delivery-set-"));
  const { store, mail } = await acceptedMail(root, ["alice"]);
  try {
    await assert.rejects(
      mail.materialize(OP),
      (error: unknown) => error instanceof StoreError && error.code === "STORE_CORRUPT",
    );
    // The delivery set is part of accepted evidence: the corrupt row stays
    // unreadable instead of reporting a plausible operation state.
    assert.throws(() => store.getOperationById(OP as never),
      (error: unknown) => error instanceof StoreError && error.code === "STORE_CORRUPT");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("REC-006/T69: accepted mail object corruption aborts reconcile instead of becoming remaining", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-mail-reconcile-corrupt-"));
  const { store, mail, messageId } = await acceptedMail(root, ["alice", "bob"]);
  try {
    const object = mail.objectPath(messageId as never);
    chmodSync(object, 0o600);
    writeFileSync(object, "corrupt", "utf8");
    chmodSync(object, 0o444);
    await assert.rejects(
      mail.reconcilePending(),
      (error: unknown) =>
        error instanceof StoreError && error.code === "STORE_CORRUPT",
    );
    assert.equal(store.getOperationById(OP as never)?.state, "pending");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("FS-005: immutable publication is read-only and freezeObject removes its staging alias", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-mail-mode-"));
  const src = join(root, "src");
  const dst = join(root, "dst");
  writeFileSync(src, "immutable", "utf8");
  publishImmutableFile(src, dst);
  try {
    assert.equal(readFileSync(dst, "utf8"), "immutable");
    assert.equal(statSync(dst).mode & 0o777, 0o444);

    const store = new Store(join(root, "runtime.sqlite"));
    const mail = new MailModule({ stateRoot: root, society: "demo" }, store, 8);
    try {
      const id = "m-00000000-0000-4000-8000-000000000072-0";
      mail.freezeObject(id as never, { text: "frozen" });
      assert.equal(statSync(mail.objectPath(id as never)).mode & 0o777, 0o444);
      assert.deepEqual(readdirSync(join(root, "staging", "mail-objects")), []);
    } finally {
      store.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
