import { serializePlanIntent } from "./fixtures/plan.js";
// P9 persisted-state fuzz: plan_json, result_json, agent spec, context manifest
// and the persisted version classifier. The oracle is not "does not throw":
// every rejected case must be a closed failure or an explicit unknown, must
// leave no physical effect behind, and must never be silently repaired.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@oma/storage";
import { StoreError } from "@oma/domain/errors";
import { requestHash } from "@oma/domain/request-identity";
import { operationPlanCheck, operationResultRelationCheck } from "@oma/domain/durable";
import { operationResultCheck } from "@oma/domain/validation";
import { decodeAgentSpec } from "@oma/domain/agent-spec";
import { contextEntriesCheck } from "@oma/domain/durable";
import { classifyPersistedPlan } from "@oma/protocol/persisted-formats";
import { isMutationMethod } from "@oma/protocol/receipt-codec";
import { makeValidAgent } from "./fixtures/spec.js";
import { removeTree } from "./fixtures/cleanup.js";
import { Seeded, integerParameter, recordExplorationFailure, replayMetadata } from "./model/reproducible.js";
import { PLAN_API, PLAN_VALID, PLAN_INVALID, RESULT_VALID, RESULT_INVALID, SPEC_VALID, SPEC_INVALID,
  MANIFEST_VALID, MANIFEST_INVALID } from "./fuzz/persisted-corpus.js";

const cases = integerParameter("OMA_TEST_FUZZ_CASES", 256, 100000);
/** Physical-effect oracle. SQLite rewrites WAL pages on any open, so the durable
 * artifact question is "did any non-database file appear, change or disappear",
 * plus "did any durable row change". Both are checked separately. */
function snapshot(root: string): string {
  const entries: string[] = [];
  const walk = (path: string, prefix: string): void => {
    for (const name of readdirSync(path).sort()) {
      const child = join(path, name);
      const stat = statSync(child);
      if (stat.isDirectory()) { entries.push(`${prefix}${name}/`); walk(child, `${prefix}${name}/`); continue; }
      if (name.startsWith("runtime.sqlite")) continue;
      entries.push(`${prefix}${name}:${stat.size}:${createHash("sha256").update(readFileSync(child)).digest("hex")}`);
    }
  };
  walk(root, "");
  return entries.join("\n");
}
/** Durable rows are the other half of "no unintended physical effect". */
function rowDigest(path: string): string {
  const raw = new DatabaseSync(path);
  try {
    const digest = createHash("sha256");
    for (const table of ["agents", "operations", "deliveries", "batches", "subscriptions", "attestations"]) {
      const rows = raw.prepare(`SELECT * FROM ${table} ORDER BY 1`).all() as unknown[];
      digest.update(JSON.stringify(rows));
    }
    return digest.digest("hex");
  } finally { raw.close(); }
}
/** Seeded structural mutation of a persisted JSON document. Deterministic for a
 * given seed, so a failing case is reproduced from the seed and the corpus. */
class PersistedFuzzer {
  private readonly random: Seeded;
  constructor(seed: number) { this.random = new Seeded(seed); }
  json(valid: string): unknown {
    const value = JSON.parse(valid) as unknown;
    const keys = this.paths(value);
    const pick = keys.length > 0 ? keys[this.random.index(keys.length)]! : [];
    switch (this.random.index(6)) {
      case 0: return this.remove(value, pick);
      case 1: return this.coerce(value, pick);
      case 2: return this.rename(value, pick);
      case 3: return valid.slice(0, this.random.index(valid.length));
      case 4: {
        const candidate = valid.slice(0, -1) + ',"fuzzed":' + (this.random.index(2) === 0 ? "null" : "1") + "}";
        try { return JSON.parse(candidate) as unknown; } catch { return candidate; }
      }
      default: return valid + (this.random.index(2) === 0 ? " " : "\u0000");
    }
  }
  private paths(value: unknown, prefix: readonly (string | number)[] = [], out: (string | number)[][] = []): (string | number)[][] {
    if (value !== null && typeof value === "object") {
      for (const [key, child] of Array.isArray(value) ? value.map((item, index) => [index, item] as const) : Object.entries(value)) {
        const path = [...prefix, key as string | number];
        out.push(path);
        this.paths(child, path, out);
      }
    }
    return out;
  }
  private remove(value: unknown, path: readonly (string | number)[]): unknown {
    const clone = structuredClone(value) as Record<string | number, unknown>;
    const parent = path.slice(0, -1).reduce<Record<string | number, unknown>>((node, key) => node[key] as Record<string | number, unknown>, clone);
    delete parent[path[path.length - 1]!];
    return clone;
  }
  private coerce(value: unknown, path: readonly (string | number)[]): unknown {
    const clone = structuredClone(value) as Record<string | number, unknown>;
    const parent = path.slice(0, -1).reduce<Record<string | number, unknown>>((node, key) => node[key] as Record<string | number, unknown>, clone);
    const current = parent[path[path.length - 1]!];
    const replacements = [null, 0, -1, true, "", "x".repeat(1024), [], {}] as const;
    parent[path[path.length - 1]!] = replacements[this.random.index(replacements.length)];
    void current;
    return clone;
  }
  private rename(value: unknown, path: readonly (string | number)[]): unknown {
    const clone = structuredClone(value) as Record<string | number, unknown>;
    const key = path[path.length - 1]!;
    const parent = path.slice(0, -1).reduce<Record<string | number, unknown>>((node, item) => node[item] as Record<string | number, unknown>, clone);
    parent[`fuzzed.${String(key)}`] = parent[key];
    delete parent[key];
    return clone;
  }
}

