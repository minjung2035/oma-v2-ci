import { serializePlanIntent } from "./fixtures/plan.js";
// P8: persisted format inventory, version boundary and portability policy.
// Nothing here rewrites accepted bytes; the oracles assert exactly that.
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@oma/storage";
import { StoreError } from "@oma/domain/errors";
import { requestHash } from "@oma/domain/request-identity";
import { sha256Hex } from "@oma/domain/canonical-json";
import { classifyPersistedPlan, planPortability, HOST_DERIVED_PLAN_FIELDS,
  PLAN_FORMAT_WRITTEN, SCHEMA_USER_VERSION_WRITTEN, CURRENT_PLAN_FIELDS } from "@oma/protocol/persisted-formats";
import { publishImmutableFile } from "@oma/storage/immutable-file";
import { writeExclusiveFsyncedFile } from "@oma/storage/durable-fs";
import { submitBundlePathAt } from "@oma/domain/paths";
import { makeValidAgent, storedSpec, ALL_CAPS } from "./fixtures/spec.js";
import { removeTree } from "./fixtures/cleanup.js";
import { mutateRawRowAfterClose } from "./fixtures/corruption.js";

const OP = "op-00000000-0000-4000-8000-0000000000c1";
const BUNDLE = `staging/submit-${OP}/upload.bundle`;
/** Raw read: the decode path refuses this row on purpose, and the point of the
 * case is that the persisted bytes are untouched. */
const rawPlanJson = (path: string, id: string): string => {
  const raw = new DatabaseSync(path);
  try { return String((raw.prepare("SELECT plan_json FROM operations WHERE id=?").get(id) as { plan_json: string }).plan_json); }
  finally { raw.close(); }
};
const userVersion = (path: string): number => {
  const raw = new DatabaseSync(path);
  try { return Number((raw.prepare("PRAGMA user_version").get() as { user_version: number }).user_version); }
  finally { raw.close(); }
};

test("P8 version boundary: a fresh database is the current schema and an unknown version fails closed without migration", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-format-version-"));
  const path = join(root, "runtime.sqlite");
  try {
    const store = new Store(path);
    store.transaction(() => store.insertAgent(makeValidAgent("a")));
    store.close();
    assert.equal(userVersion(path), SCHEMA_USER_VERSION_WRITTEN);

    // An unknown persisted version is not a migration request.
    mutateRawRowAfterClose(path, raw => raw.exec("PRAGMA user_version = 77"));
    const before = readFileSync(path);
    assert.throws(() => new Store(path),
      (error: unknown) => error instanceof StoreError && error.code === "STORE_CORRUPT" && /no migration was attempted/.test(error.message));
    assert.equal(userVersion(path), 77, "the persisted version is untouched");
    assert.deepEqual(readFileSync(path), before, "a refused open does not rewrite the database file");
  } finally { removeTree(root); }
});

test("P8 plan format: unknown shapes are classified unknown and never upgraded", () => {
  assert.equal(PLAN_FORMAT_WRITTEN, "v3");
  assert.deepEqual(classifyPersistedPlan({ version: 3, intent: { kind: "mail.send" } }), { format: "v3" });
  assert.deepEqual(classifyPersistedPlan({ version: 2, intent: { kind: "mail.send" } }), { format: "v2" });
  for (const value of [{ kind: "mail.send" }, { version: 1, intent: { kind: "mail.send" } },
    { version: 2, intent: { kind: "mail.send" }, extra: true }, { version: 2, intent: null }])
    assert.equal(classifyPersistedPlan(value).format, "unknown");
  assert.equal(classifyPersistedPlan({ kind: "mail.send", version: "v2" }).format, "unknown");
  assert.equal(classifyPersistedPlan({ kind: "not.a.kind" }).format, "unknown");
  assert.equal(classifyPersistedPlan(null).format, "unknown");
  assert.equal(classifyPersistedPlan({ kind: "context.publish", base: null }).format, "unknown");
  assert.equal(classifyPersistedPlan({ kind: "agent.create", spec: {} }).format, "unknown");
  assert.equal(classifyPersistedPlan({ kind: "git.submit", bundle: {} }).format, "unknown");
});

