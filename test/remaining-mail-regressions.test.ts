import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MailModule } from "@oma/mail";
import { mailLedger } from "#oma-test/app/broker/mail-composition";
import { mailEffects } from "#oma-test/app/broker/mail-effects";
import { fixture, messages } from "./fixtures/review-fixture.js";
import { mailInboxArrivalPathAt } from "@oma/domain/paths";
import { AdmissionGate, bindAdmissionGate } from "@oma/domain/admission";
import type { MessagePlan } from "@oma/contracts";

for (const checkpoint of ["before-inbox", "after-arrival"] as const)
  test(`001. Fanout passes a failed first recipient and replays ${checkpoint} without duplicate arrivals`, async t => {
    const f = fixture({ workers: ["alice", "bob", "carol"] }); t.after(f.close);
    const paths = { stateRoot: f.root, society: "demo" }, effects = mailEffects(paths), ledger = mailLedger(f.store);
    let interrupted = true;
    const mail = new MailModule(paths, {
      ...ledger,
      transaction: body => ledger.transaction(tx => body({ ...tx, markMaterialized: (id, actor) => {
        if (interrupted && checkpoint === "after-arrival" && actor === "alice") throw Object.assign(new Error("injected SQL publication interruption"), { code: "EIO" });
        tx.markMaterialized(id, actor);
      } })),
    }, 64, { ...effects, openInbox: actor => {
      if (interrupted && checkpoint === "before-inbox" && actor === "alice") throw Object.assign(new Error("injected inbox unavailable"), { code: "EACCES" });
      return effects.openInbox(actor);
    } });
    const first = await mail.send(f.auth(), "fanout", { to: ["residents"], kind: "message", subject: "fanout", body: "accepted once" });
    assert.equal(first.state, "pending");
    const accepted = f.store.getOperation("alice", "fanout")!;
    assert.equal(accepted.kind, "mail.send");
    if (accepted.kind !== "mail.send") assert.fail("expected mail");
    const id = accepted.plan.message.id;
    assert.equal(f.store.getDelivery(id, "alice")!.materialized, 0);
    for (const actor of ["bob", "carol"]) assert.equal(f.store.getDelivery(id, actor)!.materialized, 1, "an unavailable earlier inbox cannot block later recipients");
    interrupted = false;
    assert.deepEqual(await mail.reconcilePending(), { examined: 1, repaired: 1, remaining: 0 });
    assert.equal(f.store.getOperation("alice", "fanout")!.planJson, accepted.planJson);
    for (const actor of ["alice", "bob", "carol"]) {
      const arrivals = readFileSync(mailInboxArrivalPathAt(f.root, actor), "utf8").split("\n").filter(line => line.endsWith(` ${id}`));
      assert.equal(arrivals.length, 1, `${actor}: physical append / SQL gap must not duplicate the arrival`);
    }
    assert.deepEqual(await mail.reconcilePending(), { examined: 0, repaired: 0, remaining: 0 });
  });

