import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createTransport } from "nodemailer";
import { encodeWord } from "nodemailer/lib/mime-funcs";
import { freezeMessageFacts, messagePlanFrom, defaultLogicalReplyTo } from "../src/mail/facts.js";
import { buildEml, renderFrozenMessage } from "../src/mail/serialize.js";
import { headerEnd, readableBody } from "../src/mail/display.js";
import { readableMail as extensionReadableMail } from "../src/extension/mail-tools.js";
import { decodeSubject, parseEmlHeaders } from "../src/mail/headers.js";
import { parseRfcMessageId, headerMessageIdCheck, exactCandidateCheck } from "../src/domain/mail-values.js";
import { parseMessageFileId } from "../src/domain/identifiers.js";
import { displayAddress, defaultReplyTo } from "../src/mail/addresses.js";
import { StoreError } from "../src/domain/errors.js";

const id = "m-11111111-1111-4111-8111-111111111111-0";
const first = "m-22222222-2222-4222-8222-222222222222-0@demo.oma.invalid";
const second = "m-33333333-3333-4333-8333-333333333333-0@demo.oma.invalid";
const dateMs = 946684800987;
const approvalFor = { repo: "project" as const, targetRef: "refs/heads/main" as const,
  expectedBase: "a".repeat(40), candidate: "b".repeat(40), policyRevision: "검토정책-1" };
const invalid = (error: unknown): boolean => error instanceof StoreError && error.code === "INVALID_REQUEST";

/** Independent pinned serializer fixture: the expected byte buffer does
 * not call buildEml, any facts builder, the parser, or the production hash code.
 */
async function pinnedBytes(subject: string, body: string): Promise<Buffer> {
  const transporter = createTransport({ streamTransport: true, buffer: true, newline: "\r\n" });
  const info = await transporter.sendMail({
    from: "alice@demo.oma.invalid", to: "principal@demo.oma.invalid",
    replyTo: "alice@demo.oma.invalid", text: { content: Buffer.from(body), contentTransferEncoding: "base64" },
    messageId: `<${id}@demo.oma.invalid>`, inReplyTo: `<${second}>`,
    references: [`<${first}>`, `<${second}>`], date: new Date(dateMs),
    headers: {
      Subject: { prepared: true, foldLines: true, value: encodeWord(subject, "B", 52) },
      "X-OMA-Kind": "approval_required",
      "X-OMA-Approval-Repo": "project", "X-OMA-Approval-Target": "refs/heads/main",
      "X-OMA-Approval-Base": "a".repeat(40), "X-OMA-Approval-Candidate": "b".repeat(40),
      "X-OMA-Approval-Policy": encodeWord("검토정책-1", "B"),
    },
  });
  const raw: unknown = (info as { message?: unknown }).message;
  assert.ok(Buffer.isBuffer(raw));
  return raw;
}

test("frozen logical facts produce byte-identical pinned MIME and one timestamp", async () => {
  const to = ["principal"];
  const references = [first, second];
  const tuple = { ...approvalFor };
  const facts = freezeMessageFacts({ id, sender: "alice", society: "demo", to,
    kind: "approval_required", contextRevision: null, dateMs, approvalFor: tuple,
    replyHeaders: { replyTo: ["alice"], inReplyTo: second, references } });
  to[0] = "mallory"; references.reverse(); tuple.policyRevision = "changed";
  assert.ok(Object.isFrozen(facts)); assert.ok(Object.isFrozen(facts.replyHeaders.references));
  assert.deepEqual(facts.to, ["principal"]); assert.deepEqual(facts.replyHeaders.references, [first, second]);
  const subject = "한글 제목 / frozen " .repeat(8);
  const body = "본문 UTF-8\nX-OMA-Kind: text in the body is not a header\n";
  const expected = await pinnedBytes(subject, body);
  const emitted = await renderFrozenMessage(facts, { subject, body });
  assert.deepEqual(Buffer.from(emitted.text, "utf8"), expected);
  assert.equal(emitted.sha256, createHash("sha256").update(expected).digest("hex"));
  assert.equal(emitted.bytes, expected.byteLength);
  assert.equal(emitted.dateMs, dateMs);
  assert.equal(emitted.headerFacts.dateMs, 946684800000);
  assert.equal(emitted.headerFacts.approvalFor?.policyRevision, "검토정책-1");
  const plan = messagePlanFrom(emitted, ["principal"]);
  assert.equal(plan.dateMs, dateMs);
  assert.equal(plan.sha256, emitted.sha256);
  assert.deepEqual(plan.to, ["principal"]);
  assert.deepEqual(plan.recipients, ["principal"]);
  assert.deepEqual(plan.replyHeaders.replyTo, ["alice"]);
  assert.equal(plan.objectPath, `mail/objects/${id}.eml`);
  assert.deepEqual(plan.replyHeaders.references, [first, second]);
});

