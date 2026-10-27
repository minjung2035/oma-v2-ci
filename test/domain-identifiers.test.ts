// R03 independent oracles. Authored only: NOT_RUN; no broker/kernel E2E claim.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Receipt } from "@oma/contracts";
import {
  parseActor, parseResidentName, parseSocietyName, parseTopicName, parseRequestKey,
  parseOperationId, parseBatchId, parseMessageFileId, parseMessageId, parseFullOid, parseRepositoryRelativePath,
} from "@oma/domain/identifiers";
import {
  messageIdForOperation, publishedRefFor, exportRefForRequestKey, submitStagingFor,
  contextStagingFor, workspaceFor, batchViewFor, mailObjectRelativePath,
  mailArchiveRelativePath, mailInboxRelativePath, contextRevisionFor, contextRevisionLinkFor,
  actorSocketFor, residentUnitsFor, isMessageIdForOperation, isPublishedRefFor, isMailObjectRelativePathFor,
} from "@oma/domain/derived";
import {
  workspacePathAt, submitBundlePathAt, contextStagingPathAt, mailObjectPathAt, mailArchivePathAt,
  actorSocketPathAt, isWorkspacePathFor, isSubmitBundlePathFor, isContextStagingPathFor,
  isMailArchivePathFor, isActorSocketPathFor,
} from "@oma/domain/paths";
import { parseEmlHeaders } from "@oma/mail";
import { contextPathCheck } from "@oma/domain/validation";
import { operationPlanCheck } from "@oma/domain/durable";
import { readBatchView } from "@oma/tool-runtime/batch-view";
import { TEST_VIEW_LIMITS } from "./fixtures/limits.js";
import { RequestCache } from "#oma-test/app/request-cache";
import { runCliWithLookup } from "./fixtures/cli-lookup.js";

const OP = "op-00000000-0000-4000-8000-000000000003";
const OTHER_OP = "op-00000000-0000-4000-8000-000000000004";
const MESSAGE = "m-00000000-0000-4000-8000-000000000003-0";
const BATCH = "b-00000000-0000-4000-8000-000000000003";
const OID = "1111111111111111111111111111111111111111";
/** PI-002: the runner-supplied view limits, never an implicit unlimited read. */
const VIEW_LIMITS = TEST_VIEW_LIMITS;

test("R03: resident names and authenticated actor names are distinct contexts", () => {
  assert.equal(parseResidentName("alice"), "alice"); assert.equal(parseActor("alice"), "alice");
  assert.equal(parseActor("principal"), "principal"); assert.equal(parseResidentName("principal"), null);
  for (const name of ["commons", "residents", "topic", "broker", "principal-relay", "reconcile", "topic-dev", "Alice", "../alice", "a".repeat(33)]) {
    assert.equal(parseActor(name), null, name); assert.equal(parseResidentName(name), null, name);
  }
  assert.equal(parseSocietyName("principal"), "principal", "society grammar is not resident reservation policy");
  assert.equal(parseSocietyName("Demo"), null);
  assert.equal(parseTopicName("a".repeat(64)), "a".repeat(64)); assert.equal(parseTopicName("a".repeat(65)), null);
  assert.equal(parseRequestKey("K._-"), "K._-"); assert.equal(parseRequestKey("k".repeat(96)), "k".repeat(96));
  for (const key of ["", "k".repeat(97), "../key", "키", "a\0b", "a b"]) assert.equal(parseRequestKey(key), null);
});

test("R03: UUID version, variant, lowercase and safe ordinal grammar are preserved", () => {
  assert.equal(parseOperationId(OP), OP); assert.equal(parseBatchId(BATCH), BATCH);
  assert.equal(parseMessageFileId(MESSAGE), MESSAGE); assert.deepEqual(parseMessageId(MESSAGE), { operationId: OP, ordinal: 0 });
  for (const uuid of ["00000000-0000-1000-8000-000000000003", "00000000-0000-4000-7000-000000000003",
    "ABCDEF00-0000-4000-8000-000000000003", "00000000000040008000000000000003"]) {
    assert.equal(parseOperationId(`op-${uuid}`), null); assert.equal(parseBatchId(`b-${uuid}`), null);
    assert.equal(parseMessageFileId(`m-${uuid}-0`), null);
  }
  assert.equal(parseMessageFileId("m-00000000-0000-4000-8000-000000000003-9007199254740991"), "m-00000000-0000-4000-8000-000000000003-9007199254740991");
  assert.equal(parseMessageFileId("m-00000000-0000-4000-8000-000000000003-9007199254740992"), null);
  assert.equal(parseMessageFileId("m-00000000-0000-4000-8000-000000000003-00"), "m-00000000-0000-4000-8000-000000000003-00");
  assert.equal(parseFullOid(OID), OID); assert.equal(parseFullOid("a".repeat(64)), "a".repeat(64));
  for (const oid of ["HEAD", "a".repeat(39), "a".repeat(41), "A".repeat(40)]) assert.equal(parseFullOid(oid), null);
});