test("P8 host-derived locators: a copied state root keeps readable bytes but not its evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-format-portable-"));
  const other = mkdtempSync(join(tmpdir(), "oma-format-other-"));
  try {
    const store = new Store(join(root, "runtime.sqlite"));
    mkdirSync(join(root, `staging/submit-${OP}`), { recursive: true });
    const bundleBytes = Buffer.from("bundle bytes\n");
    writeExclusiveFsyncedFile(join(root, BUNDLE), bundleBytes);
    const payload = { candidate: "1".repeat(40), exportRef: "refs/oma/export/format", prerequisites: [], to: [], subject: "s", body: "", paths: [],
      bundle: { bytes: bundleBytes.length, sha256: sha256Hex(bundleBytes), mediaType: "application/x-git-bundle" } };
    const messageId = `m-00000000-0000-4000-8000-0000000000c1-0`;
    const planJson = serializePlanIntent({
      kind: "git.submit", candidate: payload.candidate, exportRef: payload.exportRef, prerequisites: [],
      bundle: { path: submitBundlePathAt(root, OP), sha256: sha256Hex(bundleBytes), bytes: bundleBytes.length },
      publishedRef: `refs/oma/published/a/${OP}`,
      message: { id: messageId, objectPath: `mail/objects/${messageId}.eml`, sha256: "a".repeat(64), bytes: 1, dateMs: 1,
        to: ["commons"], recipients: ["a"], kind: "result", contextRevision: null,
        replyHeaders: { replyTo: ["commons"], inReplyTo: null, references: [] } },
    });
    store.transaction(() => {
      store.insertAgent(makeValidAgent("a"));
      store.insertOperation({ id: OP, actor: "a", requestKey: "format", requestHash: requestHash("git.submit", payload),
        kind: "git.submit", payloadJson: JSON.stringify(payload), planJson });
      store.insertDeliveries([{ messageId, recipient: "a", operationId: OP }]);
    });
    const plan = JSON.parse(planJson);
    assert.deepEqual(classifyPersistedPlan(plan), { format: "v2" });
    // P0V-89 (R6-12): whether a locator belongs to this root is the ledger's
    // reading of the row, not a separate check a caller may forget to make.
    assert.equal(store.getOperationById(OP as never)?.id, OP, "the root that derived the locator reads it");
    const findings = planPortability([{ kind: "git.submit", plan }, { kind: "mail.send", plan: { version: 2, intent: { kind: "mail.send" } } }]);
    assert.deepEqual(findings[0], { kind: "git.submit", fields: ["bundle.path"], portable: false });
    assert.deepEqual(findings[1], { kind: "mail.send", fields: [], portable: true });
    assert.deepEqual([...HOST_DERIVED_PLAN_FIELDS].sort(), ["bundle.path", "stagingPath", "workspacePath"]);
    assert.ok(CURRENT_PLAN_FIELDS.some(field => field.class === "historical-result"));

    const persistedBefore = store.getOperationById(OP as never)!.planJson;
    store.close();

    // Restore into a different root: current envelope bytes stay readable and are not rewritten,
    // and the host-derived locator is reported instead of silently re-derived.
    cpSync(root, other, { recursive: true });
    const restored = new Store(join(other, "runtime.sqlite"));
    // The restored tree still carries the previous root's locator. Reading it
    // fails closed instead of silently re-deriving a path from the current root.
    assert.throws(() => restored.getOperationById(OP as never),
      (error: unknown) => error instanceof StoreError && error.code === "STORE_CORRUPT");
    assert.equal(rawPlanJson(join(other, "runtime.sqlite"), OP), persistedBefore, "restore does not rewrite accepted plan bytes");
    const restoredPlan = JSON.parse(rawPlanJson(join(other, "runtime.sqlite"), OP));
    assert.deepEqual(classifyPersistedPlan(restoredPlan), { format: "v2" });
    assert.deepEqual(planPortability([{ kind: "git.submit", plan: restoredPlan }])[0]!.fields, ["bundle.path"]);
    restored.close();
  } finally { removeTree(root); removeTree(other); }
});

test("P8 rewrite prohibition: an accepted plan with an unusable locator stays byte-identical", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-format-rewrite-"));
  try {
    const path = join(root, "runtime.sqlite");
    const store = new Store(path);
    const payload = { candidate: "1".repeat(40), exportRef: "refs/oma/export/format", prerequisites: [], to: [], subject: "s", body: "", paths: [],
      bundle: { bytes: 1, sha256: "a".repeat(64), mediaType: "application/x-git-bundle" } };
    const messageId = "m-00000000-0000-4000-8000-0000000000c2-0";
    const OP2 = "op-00000000-0000-4000-8000-0000000000c2";
    const legacy = serializePlanIntent({
      kind: "git.submit", candidate: payload.candidate, exportRef: payload.exportRef, prerequisites: [],
      bundle: { path: submitBundlePathAt(root, OP2), sha256: "a".repeat(64), bytes: 1 }, publishedRef: `refs/oma/published/a/${OP2}`,
      message: { id: messageId, objectPath: `mail/objects/${messageId}.eml`, sha256: "a".repeat(64), bytes: 1, dateMs: 1,
        to: ["commons"], recipients: ["a"], kind: "result", contextRevision: null,
        replyHeaders: { replyTo: ["commons"], inReplyTo: null, references: [] } },
    });
    store.transaction(() => {
      store.insertAgent(makeValidAgent("a"));
      store.insertOperation({ id: OP2, actor: "a", requestKey: "legacy", requestHash: requestHash("git.submit", payload),
        kind: "git.submit", payloadJson: JSON.stringify(payload), planJson: legacy });
      store.insertDeliveries([{ messageId, recipient: "a", operationId: OP2 }]);
    });
    // The accepted bundle was never written: reads still return the frozen bytes.
    const row = store.getOperationById(OP2 as never)!;
    assert.equal(row.planJson, legacy);
    store.close();
    const reopened = new Store(path);
    assert.equal(reopened.getOperationById(OP2 as never)!.planJson, legacy, "no read path rewrites the plan");
    assert.deepEqual(classifyPersistedPlan(JSON.parse(legacy)), { format: "v2" });
    // No repair is attempted for the missing staging file: it is not derived.
    assert.throws(() => publishImmutableFile(join(root, "missing"), join(root, "target")), /ENOENT|STORE_CORRUPT/);
    reopened.close();
  } finally { removeTree(root); }
});

test("P8 inventory: every classified field belongs to the closed persisted surface", () => {
  const allowed = ["intrinsic-identity", "immutable-logical-fact", "derived-durable-identity",
    "host-derived-physical-locator", "reconstructable-presentation", "historical-result"];
  for (const field of CURRENT_PLAN_FIELDS) {
    assert.ok(allowed.includes(field.class), field.field);
    assert.ok(field.kind === "*" || classifyPersistedPlan({ version: 2, intent: { kind: field.kind, workspacePath: "/x", stagingPath: "/x", bundle: { path: "/x" }, spec: {} } }).format === "v2", field.kind);
  }
  assert.ok(storedSpec(ALL_CAPS, "p", "a").specHash.length === 64);
});
