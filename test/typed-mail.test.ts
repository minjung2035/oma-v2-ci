import { test } from "node:test";
import assert from "node:assert/strict";
import { mailParamsCheck } from "@oma/domain/validation";
import { buildEml } from "@oma/mail";
import { requestHash } from "@oma/domain/request-identity";
import { execFileSync } from "node:child_process";

const approvalFor = {
  repo: "project" as const, targetRef: "refs/heads/main" as const,
  expectedBase: "a".repeat(40), candidate: "b".repeat(40), policyRevision: "policy-1",
};
const check = mailParamsCheck({
  frameBytes: 1048576, mailBodyBytes: 262144, subjectBytes: 1024,
  addresses: 32, replyReferences: 64, contextFiles: 128, contextBytes: 1048576,
  bundleBytes: 1048576,
});

test("MAIL-011: exact approval request is closed and hash-bound", () => {
  const mail = { to: ["principal"], subject: "review", kind: "approval_required", body: "question", approvalFor };
  assert.equal(check(mail), null);
  assert.equal(check({ ...mail, approvalFor: { ...approvalFor, policyRevision: "😀".repeat(32) } }), null);
  for (const policyRevision of ["😀".repeat(33), "한".repeat(43), "\ud800"])
    assert.notEqual(check({ ...mail, approvalFor: { ...approvalFor, policyRevision } }), null);
  assert.notEqual(check({ ...mail, toString: "unknown field" }), null);
  assert.notEqual(check({ ...mail, approvalFor: { ...approvalFor, expectedBase: "a".repeat(64) } }), null);
  assert.notEqual(check({ ...mail, approvalFor: undefined }), null);
  assert.notEqual(check({ ...mail, to: ["commons"] }), null);
  assert.notEqual(check({ ...mail, kind: "critical" }), null);
  assert.equal(check({ ...mail, kind: "critical", approvalFor: undefined }), null);
  for (const policyRevision of ["", "x\r\nInjected: yes", "x\u0000", "x".repeat(129)])
    assert.notEqual(check({ ...mail, approvalFor: { ...approvalFor, policyRevision } }), null);
  assert.notEqual(check({ ...mail, approvalFor: { ...approvalFor, extra: true } }), null);
  assert.notEqual(check({ ...mail, approvalFor: { ...approvalFor, candidate: "HEAD" } }), null);
  assert.notEqual(requestHash("mail.send", mail), requestHash("mail.send", {
    ...mail, approvalFor: { ...approvalFor, policyRevision: "policy-2" },
  }));
});

test("MAIL-003: approval identity is emitted as broker metadata", async () => {
  const identity = { ...approvalFor, policyRevision: " 정책-v1 " };
  const eml = await buildEml({
    from: "a@demo.oma.invalid", to: ["principal@demo.oma.invalid"], replyTo: [],
    subject: "review", body: "not an approval", kind: "approval_required",
    contextRevision: null, inReplyTo: null, references: [], messageId: "m-00000000-0000-4000-8000-000000000001-0@demo.oma.invalid",
    approvalFor: identity,
  });
  const decoded = JSON.parse(execFileSync("python3", ["-c",
    "import sys,json,email.policy; from email.parser import BytesParser; m=BytesParser(policy=email.policy.default).parsebytes(sys.stdin.buffer.read()); print(json.dumps({k.lower():str(v) for k,v in m.items()}))",
  ], { input: eml.text, encoding: "utf8" }));
  for (const [header, value] of Object.entries({
    Repo: approvalFor.repo, Target: approvalFor.targetRef, Base: approvalFor.expectedBase,
    Candidate: identity.candidate, Policy: identity.policyRevision,
  })) assert.equal(decoded[`x-oma-approval-${header.toLowerCase()}`], value);
});
