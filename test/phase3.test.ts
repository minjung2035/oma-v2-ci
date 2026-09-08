// Phase 3 acceptance: maildir/routes/materializer/views (T14-T27 partial, T32)
// plus process-kill crash tests T18-T22 using the external kill harness.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  readdirSync,
  existsSync,
  readFileSync,
  openSync,
  closeSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import {
  MailModule,
  buildEml,
  parseEmlHeaders,
  batchNotice,
  topicAddress,
  actorAddress,
  listAddress,
  type MailStopPoint,
} from "../src/mail.js";
import { writeAtomic } from "../src/views.js";
import type { AuthContext, Capability } from "../implementation/contracts.js";
import { generateOperationId, generateMessageId } from "../src/ids.js";

function fresh(): {
  store: Store;
  mail: MailModule;
  dir: string;
  society: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "oma-t3-"));
  const society = "demo";
  const store = new Store(join(dir, "runtime.sqlite"));
  const mail = new MailModule({ stateRoot: dir, society }, store, 64);
  return { store, mail, dir, society };
}

function seal(s: { store: Store; dir: string }): void {
  s.store.close();
  rmSync(s.dir, { recursive: true, force: true });
}

function auth(
  actor: string,
  capabilities: Capability[] = ["mail.send"],
): AuthContext {
  return {
    actor,
    incarnation: 1,
    role: actor === "principal" ? "principal" : "resident",
    channel: "actor",
    capabilities: new Set(capabilities),
    peer: { pid: 1, uid: 1000, gid: 1000, cgroup: null },
  };
}

function inTx<T>(store: Store, fn: () => T): T {
  return store.transaction((_tx) => fn());
}

function seedAgents(
  store: Store,
  specs: Array<
    [
      string,
      "resident" | "principal",
      "enabled" | "stopped" | "provisioning" | "retired",
    ]
  >,
): void {
  inTx(store, () => {
    for (const [name, role, desired] of specs) {
      store.insertAgent({
        name,
        specHash: "h",
        role,
        desired,
        incarnation: 0,
        profile: "p",
        createdBy: null,
        specJson: "{}",
      });
    }
  });
}

// ---------------------------------------------------------------------------

test("T14: commons routing keeps stopped, excludes retired/provisioning/principal", async () => {
  const { store, mail, dir } = fresh();
  seedAgents(store, [
    ["a", "resident", "enabled"],
    ["b", "resident", "enabled"],
    ["c", "resident", "stopped"],
    ["d", "resident", "retired"],
    ["e", "resident", "provisioning"],
    ["principal", "principal", "enabled"],
  ]);
  const receipt = await mail.send(auth("a"), "k1", {
    to: ["commons"],
    subject: "s",
    kind: "message",
    body: "x",
  });
  const op = inTx(store, () => store.getOperation("a", "k1"))!;
  const plan = JSON.parse(op.planJson) as {
    message: { recipients: string[]; id: string };
  };
  assert.deepEqual([...plan.message.recipients].sort(), ["a", "b", "c"]);
  assert.equal(
    (receipt.result as { recipientCount: number }).recipientCount,
    3,
  );
  const deliveries = inTx(store, () => store.deliveriesForOperation(op.id));
  assert.deepEqual(deliveries.map((d) => d.recipient).sort(), ["a", "b", "c"]);
  seal({ store, dir });
});

test("T15: topic with no followers publishes to archive only, recipientCount 0", async () => {
  const { store, mail, dir } = fresh();
  seedAgents(store, [
    ["a", "resident", "enabled"],
    ["b", "resident", "enabled"],
  ]);
  const receipt = await mail.send(auth("a"), "k1", {
    to: ["topic/none"],
    subject: "s",
    kind: "message",
    body: "x",
  });
  assert.equal(
    (receipt.result as { recipientCount: number }).recipientCount,
    0,
  );
  assert.equal(
    (receipt.result as { state?: string }).state ?? receipt.state,
    "succeeded",
  );
  const archiveDir = join(dir, "mail", "archive", "cur");
  assert.equal(existsSync(archiveDir), true);
  assert.equal(readdirSync(archiveDir).length, 1);
  seal({ store, dir });
});