test("R03: internal IDs, RFC ancestry and context paths do not share a grammar", () => {
  // MAIL-005: only the supported OMA header identity is accepted; the qualified
  // header form is still not the internal MessageId grammar.
  const headers = parseEmlHeaders(`Message-ID: <${MESSAGE}@demo.oma.invalid>\r\nReferences: <${MESSAGE}@demo.oma.invalid> <m-00000000-0000-4000-8000-000000000004-0@demo.oma.invalid>\r\n\r\nbody`);
  assert.equal(headers.messageId, `${MESSAGE}@demo.oma.invalid`);
  assert.deepEqual(headers.references, [`${MESSAGE}@demo.oma.invalid`, "m-00000000-0000-4000-8000-000000000004-0@demo.oma.invalid"]);
  assert.equal(parseMessageFileId(headers.messageId), null);
  // A foreign RFC identity is not OMA ancestry and is rejected, not silently kept.
  assert.throws(() => parseEmlHeaders("Message-ID: <external@example.invalid>\r\n\r\nbody"),
    (error: unknown) => (error as { code?: string }).code === "INVALID_REQUEST");
  assert.throws(() => parseEmlHeaders("References: <root@elsewhere.invalid>\r\n\r\nbody"),
    (error: unknown) => (error as { code?: string }).code === "INVALID_REQUEST");
  assert.equal(parseRepositoryRelativePath("apps/oma/src/file.ts"), "apps/oma/src/file.ts");
  assert.notEqual(contextPathCheck("apps/oma/src/file.ts"), null); assert.equal(contextPathCheck("GOAL.md"), null);
  for (const path of ["", "/GOAL.md", "../GOAL.md", "a/../GOAL.md", "a//b", "a/./b", "a\0b"]) assert.equal(parseRepositoryRelativePath(path), null);
});