test("logical and RFC reply selection share policy without sharing grammars", () => {
  assert.deepEqual(defaultLogicalReplyTo("alice", ["bob", "commons", "topic/work"]), ["commons", "topic/work"]);
  assert.deepEqual(defaultLogicalReplyTo("alice", ["bob"]), ["alice"]);
  assert.deepEqual(defaultReplyTo("alice@demo.oma.invalid", ["bob@demo.oma.invalid", "commons@demo.oma.invalid"]), ["commons@demo.oma.invalid"]);
  assert.equal(displayAddress("topic/work", "demo"), "topic-work@demo.oma.invalid");
  assert.equal(parseMessageFileId(first), null);
  assert.equal(parseRfcMessageId(first), first);
  assert.equal(parseRfcMessageId(id), null);
  assert.equal(headerMessageIdCheck(id), null); // retained accepted bare ancestry
  assert.equal(headerMessageIdCheck(first), null);
  assert.notEqual(exactCandidateCheck({ ...approvalFor, approved: true }), null);
});

const headerFixture = [
  "fRoM: alice@demo.oma.invalid", "tO: principal@demo.oma.invalid",
  "sUbJeCt: =?UTF-8?B?7KCc66qp?=", "\tcontinued",
  `mEsSaGe-Id: <${id}@demo.oma.invalid>`, `In-Reply-To: <${second}>`,
  `References: <${second}>`, ` <${first}> <${second}> <${id}>`,
  "Date: Sat, 01 Jan 2000 00:00:00 +0000", "X-OMA-Kind: message",
  "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8",
  "Content-Transfer-Encoding: 8bit",
].join("\r\n");

test("independent folded header fixture retains order duplicates and second precision", () => {
  const bytes = Buffer.concat([Buffer.from(`${headerFixture}\r\n\r\n`), Buffer.from([255, 0, 254])]);
  const result = parseEmlHeaders(bytes);
  assert.deepEqual(result.references, [second, first, second, id]);
  assert.equal(result.subject, "=?UTF-8?B?7KCc66qp?=\ncontinued");
  assert.equal(result.messageId, `${id}@demo.oma.invalid`);
  assert.equal(result.dateMs, 946684800000);
  assert.deepEqual(parseEmlHeaders(headerFixture.replace(/\r\n/g, "\n")), result);
});

test("parser rejects ambiguous fields unsupported MIME invalid tuples and bounds", () => {
  for (const damage of [
    `${headerFixture}\r\nMESSAGE-ID: <${first}>`,
    headerFixture.replace("alice@demo.oma.invalid", "alice@another@demo.oma.invalid"),
    headerFixture.replace("alice@demo.oma.invalid", "Alice <alice@demo.oma.invalid>"),
    headerFixture.replace("text/plain; charset=utf-8", "multipart/mixed; boundary=x"),
    headerFixture.replace("Sat, 01 Jan 2000", "Sun, 01 Jan 2000"),
    headerFixture.replace("X-OMA-Kind: message", "X-OMA-Kind: approval_required"),
    `${headerFixture}\r\nX-OMA-Approved: true`,
    `${headerFixture}\r\nX-OMA-Approval-Policy: p1`,
    " orphan fold", "Subject: bad\rcontrol", `Subject: ${"x".repeat(999)}`,
  ]) assert.throws(() => parseEmlHeaders(damage), invalid);
  assert.throws(() => parseEmlHeaders(headerFixture, { maxHeaderBytes: 20 }), invalid);
  assert.throws(() => parseEmlHeaders(Buffer.from([255])), invalid);
  assert.throws(() => freezeMessageFacts({ id, sender: "alice", society: "demo", to: ["principal"],
    kind: "approval_required", contextRevision: null,
    replyHeaders: { replyTo: ["alice"], inReplyTo: null, references: [] } }), invalid);
});


test("MAIL-003/DR27: fresh MIME preserves exact body and subject bytes in both readers", async () => {
  for (const body of ["", "plain", "plain\n", "a\nb\n", "\ufeffgoal", "Goal\r\nSecond\n", "한글\n", "a".repeat(4096)]) {
    for (const subject of ["Goal", "  Goal  ", "a  b", "a\tb", "=?UTF-8?B?Z29hbA==?=", "한글 ".repeat(5), "a".repeat(998)]) {
      const emitted = await buildEml({ from: "alice@demo.oma.invalid", to: ["bob@demo.oma.invalid"], replyTo: [],
        subject, body, kind: "message", contextRevision: null, inReplyTo: null, references: [], messageId: `${id}@demo.oma.invalid`, dateMs });
      assert.equal(readableBody(emitted.text), body);
      const shown = extensionReadableMail(emitted.text); const end = headerEnd(shown);
      assert.equal(shown.slice(end.at + end.length), body);
      assert.equal(decodeSubject(parseEmlHeaders(emitted.text).subject), subject);
      assert.equal(emitted.bytes, Buffer.byteLength(emitted.text));
    }
  }
});