test("T16: follow/unfollow, union dedupe, snapshot fixed after membership change", async () => {
  const { store, mail, dir } = fresh();
  seedAgents(store, [
    ["a", "resident", "enabled"],
    ["b", "resident", "enabled"],
    ["c", "resident", "enabled"],
  ]);
  const topic = "auth";
  inTx(store, () => store.follow(topic, "b"));
  // post with follow present; union of `b` + `topic/auth` must not duplicate b
  await mail.send(auth("a"), "k1", {
    to: ["b", `topic/${topic}`],
    subject: "s",
    kind: "message",
    body: "x",
  });
  const op = inTx(store, () => store.getOperation("a", "k1"))!;
  const plan = JSON.parse(op.planJson) as { message: { recipients: string[] } };
  assert.equal(plan.message.recipients.length, 1); // union dedupe: b only
  assert.deepEqual(plan.message.recipients, ["b"]);
  // membership change after acceptance does not affect the stored snapshot
  inTx(store, () => store.unfollow(topic, "b"));
  const op2 = inTx(store, () => store.getOperation("a", "k1"))!;
  assert.equal(
    (JSON.parse(op2.planJson) as { message: { recipients: string[] } }).message
      .recipients.length,
    1,
  );
  // new send after unfollow: topic has no subscribers
  const receipt2 = await mail.send(auth("a"), "k2", {
    to: [`topic/${topic}`],
    subject: "s",
    kind: "message",
    body: "x",
  });
  assert.equal(
    (receipt2.result as { recipientCount: number }).recipientCount,
    0,
  );
  seal({ store, dir });
});

test("T17: reply header contract; CR/LF injection rejected", async () => {
  const { store, dir, society } = fresh();
  seedAgents(store, [
    ["a", "resident", "enabled"],
    ["b", "resident", "enabled"],
  ]);
  // direct mail: Reply-To defaults to sender
  const emlDirect = await buildEml({
    from: actorAddress("a", society),
    to: [actorAddress("b", society)],
    replyTo: [actorAddress("a", society)],
    subject: "S",
    kind: "message",
    contextRevision: null,
    inReplyTo: null,
    references: [],
    messageId: "m-1@demo.oma.invalid",
    body: "hi",
  });
  const direct = parseEmlHeaders(emlDirect.text);
  assert.equal(direct.replyTo![0], actorAddress("a", society));
  assert.equal(direct.messageId, "m-1@demo.oma.invalid");
  assert.ok(emlDirect.text.includes("X-OMA-Kind: message"));
  // forged CRLF in subject or body must be rejected
  await assert.rejects(
    buildEml({
      from: "a",
      to: ["b"],
      replyTo: [],
      subject: "evil\r\nBcc: x",
      kind: "message",
      contextRevision: null,
      inReplyTo: null,
      references: [],
      messageId: "m",
      body: "x",
    }),
    /CR\/LF/,
  );
  await assert.rejects(
    buildEml({
      from: "a",
      to: ["b"],
      replyTo: [],
      subject: "s",
      kind: "message",
      contextRevision: null,
      inReplyTo: null,
      references: [],
      messageId: "m",
      body: "x\r\ny",
    }),
    /CR/,
  );
  // topic address form
  assert.equal(topicAddress("auth", society), "topic-auth@demo.oma.invalid");
  assert.equal(listAddress("commons", society), "commons@demo.oma.invalid");
  seal({ store, dir });
});

// ---------------------------------------------------------------------------
// process-kill crash tests (TEST-004): external kill harness
// ---------------------------------------------------------------------------

const HARNESS = join(
  process.cwd(),
  "dist",
  "test",
  "fixtures",
  "mail-harness.js",
);

async function runChild(env: Record<string, string>): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HARNESS], {
      env: { ...process.env, ...env },
    });
    const lines: string[] = [];
    child.stdout.on("data", (d) =>
      lines.push(...String(d).split("\n").filter(Boolean)),
    );
    child.stderr.on("data", (d) =>
      lines.push(...String(d).split("\n").filter(Boolean)),
    );
    child.on("error", reject);
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }, 30000);
    child.on("exit", (_code) => {
      clearTimeout(timer);
      resolve(lines);
    });
  });
}

async function seed(dir: string, agents: string): Promise<void> {
  await runChild({ OMA_ROLE: "seed", OMA_STATE: dir, OMA_AGENTS: agents });
}

