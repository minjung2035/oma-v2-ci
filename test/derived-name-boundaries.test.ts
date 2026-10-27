// R03 boundary vectors, authored NOT_RUN. No live Git or kernel evidence claimed.
import test from "node:test";
import assert from "node:assert/strict";
import { isExportRef, isPublishedRef, isMailObjectRelativePath } from "@oma/domain/derived";
import { checkExportRef, operationResultCheck, messagePlanCheck } from "@oma/domain/validation";

const MESSAGE = "m-00000000-0000-4000-8000-000000000003-0";
const REF = "refs/oma/published/alice/op-00000000-0000-4000-8000-000000000003";

test("R03: old export refs remain readable without adopting the fresh CLI convention", () => {
  for (const ref of ["refs/oma/export/legacy", "refs/oma/export/cli-old-key", `refs/oma/export/${"a".repeat(96)}`]) {
    assert.equal(isExportRef(ref), true);
    assert.equal(checkExportRef(ref), null);
  }
  for (const ref of [null, "refs/oma/export/", `refs/oma/export/${"a".repeat(97)}`, "refs/oma/export/a/b", "refs/heads/main"]) {
    assert.equal(isExportRef(ref), false);
    assert.notEqual(checkExportRef(ref), null);
  }
});

test("R03: published-ref syntax requires the canonical actor and UUID-v4 operation", () => {
  const result = { kind: "git.submit", candidate: "1".repeat(40), publishedRef: REF, message: MESSAGE, recipientCount: 0 };
  assert.equal(isPublishedRef(REF), true);
  assert.equal(operationResultCheck("git.submit")(result), null);
  for (const ref of [
    "refs/oma/published/alice/op-00000000-0000-1000-8000-000000000003",
    "refs/oma/published/alice/op-00000000-0000-4000-7000-000000000003",
    "refs/oma/published/commons/op-00000000-0000-4000-8000-000000000003",
    "refs/oma/published/alice/op-00000000-0000-4000-8000-000000000003/extra",
  ]) {
    assert.equal(isPublishedRef(ref), false);
    assert.notEqual(operationResultCheck("git.submit")({ ...result, publishedRef: ref }), null);
  }
});

test("R03: mail object paths cannot launder a malformed internal MessageId", () => {
  const path = "mail/objects/m-00000000-0000-4000-8000-000000000003-0.eml";
  const plan = { id: MESSAGE, objectPath: path, sha256: "a".repeat(64), bytes: 1, dateMs: 0,
    to: ["alice"], recipients: ["alice"], kind: "message", contextRevision: null,
    replyHeaders: { replyTo: ["alice"], inReplyTo: null, references: [] } };
  assert.equal(isMailObjectRelativePath(path), true);
  assert.equal(messagePlanCheck(plan), null);
  for (const objectPath of [
    "mail/objects/m-deadbeef.eml",
    "mail/objects/m-00000000-0000-1000-8000-000000000003-0.eml",
    "mail/objects/m-00000000-0000-4000-8000-000000000003-9007199254740992.eml",
    "/mail/objects/m-00000000-0000-4000-8000-000000000003-0.eml",
  ]) {
    assert.equal(isMailObjectRelativePath(objectPath), false);
    assert.notEqual(messagePlanCheck({ ...plan, objectPath }), null);
  }
});