test("R03: constructors retain literal legacy layout, with bounded fresh export refs", () => {
  assert.equal(messageIdForOperation(OP, 0), MESSAGE);
  assert.equal(publishedRefFor("alice", OP), "refs/oma/published/alice/op-00000000-0000-4000-8000-000000000003");
  assert.equal(submitStagingFor(OP), "staging/submit-op-00000000-0000-4000-8000-000000000003");
  assert.equal(contextStagingFor(OP), "staging/context-op-00000000-0000-4000-8000-000000000003");
  assert.equal(workspaceFor("alice"), "agents/alice/workspace");
  assert.equal(batchViewFor("alice", BATCH), "agents/alice/runner/view/batch-b-00000000-0000-4000-8000-000000000003.json");
  assert.equal(mailObjectRelativePath(MESSAGE), "mail/objects/m-00000000-0000-4000-8000-000000000003-0.eml");
  assert.equal(mailArchiveRelativePath(MESSAGE), "mail/archive/cur/m-00000000-0000-4000-8000-000000000003-0:2,");
  assert.equal(mailInboxRelativePath("alice", MESSAGE, "new"), "mail/inboxes/alice/new/m-00000000-0000-4000-8000-000000000003-0");
  assert.equal(mailInboxRelativePath("alice", MESSAGE, "cur"), "mail/inboxes/alice/cur/m-00000000-0000-4000-8000-000000000003-0:2,");
  assert.equal(contextRevisionFor(OID), "context/revisions/1111111111111111111111111111111111111111");
  assert.equal(contextRevisionLinkFor(OID), "revisions/1111111111111111111111111111111111111111");
  assert.equal(actorSocketFor("alice", 7), "actors/alice/7/control.sock");
  assert.deepEqual(residentUnitsFor("demo", "alice"), ["oma-demo-alice.service", "oma-demo-alice.path"]);
  assert.equal(exportRefForRequestKey("abc"), "refs/oma/export/cli-ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.match(exportRefForRequestKey("k".repeat(96)), /^refs\/oma\/export\/cli-[0-9a-f]{64}$/);
  assert.throws(() => messageIdForOperation(OP, -1), TypeError);
  assert.throws(() => messageIdForOperation(OP, Number.MAX_SAFE_INTEGER + 1), TypeError);
  assert.throws(() => publishedRefFor("../alice", OP), TypeError); assert.throws(() => actorSocketFor("alice", -1), TypeError);
});

test("R03: valid syntax does not establish expected operation actor root or incarnation", () => {
  assert.equal(isMessageIdForOperation(MESSAGE, { operationId: OP }), true);
  assert.equal(isMessageIdForOperation(MESSAGE, { operationId: OTHER_OP }), false);
  const ref = "refs/oma/published/alice/op-00000000-0000-4000-8000-000000000003";
  assert.equal(isPublishedRefFor(ref, { actor: "alice", operationId: OP }), true);
  assert.equal(isPublishedRefFor(ref, { actor: "bob", operationId: OP }), false);
  assert.equal(isPublishedRefFor(ref, { actor: "alice", operationId: OTHER_OP }), false);
  const object = "mail/objects/m-00000000-0000-4000-8000-000000000003-0.eml";
  assert.equal(isMailObjectRelativePathFor(object, { messageId: MESSAGE }), true);
  assert.equal(isMailObjectRelativePathFor(object, { messageId: "m-00000000-0000-4000-8000-000000000004-0" }), false);
  assert.equal(workspacePathAt("/state", "alice"), "/state/agents/alice/workspace");
  assert.equal(isWorkspacePathFor("/state/agents/alice/workspace", { stateRoot: "/state", actor: "alice" }), true);
  assert.equal(isWorkspacePathFor("/state/agents/alice/workspace", { stateRoot: "/other", actor: "alice" }), false);
  assert.equal(isWorkspacePathFor("/state/agents/alice/workspace", { stateRoot: "/state", actor: "bob" }), false);
  const bundle = "/state/staging/submit-op-00000000-0000-4000-8000-000000000003/upload.bundle";
  assert.equal(submitBundlePathAt("/state", OP), bundle);
  assert.equal(isSubmitBundlePathFor(bundle, { stateRoot: "/state", operationId: OP }), true);
  assert.equal(isSubmitBundlePathFor(bundle, { stateRoot: "/state", operationId: OTHER_OP }), false);
  const context = "/state/staging/context-op-00000000-0000-4000-8000-000000000003";
  assert.equal(contextStagingPathAt("/state", OP), context);
  assert.equal(isContextStagingPathFor(context, { stateRoot: "/state", operationId: OP }), true);
  assert.equal(isContextStagingPathFor(context, { stateRoot: "/wrong", operationId: OP }), false);
  assert.equal(mailObjectPathAt("/state", MESSAGE), "/state/mail/objects/m-00000000-0000-4000-8000-000000000003-0.eml");
  const archive = "/state/mail/archive/cur/m-00000000-0000-4000-8000-000000000003-0:2,";
  assert.equal(mailArchivePathAt("/state", MESSAGE), archive);
  assert.equal(isMailArchivePathFor(archive, { stateRoot: "/state", messageId: MESSAGE }), true);
  assert.equal(isMailArchivePathFor(archive, { stateRoot: "/other", messageId: MESSAGE }), false);
  assert.equal(actorSocketPathAt("/run/demo", "alice", 7), "/run/demo/actors/alice/7/control.sock");
  assert.equal(isActorSocketPathFor("/run/demo/actors/alice/7/control.sock", { runRoot: "/run/demo", actor: "alice", incarnation: 7 }), true);
  assert.equal(isActorSocketPathFor("/run/demo/actors/alice/7/control.sock", { runRoot: "/run/demo", actor: "alice", incarnation: 8 }), false);
});

test("R03: the durable submit boundary rejects a syntactically valid foreign ref", () => {
  const plan = {
    kind: "git.submit", candidate: OID, exportRef: "refs/oma/export/legacy", prerequisites: [], bundle: null,
    publishedRef: "refs/oma/published/alice/op-00000000-0000-4000-8000-000000000003",
    message: { id: MESSAGE, objectPath: "mail/objects/m-00000000-0000-4000-8000-000000000003-0.eml",
      sha256: "a".repeat(64), bytes: 1, dateMs: 0, to: ["commons"], recipients: [], kind: "result", contextRevision: null,
      replyHeaders: { replyTo: ["commons"], inReplyTo: null, references: [] } },
  };
  const check = operationPlanCheck("git.submit", { operationId: OP, actor: "alice", stateRoot: "/state", repositoryIdentity: { society: "demo" } });
  assert.equal(check(plan), null);
  assert.notEqual(check({ ...plan, publishedRef: "refs/oma/published/bob/op-00000000-0000-4000-8000-000000000003" }), null);
  assert.notEqual(check({ ...plan, message: { ...plan.message, objectPath: "mail/objects/m-00000000-0000-4000-8000-000000000004-0.eml" } }), null);
});

test("R03: single-file Pi UUID copy agrees on independent boundary vectors", () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-r03-pi-"));
  try {
    const cases = [
      [BATCH, MESSAGE, true],
      ["b-00000000-0000-1000-8000-000000000003", MESSAGE, false],
      ["b-00000000-0000-4000-7000-000000000003", MESSAGE, false],
      ["b-ABCDEF00-0000-4000-8000-000000000003", MESSAGE, false],
      [BATCH, "m-00000000-0000-4000-8000-000000000003-9007199254740992", false],
      [BATCH, "m-00000000-0000-4000-7000-000000000003-0", false],
      [BATCH, "m-00000000-0000-4000-8000-000000000003-00", true],
    ] as const;
    for (const [batchId, messageId, accepted] of cases) {
      const view = { id: batchId, agent: "alice", incarnation: 1, deliveryMode: "followUp", notice: "fixture", messageIds: [messageId] };
      writeFileSync(join(dir, `batch-${batchId}.json`), JSON.stringify(view));
      assert.equal(parseBatchId(batchId) !== null && parseMessageFileId(messageId) !== null, accepted);
      if (accepted) assert.deepEqual(readBatchView(batchId, dir, VIEW_LIMITS), view);
      else assert.equal(readBatchView(batchId, dir, VIEW_LIMITS), null, "invalid views never reach the runner");
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("R03: actual CLI ACK rejects non-v4 IDs before replay or networking", async () => {
  const home = mkdtempSync(join(tmpdir(), "oma-r03-ack-"));
  try {
    const cache = new RequestCache(home);
    const receipt: Receipt = { operation: OP, state: "succeeded", result: { kind: "mail.ack", message: MESSAGE, acknowledged: true } };
    cache.freeze({ key: "ack-key", method: "mail.ack", params: { message: MESSAGE }, createdAtMs: 1 });
    cache.updateReceipt("ack-key", receipt);
    const invoke = (message: string) => runCliWithLookup(home, home, ["ack", message, "--request", "ack-key"], "ack-key", receipt);
    const good = await invoke(`/mail/archive/cur/${MESSAGE}:2,`);
    assert.equal(good.status, 0, good.stderr); assert.deepEqual(good.requests.map(request => request.method), ["operation.get"]);
    const bad = await invoke("m-00000000-0000-1000-8000-000000000003-0");
    assert.equal(bad.status, 2, bad.stderr); assert.match(bad.stderr, /ack requires a message id/);
    assert.deepEqual(bad.requests, [], "invalid IDs must fail before lookup");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("R03: actual CLI preserves an old frozen submit exportRef without consulting HEAD", async () => {
  const home = mkdtempSync(join(tmpdir(), "oma-r03-frozen-"));
  try {
    const cache = new RequestCache(home);
    const receipt: Receipt = { operation: OP, state: "succeeded", result: { kind: "git.submit", candidate: OID,
      publishedRef: "refs/oma/published/alice/op-00000000-0000-4000-8000-000000000003", message: MESSAGE, recipientCount: 0 } };
    cache.freeze({ key: "legacy-key", method: "git.submit", createdAtMs: 1,
      params: { candidate: OID, exportRef: "refs/oma/export/cli-legacy-key", prerequisites: [],
        to: ["commons"], subject: "Re: submit", body: "frozen", paths: [] } });
    cache.updateReceipt("legacy-key", receipt);
    const path = join(home, ".local/state/oma/requests/legacy-key.json"); const before = readFileSync(path);
    const cwd = join(home, "not-a-git-repository"); mkdirSync(cwd);
    const result = await runCliWithLookup(home, cwd, ["submit", "HEAD", "--request", "legacy-key"], "legacy-key", receipt);
    assert.equal(result.status, 0, result.stderr); assert.deepEqual(result.requests.map(request => request.method), ["operation.get"]);
    assert.deepEqual(readFileSync(path), before, "a frozen request is read, not rewritten into the fresh ref convention");
    const frozen = cache.read("legacy-key"); assert.ok(frozen.kind === "present"); const params = frozen.value.params;
    assert.ok(params !== null && typeof params === "object" && !Array.isArray(params));
    assert.equal(params.exportRef, "refs/oma/export/cli-legacy-key");
  } finally { rmSync(home, { recursive: true, force: true }); }
});