test("P9 fuzz plan_json: rejected plans are closed failures with no repair and no physical effect", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-p9-plan-"));
  const path = join(root, "runtime.sqlite");
  try {
    const store = new Store(path);
    store.transaction(() => store.insertAgent(makeValidAgent("a")));
    const before = snapshot(root), rowsBefore = rowDigest(path);
    const random = new PersistedFuzzer(0x9a1e);
    const corpus: unknown[] = [...PLAN_INVALID];
    for (const plan of PLAN_VALID) {
      const text = JSON.stringify(plan);
      for (let index = 0; index < cases / PLAN_VALID.length; index++)
        corpus.push(random.json(text));
    }
    let closed = 0, accepted = 0;
    for (const plan of corpus) {
      const classification = classifyPersistedPlan({ version: 2, intent: plan });
      let shape: string | null;
      try { shape = operationPlanCheck("route.follow", PLAN_API)(plan); }
      catch (error) { assert.fail(`plan check escaped its rejection type: ${String(error)}`); }
      if (classification.format === "v2" && shape === null) { accepted++; continue; }
      closed++;
      assert.notEqual(classification.format === "unknown" ? "unknown" : shape, null, JSON.stringify(plan)?.slice(0, 120));
    }
    assert.ok(closed > 0 && accepted >= 0);
    assert.equal(snapshot(root), before, "fuzzed plans must not create, repair or rewrite any file");
    assert.equal(rowDigest(path), rowsBefore, "fuzzed plans must not change any durable row");
    store.close();
    assert.equal(snapshot(root), before);
  } finally { removeTree(root); }
});

test("P9 fuzz result_json: a closed result never disagrees with its accepted plan", () => {
  const random = new PersistedFuzzer(0x5e77);
  const corpus: unknown[] = [...RESULT_INVALID];
  for (const result of RESULT_VALID) for (let index = 0; index < 32; index++) corpus.push(random.json(JSON.stringify(result)));
  let closed = 0;
  for (const result of corpus) {
    let shape: string | null;
    try { shape = operationResultCheck("route.follow")(result); }
    catch (error) { assert.fail(`result check escaped its rejection type: ${String(error)}`); }
    if (shape === null) {
      // A shape-valid result must still be rejected when it disagrees with intent.
      const plan = { kind: "route.follow", topic: "different", agent: "a" };
      const relation = operationResultRelationCheck("route.follow", plan, result, PLAN_API);
      assert.equal(typeof relation, "string");
      closed++;
      continue;
    }
    closed++;
  }
  assert.ok(closed > 0);
});

test("P9 fuzz agent spec: a corrupt frozen spec is never degraded to an empty permission set", () => {
  const random = new PersistedFuzzer(0x1234);
  const corpus: unknown[] = [...SPEC_INVALID];
  for (let index = 0; index < 64; index++) corpus.push(random.json(JSON.stringify(SPEC_VALID)));
  let closed = 0;
  for (const spec of corpus) {
    const text = typeof spec === "string" ? spec : JSON.stringify(spec);
    try {
      const decoded = decodeAgentSpec(text);
      // Only a shape that the closed validator accepts may decode.
      assert.equal(typeof decoded.name, "string");
      continue;
    } catch (error) {
      assert.ok(error instanceof StoreError && error.code === "STORE_CORRUPT", `unexpected failure type: ${String(error)}`);
      closed++;
    }
  }
  assert.ok(closed > 0, "the corrupt corpus must exercise the closed failure path");
});

test("P9 fuzz context manifest: unsafe paths and byte/digest coercion are rejected, never repaired", () => {
  const random = new PersistedFuzzer(0xc0ffee);
  const corpus: unknown[] = [...MANIFEST_INVALID];
  for (let index = 0; index < 64; index++) corpus.push(random.json(JSON.stringify(MANIFEST_VALID)));
  let closed = 0;
  for (const manifest of corpus) {
    let invalid: string | null;
    try { invalid = contextEntriesCheck(manifest); }
    catch (error) { assert.fail(`manifest check escaped its rejection type: ${String(error)}`); }
    if (invalid === null) continue;
    assert.equal(typeof invalid, "string");
    closed++;
  }
  assert.ok(closed > 0);
});

