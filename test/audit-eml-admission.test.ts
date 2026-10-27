import test from "node:test";
import assert from "node:assert/strict";
import { createTransport } from "nodemailer";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEml } from "@oma/mail/serialize";
import { MAX_HEADER_LINE_BYTES, parseEmlHeaders } from "@oma/mail/headers";
import { Store } from "@oma/storage";
import { AdmissionGate, bindAdmissionGate } from "@oma/domain/admission";
import { StoreError } from "@oma/domain/errors";
import { exportRefForRequestKey } from "@oma/domain/derived";
import { PreparationExecutor } from "@oma/process/preparation";
import { sha256Hex } from "@oma/domain/canonical-json";
import {
  gitAuth,
  gitCommand,
  gitFixture,
  seedGit,
  contextFixture,
} from "./fixtures/git-crash.js";
import { makeValidAgent } from "./fixtures/spec.js";
import { removeTree } from "./fixtures/cleanup.js";

function decodedSubject(text: string): string {
  const subject = parseEmlHeaders(text, {
    maxHeaderBytes: Buffer.byteLength(text),
  })
    .subject!.replace(/\n/g, " ")
    .trim();
  if (!subject.startsWith("=?UTF-8?B?")) return subject;
  const words = [...subject.matchAll(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/g)];
  assert.ok(words.length > 1);
  assert.equal(
    subject.replace(/=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/g, "").trim(),
    "",
  );
  return Buffer.concat(
    words.map((word) => Buffer.from(word[1]!, "base64")),
  ).toString("utf8");
}
for (const subject of [
  "a".repeat(989),
  "a".repeat(990),
  "a".repeat(1200),
  "a".repeat(8192),
  "한😀 spaced  ".repeat(300),
]) {
  test(`EML admission: ${Buffer.byteLength(subject)} subject bytes preserve value within RFC lines`, async () => {
    const eml = await buildEml({
      from: "a@crash.oma.invalid",
      to: ["b@crash.oma.invalid"],
      replyTo: ["a@crash.oma.invalid"],
      subject,
      body: "body",
      kind: "result",
      contextRevision: null,
      inReplyTo: null,
      references: [],
      messageId: "m-00000000-0000-4000-8000-000000000001-0@crash.oma.invalid",
    });
    for (const line of eml.text.split("\r\n\r\n")[0]!.split("\r\n"))
      assert.ok(Buffer.byteLength(line) <= MAX_HEADER_LINE_BYTES);
    assert.equal(decodedSubject(eml.text), subject);
  });
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "oma-eml-admission-"));
  const store = new Store(join(root, "runtime.sqlite"));
  store.transaction((tx) => {
    tx.insertAgent(makeValidAgent("a"));
    tx.insertAgent(makeValidAgent("b"));
  });
  seedGit(root);
  const { git, mail, paths } = gitFixture(root, store);
  const gate = new AdmissionGate();
  bindAdmissionGate(store, gate);
  const candidate = gitCommand(root, [
    "--git-dir",
    paths.projectGit,
    "rev-parse",
    "refs/heads/main",
  ]);
  const submit = (key: string, subject: string) =>
    git.submit(
      gitAuth,
      key,
      {
        candidate,
        exportRef: exportRefForRequestKey(key),
        prerequisites: [],
        to: ["b"],
        subject,
        body: "body",
        paths: [],
      },
      (async function* () {})(),
    );
  return {
    root,
    store,
    git,
    mail,
    paths,
    gate,
    submit,
    close() {
      store.close();
      removeTree(root);
    },
  };
}

test("EML admission: long submit mail stays recoverable and does not fence later admission", async () => {
  const f = fixture();
  try {
    const publish = f.mail.publishGated.bind(f.mail);
    f.mail.publishGated = async () => {
      throw new StoreError(
        "BROKER_UNAVAILABLE",
        "controlled publication pause",
      );
    };
    await assert.rejects(f.submit("long-subject", "a".repeat(8192)), {
      code: "BROKER_UNAVAILABLE",
    });
    const operation = f.store.getOperation("a", "long-subject")!;
    assert.ok(operation.state === "pending" || operation.state === "unknown");
    assert.equal(operation.kind, "git.submit");
    if (operation.kind !== "git.submit") throw new Error("wrong fixture kind");
    const original = readFileSync(f.mail.objectPath(operation.plan.message.id));
    f.mail.publishGated = publish;
    await f.git.reconcile(operation.id);
    assert.equal(f.store.getOperationById(operation.id)?.state, "succeeded");
    assert.equal(
      f.store.getOperationById(operation.id)?.planJson,
      operation.planJson,
    );
    assert.deepEqual(
      readFileSync(f.mail.objectPath(operation.plan.message.id)),
      original,
    );
    assert.equal(decodedSubject(original.toString("utf8")), "a".repeat(8192));
    f.gate.assertAdmission();
    assert.equal(f.gate.state, "healthy");
    const next = await f.mail.send(gitAuth, "next-mail", {
      to: ["b"],
      kind: "message",
      subject: "b".repeat(8192),
      body: "ordinary mail",
    });
    assert.equal(next.state, "succeeded");
  } finally {
    f.close();
  }
});