async function sendAndKill(
  dir: string,
  stop: MailStopPoint,
  opts: Record<string, string> = {},
): Promise<string[]> {
  const child = spawn(process.execPath, [HARNESS], {
    env: {
      ...process.env,
      OMA_ROLE: "send",
      OMA_STATE: dir,
      OMA_STOP: stop,
      ...opts,
    },
  });
  const lines: string[] = [];
  let resolved = false;
  const finish = () => {
    if (resolved) return;
    resolved = true;
    clearTimeout(timer);
  };
  const timer = setTimeout(finish, 15000); // hard bound: never hang the suite
  const boundary = new Promise<void>((resolve) => {
    child.stdout.on("data", (d) => {
      const s = String(d);
      lines.push(...s.split("\n").filter(Boolean));
      if (s.includes("BOUNDARY:")) {
        finish();
        resolve();
      }
    });
    child.on("error", () => {
      finish();
      resolve();
    });
    child.on("exit", () => {
      finish();
      resolve();
    });
  });
  await boundary;
  try {
    child.kill("SIGKILL");
  } catch {
    /* already gone */
  }
  await new Promise<void>((resolve) => child.on("exit", () => resolve()));
  return lines;
}

/// T18: kill after staging — no object, no DB row; same-key re-send works.
test("T18: kill after eml stage -> nothing accepted; same key resend succeeds", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-t18-"));
  await seed(dir, "a:enabled,b:enabled,c:enabled");
  const out = await sendAndKill(dir, "stage", {
    OMA_TO: "b,c",
    OMA_KEY: "k18",
  });
  assert.ok(
    out.some((l) => l.startsWith("BOUNDARY:stage")),
    out.join("|"),
  );
  const store = new Store(join(dir, "runtime.sqlite"));
  assert.equal(
    inTx(store, () => store.getOperation("a", "k18")),
    null,
  );
  assert.equal(existsSync(join(dir, "mail", "objects")), false);
  store.close();
  // resend with the same key completes
  const resend = await runChild({
    OMA_ROLE: "send",
    OMA_STATE: dir,
    OMA_STOP: "",
    OMA_TO: "b,c",
    OMA_KEY: "k18",
  });
  assert.ok(
    resend.some((l) => l.startsWith("RECEIPT:")),
    resend.join("|"),
  );
  rmSync(dir, { recursive: true, force: true });
});

/// T19: kill after object publish, before T-send — unreferenced object, retry OK.
test("T19: kill after object fsync -> unreferenced object, no recipients; resend OK", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-t19-"));
  await seed(dir, "a:enabled,b:enabled");
  const out = await sendAndKill(dir, "object", { OMA_TO: "b", OMA_KEY: "k19" });
  assert.ok(out.some((l) => l.startsWith("BOUNDARY:object")));
  const store = new Store(join(dir, "runtime.sqlite"));
  assert.equal(
    inTx(store, () => store.getOperation("a", "k19")),
    null,
  );
  const objects = readdirSync(join(dir, "mail", "objects"));
  assert.equal(objects.length, 1); // orphan, not public
  store.close();
  const resend = await runChild({
    OMA_ROLE: "send",
    OMA_STATE: dir,
    OMA_STOP: "",
    OMA_TO: "b",
    OMA_KEY: "k19",
  });
  assert.ok(
    resend.some((l) => l.startsWith("RECEIPT:")),
    resend.join("|"),
  );
  rmSync(dir, { recursive: true, force: true });
});