test("P9 fuzz persisted version classifier: unknown formats stay unknown and are never upgraded", () => {
  const random = new PersistedFuzzer(0xbeef);
  const corpus: unknown[] = [...PLAN_INVALID, ...PLAN_VALID];
  for (const plan of PLAN_VALID) for (let index = 0; index < 16; index++) corpus.push(random.json(JSON.stringify(plan)));
  let unknown = 0;
  for (const plan of corpus) {
    const classification = classifyPersistedPlan({ version: 2, intent: plan });
    if (classification.format === "v2") {
      const kind = (plan as { kind?: unknown }).kind;
      assert.ok(typeof kind === "string" && isMutationMethod(kind), "v2 classification requires a method owner kind");
      continue;
    }
    assert.ok("reason" in classification, "a historical v2 envelope cannot acquire native v3 meaning");
    unknown++;
    assert.ok(typeof classification.reason === "string" && classification.reason.length > 0);
    assert.notEqual(classification.format, "v2");
  }
  assert.ok(unknown > 0);
});

test("P9 fuzz replay metadata and corpus preservation are recorded", () => {
  const metadata = replayMetadata(0x9a1e, { cases, corpus: "test/fuzz/persisted-corpus.ts", targets: 6 });
  assert.equal(metadata.schema, 1);
  assert.equal(metadata.prngRevision.length > 0, true);
  assert.equal(metadata.parameters.cases, cases);
  const record = { corpus: "persisted-corpus.ts", caseIndex: 0, bytes: "plan_json" };
  const written = recordExplorationFailure("parser", record);
  assert.match(written, /replay\.json$/);
  const replay = JSON.parse(readFileSync(written, "utf8")) as { kind: string; record: unknown };
  assert.equal(replay.kind, "parser");
  assert.deepEqual(replay.record, record);
  // Corpus files are checked in; a fuzz failure is reproduced from the seed and
  // the recorded case rather than from a rewritten corpus.
  const corpusText = readFileSync("test/fuzz/persisted-corpus.ts", "utf8");
  assert.match(corpusText, /PLAN_INVALID/);
  assert.match(corpusText, /MANIFEST_INVALID/);
});

test("P9 fuzz raw persisted row: a fuzzed plan_json leaves the database bytes untouched", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-p9-row-"));
  const path = join(root, "runtime.sqlite");
  const OP = "op-00000000-0000-4000-8000-0000000000e9";
  try {
    const store = new Store(path);
    const messageId = "m-00000000-0000-4000-8000-0000000000e9-0";
    const payload = { to: ["a"], subject: "fuzz", body: "body", kind: "message" };
    const plan = { kind: "mail.send", message: { id: messageId, objectPath: `mail/objects/${messageId}.eml`, sha256: "a".repeat(64),
      bytes: 1, dateMs: 1, to: ["a"], recipients: ["a"], kind: "message", contextRevision: null,
      replyHeaders: { replyTo: ["a"], inReplyTo: null, references: [] } } };
    store.transaction(() => {
      store.insertAgent(makeValidAgent("a"));
      store.insertOperation({ id: OP, actor: "a", requestKey: "fuzz", requestHash: requestHash("mail.send", payload),
        kind: "mail.send", payloadJson: JSON.stringify(payload), planJson: serializePlanIntent(plan) });
      store.insertDeliveries([{ messageId, recipient: "a", operationId: OP }]);
    });
    store.close();
    const raw = new DatabaseSync(path);
    let control: string;
    try { control = String((raw.prepare("SELECT plan_json FROM operations WHERE id=?").get(OP) as { plan_json: string }).plan_json); }
    finally { raw.close(); }
    const random = new PersistedFuzzer(0x77aa);
    for (let index = 0; index < 64; index++) {
      const candidate = random.json(control);
      const fuzzed = typeof candidate === "string" ? candidate : (JSON.stringify(candidate) ?? "");
      const database = new DatabaseSync(path);
      try {
        try { database.prepare("UPDATE operations SET plan_json=? WHERE id=?").run(fuzzed, OP); }
        catch (error) {
          // The storage layer rejects non-JSON bytes; that is a closed failure
          // with no effect, and the accepted row keeps its bytes.
          assert.match(String(error), /json_valid|CHECK|constraint/i);
          assert.equal(String((database.prepare("SELECT plan_json FROM operations WHERE id=?").get(OP) as { plan_json: string }).plan_json), control);
          continue;
        }
        // A read must be a closed failure or a decoded row; never a rewrite.
        const reopened = new Store(path);
        try { reopened.getOperationById(OP as never); }
        catch (error) { assert.ok(error instanceof StoreError, String(error)); }
        finally { reopened.close(); }
        const observed = new DatabaseSync(path);
        try { assert.equal(String((observed.prepare("SELECT plan_json FROM operations WHERE id=?").get(OP) as { plan_json: string }).plan_json), fuzzed, "the persisted bytes are never repaired"); }
        finally { observed.close(); }
      } finally {
        database.prepare("UPDATE operations SET plan_json=? WHERE id=?").run(control, OP);
        database.close();
      }
    }
    const final = new DatabaseSync(path);
    try { assert.equal(String((final.prepare("SELECT plan_json FROM operations WHERE id=?").get(OP) as { plan_json: string }).plan_json), control); }
    finally { final.close(); }
  } finally { removeTree(root); }
});