for (const recover of [false, true]) test(`002. Workers-only replies remain private through ${recover ? "recovery" : "ordinary publication"}`, async t => {
  const f = fixture({ workers: ["alice", "bob"] }); t.after(f.close);
  const candidate = f.candidateWith({ "file.txt": "candidate\n" });
  await f.submit("alice", candidate, "candidate");
  await f.open("alice", { tier: "HIGH", candidate }, "open");
  const parent = messages(f, "alice", "open").find(message => message.audience === "workers");
  assert.ok(parent, "positive control: a real review thread owns workers-only mail");
  const input = { to: [] as string[], kind: "message" as const, subject: "private reply", body: "worker-only detail", replyToMessage: parent.id };
  await assert.rejects(f.mail.send(f.auth("bob"), "widen", { ...input, to: ["principal"] }), { code: "CAPABILITY_DENIED" });
  await assert.rejects(f.mail.send(f.auth("principal"), "principal-reply", input), { code: "CAPABILITY_DENIED" });
  const effects = mailEffects({ stateRoot: f.root, society: "demo" });
  const sender = recover ? new MailModule({ stateRoot: f.root, society: "demo" }, mailLedger(f.store), 64,
    { ...effects, publishMailArchive: () => { throw new Error("injected archive interruption"); } }) : f.mail;
  const first = await sender.send(f.auth("bob"), "private-reply", input);
  assert.equal(first.state, recover ? "pending" : "succeeded");
  const accepted = f.store.getOperation("bob", "private-reply")!;
  assert.equal(accepted.kind, "mail.send");
  if (accepted.kind !== "mail.send") assert.fail("expected mail");
  assert.equal(accepted.plan.message.audience, "workers");
  assert.equal(accepted.plan.message.recipients.includes("principal"), false);
  if (recover) {
    f.reopen();
    assert.deepEqual(await f.mail.reconcilePending(), { examined: 1, repaired: 1, remaining: 0 });
    assert.equal(f.store.getOperation("bob", "private-reply")!.planJson, accepted.planJson);
  }
  const id = accepted.plan.message.id;
  assert.equal(existsSync(join(f.root, "mail/workers/cur", `${id}:2,`)), true);
  assert.equal(existsSync(join(f.root, "mail/archive/cur", `${id}:2,`)), false);
  assert.equal(f.store.getDelivery(id, "principal"), null);
  const result = f.store.getOperation("bob", "private-reply")!.result as { archivePath: string };
  assert.match(result.archivePath, /\/mail\/workers\/cur\//);
});

/** AUD-02: with `replyReferences = 1` the truncation kept the thread root and
 * evicted the immediate parent, so the ledger read a legal workers-only
 * reply-of-a-reply as a forged thread and fenced every later acceptance with
 * STORE_CORRUPT. A same-key retry was fine, but the process-wide gate stayed
 * closed until restart. The immediate parent must survive the one-slot bound;
 * with room for two, the root stays at the front and the parent at the end. */
test("003. Legal workers-only reply chains satisfy the ledger at the replyReferences boundary", async t => {
  const f = fixture({ workers: ["alice", "bob"] }); t.after(f.close);
  const candidate = f.candidateWith({ "file.txt": "candidate\n" });
  await f.submit("alice", candidate, "candidate");
  await f.open("alice", { tier: "HIGH", candidate }, "open");
  const parent = messages(f, "alice", "open").find(message => message.audience === "workers");
  assert.ok(parent, "positive control: a real review thread owns workers-only mail");
  const paths = { stateRoot: f.root, society: "demo" };
  const gate = new AdmissionGate();
  bindAdmissionGate(f.store, gate);
  const planOf = (actor: string, key: string): MessagePlan => {
    const operation = f.store.getOperation(actor, key)!;
    assert.equal(operation.kind, "mail.send");
    if (operation.kind !== "mail.send") assert.fail("expected mail");
    return operation.plan.message;
  };
  const reply = (module: MailModule, actor: string, key: string, toMessage: string) =>
    module.send(f.auth(actor), key, { to: [], kind: "message", subject: key, body: "worker-only detail", replyToMessage: toMessage });

  // Boundary 1: a reply's reply is a legal worker thread, not corruption.
  const oneSlot = new MailModule(paths, mailLedger(f.store), 1, mailEffects(paths));
  assert.equal((await reply(oneSlot, "bob", "boundary-1", parent.id)).state, "succeeded");
  const first = planOf("bob", "boundary-1");
  assert.equal(first.audience, "workers");
  assert.deepEqual(first.replyHeaders.references, [`${parent.id}@demo.oma.invalid`]);
  assert.equal((await reply(oneSlot, "alice", "boundary-2", first.id)).state, "succeeded");
  const second = planOf("alice", "boundary-2");
  assert.equal(second.audience, "workers");
  assert.equal(second.replyHeaders.inReplyTo, `${first.id}@demo.oma.invalid`);
  assert.deepEqual(second.replyHeaders.references, [`${first.id}@demo.oma.invalid`],
    "the one-slot bound keeps the immediate parent, not a root that evicts it");
  assert.equal(second.recipients.includes("principal"), false);

  // Boundary 2: with room for two, the root and the immediate parent coexist.
  const twoSlots = new MailModule(paths, mailLedger(f.store), 2, mailEffects(paths));
  assert.equal((await reply(twoSlots, "bob", "root-1", parent.id)).state, "succeeded");
  const r1 = planOf("bob", "root-1");
  assert.equal((await reply(twoSlots, "alice", "root-2", r1.id)).state, "succeeded");
  const r2 = planOf("alice", "root-2");
  assert.deepEqual(r2.replyHeaders.references, [`${parent.id}@demo.oma.invalid`, `${r1.id}@demo.oma.invalid`]);
  assert.equal((await reply(twoSlots, "bob", "root-3", r2.id)).state, "succeeded");
  const r3 = planOf("bob", "root-3");
  assert.equal(r3.replyHeaders.inReplyTo, `${r2.id}@demo.oma.invalid`);
  assert.deepEqual(r3.replyHeaders.references, [`${parent.id}@demo.oma.invalid`, `${r2.id}@demo.oma.invalid`],
    "thread root stays first and the newest parent stays last");

  assert.equal(gate.state, "healthy", "a legal chain must not present as durable corruption");
  assert.equal((await reply(oneSlot, "alice", "after-chain", r2.id)).state, "succeeded",
    "later acceptance stays open after the chain");
});