test("EML admission: unsupported MIME output is rejected before submit/context/mail acceptance", async (t) => {
  const f = fixture();
  try {
    // Controlled dependency fault, not a live broker or malformed-request attack.
    t.mock.method(
      Object.getPrototypeOf(createTransport({ jsonTransport: true })),
      "sendMail",
      async () => ({
        message: Buffer.from("X-Unsupported-Fixture: unsupported\r\n\r\nbody"),
      }),
    );
    let freezes = 0;
    t.mock.method(f.mail, "freezeObject", () => {
      freezes++;
    });
    await assert.rejects(f.submit("invalid-submit", "ordinary subject"), {
      code: "INVALID_REQUEST",
    });
    await assert.rejects(contextFixture(f.git), { code: "INVALID_REQUEST" });
    await assert.rejects(
      f.mail.send(gitAuth, "invalid-mail", {
        to: ["b"],
        kind: "message",
        subject: "ordinary",
        body: "body",
      }),
      { code: "INVALID_REQUEST" },
    );
    assert.equal(freezes, 0);
    assert.equal(f.store.getOperation("a", "invalid-submit"), null);
    assert.equal(f.store.getOperation("a", "git-crash"), null);
    assert.equal(f.store.getOperation("a", "invalid-mail"), null);
    assert.deepEqual(f.store.recoverableOperations(), []);
    assert.equal(
      gitCommand(f.root, [
        "--git-dir",
        f.paths.projectGit,
        "for-each-ref",
        "--format=%(refname)",
      ]),
      "refs/heads/main",
    );
    assert.equal(
      gitCommand(f.root, [
        "--git-dir",
        f.paths.contextGit,
        "for-each-ref",
        "--format=%(refname)",
      ]),
      "",
    );
    f.gate.assertAdmission();
    assert.equal(f.gate.state, "healthy");
  } finally {
    f.close();
  }
});

test("EML admission: context preparation disables autonomous maintenance before durable observation", async t => {
  const f = fixture();
  try {
    const trace = join(f.root, "git-trace.jsonl");
    const run = PreparationExecutor.prototype.run;
    t.mock.method(PreparationExecutor.prototype, "run", function(this: PreparationExecutor, ...args: Parameters<PreparationExecutor["run"]>) {
      const [spec, spawn, fds] = args;
      return run.call(this, { ...spec, env: { ...spec.env, GIT_TRACE2_EVENT: trace } }, spawn, fds);
    });
    assert.equal((await contextFixture(f.git)).state, "succeeded");
    const expected = gitCommand(f.root, ["--git-dir", f.paths.contextGit, "rev-parse", "refs/heads/main"]);
    const bytes = Buffer.from("# GOAL\nsecond context\n");
    const result = await f.git.publishContext(gitAuth, "context-next", { expected,
      entries: [{ path: "GOAL.md", bytes: bytes.length, sha256: sha256Hex(bytes) }],
      content: { bytes: bytes.length, sha256: sha256Hex(bytes), mediaType: "application/vnd.oma.context-v1" },
    }, (async function* () { yield bytes; })());
    assert.equal(result.state, "succeeded");
    const events = readFileSync(trace, "utf8").trim().split("\n").map(line => JSON.parse(line) as { event: string; argv?: string[] });
    assert.ok(events.some(event => event.event === "start" && event.argv?.includes("commit")), "native trace must observe the real commit");
    assert.ok(events.some(event => event.event === "start" && event.argv?.includes("fetch")), "native trace must observe the real fetch");
    assert.deepEqual(events.filter(event => event.event === "child_start" && event.argv?.some(arg => arg === "maintenance" || arg === "gc")), []);
  } finally { f.close(); }
});
