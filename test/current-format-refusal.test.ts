/** DR46: development format changes refuse old state; no migration or deletion. */
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store, readDiagnosticSnapshot } from "@oma/storage";
import { StoreError } from "@oma/domain/errors";
import { defaultHostConfig } from "@oma/config/defaults";
import { loadConfig, validateConfig } from "@oma/config";
import { decodeMutationPayload } from "@oma/protocol/request-codec";
import { isReviewRequestName } from "@oma/domain/identifiers";
import { makeValidAgent } from "./fixtures/spec.js";
import { serializePlanIntent } from "./fixtures/plan.js";
import { requestHash } from "@oma/domain/request-identity";
import { mutateRawRowAfterClose } from "./fixtures/corruption.js";

const corrupt = (error: unknown): boolean => error instanceof StoreError && error.code === "STORE_CORRUPT";
for (const version of [1, 2, 3]) test(`DR46 schema4: refused schema ${version} stays byte-identical and diagnostics cannot approve it`, t => {
  const root = mkdtempSync(join(tmpdir(), "oma-prior-db-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "runtime.sqlite"), raw = new DatabaseSync(path);
  raw.exec(`CREATE TABLE prior_state(id TEXT PRIMARY KEY); INSERT INTO prior_state VALUES ('kept'); PRAGMA user_version = ${version}`);
  raw.close();
  const before = readFileSync(path), names = readdirSync(root).sort();
  assert.throws(() => new Store(path), corrupt);
  assert.throws(() => readDiagnosticSnapshot(root), corrupt);
  assert.deepEqual(readFileSync(path), before);
  assert.deepEqual(readdirSync(root).sort(), names, "refusal creates no replacement database or sidecar");
});

test("DR46 Host3: previous versions and inert resource fields refuse without modifying configuration bytes", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-prior-config-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const current = defaultHostConfig({ society: "demo", node: process.execPath, libdir: process.cwd(),  deploymentDigest: "a".repeat(64) });
  assert.doesNotThrow(() => validateConfig(current));
  const path = join(root, "config.json");
  for (const value of [
    { ...current, schemaVersion: 1 }, { ...current, schemaVersion: 2 },
    { ...current, agentProfiles: { ...current.agentProfiles, resident: { ...current.agentProfiles.resident, resources: {} } } },
    { ...current, integration: { ...current.integration, checks: [{ id: "check", argv: ["true"], env: {}, resources: {} }] } },
    { ...current, integration: { ...current.integration, tiered: { ...current.integration.tiered, review: "mail-v1" } } },
    { ...current, integration: { ...current.integration, tiered: { ...current.integration.tiered, highPeerFloor: 1 } } },
  ]) {
    const bytes = JSON.stringify(value, null, 2); writeFileSync(path, bytes);
    assert.throws(() => loadConfig(path), { code: "INVALID_REQUEST" });
    assert.equal(readFileSync(path, "utf8"), bytes);
  }
});

test("DR46 plan2: a prior bare plan in a current database is rejected and never receives an envelope on read", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-prior-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "runtime.sqlite"), id = "op-00000000-0000-4000-8000-000000000001";
  const payload = { topic: "dev" }, intent = { kind: "route.follow", topic: "dev", agent: "alice" };
  const store = new Store(path);
  store.transaction(tx => {
    tx.insertAgent(makeValidAgent("alice"));
    tx.acceptOperation({ id, actor: "alice", requestKey: "fixed", requestHash: requestHash("route.follow", payload), kind: "route.follow",
      payloadJson: JSON.stringify(payload), planJson: serializePlanIntent(intent) });
  });
  assert.equal(store.getOperationById(id)!.planJson, serializePlanIntent(intent)); store.close();
  const bare = JSON.stringify(intent, null, 2);
  mutateRawRowAfterClose(path, db => db.prepare("UPDATE operations SET plan_json=? WHERE id=?").run(bare, id));
  const reopened = new Store(path);
  try { assert.throws(() => reopened.getOperationById(id), corrupt); } finally { reopened.close(); }
  const observed = new DatabaseSync(path, { readOnly: true });
  try { assert.equal(observed.prepare("SELECT plan_json FROM operations WHERE id=?").get(id)!.plan_json, bare); }
  finally { observed.close(); }
});

test("DR46 review grammar: old attestation kinds and short names cannot become current requests", () => {
  for (const kind of ["peer", "decision", "revoke", "challenge", "finding", "scope"])
    assert.throws(() => decodeMutationPayload("attest.record", { kind }), TypeError);
  for (const name of ["merge-abcd1234", "challenge-abcd1234"]) assert.equal(isReviewRequestName(name), false);
  assert.equal(isReviewRequestName("merge-abcd1234-0000-4000-8000-000000000001"), true);
});