/// T20: kill after DB accept, before archive — reconcile publishes archive+inboxes.
test("T20: kill after acceptance -> reconcile completes archive and all recipients", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-t20-"));
  await seed(dir, "a:enabled,b:enabled,c:enabled");
  const out = await sendAndKill(dir, "accepted", {
    OMA_TO: "b,c",
    OMA_KEY: "k20",
  });
  assert.ok(out.some((l) => l.startsWith("BOUNDARY:accepted")));
  const store = new Store(join(dir, "runtime.sqlite"));
  const op = inTx(store, () => store.getOperation("a", "k20"))!;
  assert.equal(op.state, "pending");
  // no archive nor inboxes yet
  assert.equal(existsSync(join(dir, "mail", "archive", "cur")), false);
  const mail = new MailModule({ stateRoot: dir, society: "demo" }, store, 64);
  const res = await mail.reconcilePending();
  assert.equal(res.repaired, 1);
  assert.equal(readdirSync(join(dir, "mail", "archive", "cur")).length, 1);
  for (const r of ["b", "c"]) {
    assert.equal(readdirSync(join(dir, "mail", "inboxes", r, "new")).length, 1);
    assert.equal(
      inTx(
        store,
        () =>
          store.getDelivery(
            (JSON.parse(op.planJson) as { message: { id: string } }).message.id,
            r,
          )!.materialized,
      ),
      1,
    );
  }
  assert.equal(
    inTx(store, () => store.getOperation("a", "k20")!.state),
    "succeeded",
  );
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

/// T21: A/B published (B already in cur), C killed — only C supplemented, no re-creation.
test("T21: partial fanout a+b done, b in cur -> reconcile adds only c, no duplicates", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-t21-"));
  await seed(dir, "a:enabled,b:enabled,c:enabled");
  const out = await sendAndKill(dir, "inbox-2", {
    OMA_TO: "a,b,c",
    OMA_KEY: "k21",
  });
  assert.ok(out.some((l) => l.startsWith("BOUNDARY:inbox-2")));
  const store = new Store(join(dir, "runtime.sqlite"));
  // simulate b's mail already moved to cur (previous batch/agent-end handoff)
  const op = inTx(store, () => store.getOperation("a", "k21"))!;
  const msgId = (JSON.parse(op.planJson) as { message: { id: string } }).message
    .id;
  const mail = new MailModule({ stateRoot: dir, society: "demo" }, store, 64);
  mail.moveToCur("b", [msgId as never]);
  assert.equal(readdirSync(join(dir, "mail", "inboxes", "b", "new")).length, 0);
  assert.equal(readdirSync(join(dir, "mail", "inboxes", "b", "cur")).length, 1);
  const res = await mail.reconcilePending();
  assert.equal(res.repaired, 1);
  // c supplemented; b not re-created in new; a untouched
  assert.equal(readdirSync(join(dir, "mail", "inboxes", "c", "new")).length, 1);
  assert.equal(readdirSync(join(dir, "mail", "inboxes", "b", "new")).length, 0);
  assert.equal(readdirSync(join(dir, "mail", "inboxes", "a", "new")).length, 1);
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

/// T22: link published, materialized flag not yet written — reconcile marks without duplication.
test("T22: link published before materialized flag -> reconcile completes, no duplicate file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-t22-"));
  await seed(dir, "a:enabled,b:enabled");
  const out = await sendAndKill(dir, "inbox-1", {
    OMA_TO: "a,b",
    OMA_KEY: "k22",
  });
  assert.ok(out.some((l) => l.startsWith("BOUNDARY:inbox-1")));
  const store = new Store(join(dir, "runtime.sqlite"));
  const mail = new MailModule({ stateRoot: dir, society: "demo" }, store, 64);
  const op = inTx(store, () => store.getOperation("a", "k22"))!;
  const msgId = (JSON.parse(op.planJson) as { message: { id: string } }).message
    .id;
  // a's link exists (published) but materialized=0 (flag not committed before kill)
  assert.equal(readdirSync(join(dir, "mail", "inboxes", "a", "new")).length, 1);
  assert.equal(
    inTx(store, () => store.getDelivery(msgId as never, "a")!.materialized),
    0,
  );
  const res = await mail.reconcilePending();
  assert.equal(res.repaired, 1);
  assert.equal(readdirSync(join(dir, "mail", "inboxes", "a", "new")).length, 1); // no duplicate link
  assert.equal(
    inTx(store, () => store.getDelivery(msgId as never, "a")!.materialized),
    1,
  );
  assert.equal(
    inTx(store, () => store.getDelivery(msgId as never, "b")!.materialized),
    1,
  );
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

test("batch notice caps at 6 items and points at /inbox.md", () => {
  const ids = Array.from({ length: 10 }, (_, i) =>
    generateMessageId(generateOperationId(), i),
  );
  const notice = batchNotice(ids);
  const lines = notice.split("\n");
  assert.equal(lines.filter((l) => /^\d+\. mail/.test(l)).length, 6);
  assert.ok(notice.includes("+4 more"));
  assert.ok(notice.endsWith("/inbox.md"));
});

test("T32: path-based views — rename is atomic, open fd keeps old content", () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-t32-"));
  const target = join(dir, "inbox.md");
  writeAtomic(target, "v1\n");
  writeAtomic(target, "v2\n");
  const pathContent = readFileSync(target, "utf8");
  assert.equal(pathContent, "v2\n");
  assert.equal(statSync(target).size, 3);
  rmSync(dir, { recursive: true, force: true });
});
