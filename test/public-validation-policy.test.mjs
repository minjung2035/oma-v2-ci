import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import * as timers from "node:timers/promises";
import ts from "typescript";
import { workspaceSource } from "./fixtures/workspace-source.mjs";
import { publicDetails } from "@oma/domain/errors";
// w10 moved this constant to the client limits module; the fixture loads the
// real compiled value rather than re-deriving the bound a second way.
import { MIN_LOG_FRAME_BYTES } from "@oma/protocol/log-limits";

/** The real dispatcher and reply construction run against controlled metadata,
 * decoder and effect boundaries. This is not a wire-schema or transport proof.
 */
function fixture(transform = source => source) {
  const calls = { actors: 0, params: 0, operationChecks: 0, admission: 0, refresh: 0, effects: [], order: [] };
  const state = { actor: { name: "resident", incarnation: 1, desired: "enabled", capabilities: new Set(["fixture.submit"]) },
    rejectParams: false, throwOnOperationCheck: false, denyAdmission: false, draining: false, observationError: null };
  const auth = { actor: "resident", channel: "actor", incarnation: 1, capabilities: new Set(["fixture.submit"]) };
  class StoreError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const table = {
    "mail.send": { stream: "none", key: "required", capability: "fixture.submit", mode: "mutation" },
    "git.submit": { stream: "optional-bundle", key: "required", capability: "fixture.submit", mode: "mutation" },
    "context.publish": { stream: "context", key: "required", capability: "fixture.submit", mode: "mutation" },
    "status.get": { stream: "none", key: "forbidden", capability: null, mode: "read" },
    "agent.wait": { stream: "none", key: "forbidden", capability: null, mode: "ephemeral" },
  };
  function load(file, dependencies, mutate = source => source) {
    const source = mutate(readFileSync(file.startsWith("@oma/") ? workspaceSource(file) : new URL(file, import.meta.url), "utf8"));
    const compiled = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    }, reportDiagnostics: true });
    assert.deepEqual(compiled.diagnostics, []);
    const exports = {};
    new Script(compiled.outputText, { filename: file }).runInNewContext({ exports, Buffer, require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `uncontrolled dependency: ${name}`);
      return dependencies[name];
    } });
    return exports;
  }
  const replies = load("../packages/broker/src/replies.ts", {});
  const logResponse = load("@oma/protocol/log-response", { "@oma/domain/errors": { StoreError },
    "./log-limits.js": { MIN_LOG_FRAME_BYTES } });
  const { PublicDispatcher } = load("../packages/broker/src/public-dispatcher.ts", {
    "node:timers/promises": timers,
    // DR3: which facts a failure may carry has one owner, used as it is.
    "@oma/domain/errors": { StoreError, publicDetails },
    "@oma/domain/exhaustive": { assertNever(value) { throw new TypeError(`unhandled closed variant: ${String(value)}`); } },
    "@oma/domain/admission": { NO_HOLD: () => undefined },
    "@oma/domain/authority": { capabilitiesOf: actor => actor.capabilities },
    "@oma/domain/identifiers": { isValidRequestKey: key => typeof key === "string" && /^key-[0-9]+$/.test(key) },
    "@oma/protocol/receipts": { receiptOfOperation: value => value, receiptNotFound: { status: "not-found" } },
    "@oma/protocol/methods": { PUBLIC_METHODS: table, isPublicMethod: method => Object.hasOwn(table, method),
      decodePublicParams(_method, params) { calls.params++; return state.rejectParams || !params || typeof params !== "object" ? null : params; } },
    "@oma/protocol/log-response": logResponse,
    "@oma/protocol/status-page": { statusPage: (id, observedAtMs, agents) => replies.okAnswer(id, { observedAtMs, agents }) },
    "@oma/protocol/receipt-chunks": { receiptChunk() { throw new Error("unexpected chunk read in validation fixture"); } },
    "./replies.js": replies,
  }, transform);
  const effect = async (...args) => { calls.effects.push(args); return { accepted: true }; };
  const deps = {
    store: {
      getAgent() { calls.actors++; if (state.observationError) throw state.observationError; return state.actor; },
      listAgents: () => state.actor ? [state.actor] : [],
      hasOperation() { calls.operationChecks++; calls.order.push("operation"); if (state.throwOnOperationCheck) throw new Error("unexpected operation lookup"); return false; },
      // The terminal-replay read runs only after the admission fence fired;
      // this fixture holds no minted receipt, so the fence's answer stands.
      getReceipt() { calls.receiptReads = (calls.receiptReads ?? 0) + 1; return null; },
    },
    mail: { send: effect }, units: { statusSnapshot: async () => ({ observedAtMs: 1, units: new Map(), failure: null }) },
    views: { status: () => [] }, lifecycle: {}, limits: {},
    review: null,
git: { submit: effect, publishContext: effect, isPublished() { calls.order.push("published"); return false; } },
    waitRun: () => true,
    isDraining: () => state.draining,
    assertAdmission() { calls.admission++; if (state.denyAdmission) throw new StoreError("BROKER_UNAVAILABLE", "admission closed"); },

    failureAnswer: (id, error) => replies.errorAnswer(id, { code: error.code ?? "INTERNAL_ERROR", message: error.message, retry: "never" }),
    refreshViews() { calls.refresh++; },
  };
  return { dispatcher: new PublicDispatcher(deps), state, auth, calls, StoreError };
}
const request = overrides => ({ v: 1, id: "transport-1", method: "git.submit", request: "key-1", params: { bundle: { bytes: 1 } }, ...overrides });
const body = () => (async function* () { yield new Uint8Array([1]); })();

for (const [name, change, code] of [
  ["stop", state => { state.actor.desired = "stopped"; }, "STALE_RUN"],
  ["new incarnation", state => { state.actor.incarnation++; }, "STALE_RUN"],
  ["actor removal", state => { state.actor = null; }, "STALE_RUN"],
  ["capability revocation", state => { state.actor.capabilities.clear(); }, "CAPABILITY_DENIED"],
  ["parameter policy change", state => { state.rejectParams = true; }, "INVALID_REQUEST"],
  ["admission closure", state => { state.denyAdmission = true; }, "BROKER_UNAVAILABLE"],
]) test(`P1 public validation: dispatch rechecks ${name} after preflight`, async () => {
  const { dispatcher, state, auth, calls } = fixture(); const raw = request();
  dispatcher.preflight(auth, raw);
  await Promise.resolve(); change(state);
  const result = await dispatcher.dispatch(auth, raw, body());
  assert.equal(result.ok, false); assert.equal(result.error.code, code);
  assert.equal(calls.actors, 2); assert.equal(calls.effects.length, 0); assert.equal(calls.refresh, 0);
});

test("P1 public validation: changing one version rule changes both phases", async () => {
  const { dispatcher, auth } = fixture(source => source.replace("envelope.v !== 1", "envelope.v !== 2"));
  const changed = request({ v: 2 }); dispatcher.preflight(auth, changed);
  assert.equal((await dispatcher.dispatch(auth, changed, body())).ok, true);
  const previous = request();
  assert.throws(() => dispatcher.preflight(auth, previous), error => error.code === "UNSUPPORTED_VERSION");
  assert.equal((await dispatcher.dispatch(auth, previous, body())).error.code, "UNSUPPORTED_VERSION");
});

test("P1 public validation: a stream without its optional bundle descriptor is rejected before receiving bytes", async () => {
  const { dispatcher, auth, calls } = fixture(); const raw = request({ params: {} });
  assert.throws(() => dispatcher.preflight(auth, raw), error => error.code === "INVALID_REQUEST");
  assert.equal((await dispatcher.dispatch(auth, raw, body())).error.code, "INVALID_REQUEST");
  assert.equal(calls.admission, 0); assert.equal(calls.effects.length, 0);
});

test("P1 public validation: envelope, key, capability and parameter rejection stay shared", async () => {
  for (const [overrides, change, code] of [
    [{ id: 4 }, () => {}, "INVALID_REQUEST"], [{ extra: true }, () => {}, "INVALID_REQUEST"],
    [{ v: 3 }, () => {}, "UNSUPPORTED_VERSION"], [{ request: "" }, () => {}, "INVALID_REQUEST"],
    [{ request: undefined }, () => {}, "INVALID_REQUEST"], [{ params: null }, () => {}, "INVALID_REQUEST"],
    [{}, state => { state.rejectParams = true; }, "INVALID_REQUEST"],
  ]) {
    const { dispatcher, auth, state, calls } = fixture(); const raw = request(overrides); change(state);
    assert.throws(() => dispatcher.preflight(auth, raw), error => error.code === code);
    assert.equal((await dispatcher.dispatch(auth, raw, body())).error.code, code);
    assert.equal(calls.effects.length, 0);
  }
  const { dispatcher, auth } = fixture(); auth.capabilities.clear();
  assert.throws(() => dispatcher.preflight(auth, request()), error => error.code === "CAPABILITY_DENIED");
  assert.equal((await dispatcher.dispatch(auth, request(), body())).error.code, "CAPABILITY_DENIED");
});

test("P1 public validation: phase-specific error precedence is preserved", async () => {
  const { dispatcher, auth, state } = fixture(); state.actor.desired = "stopped";
  const raw = request({ v: 3 });
  assert.throws(() => dispatcher.preflight(auth, raw), error => error.code === "UNSUPPORTED_VERSION");
  assert.equal((await dispatcher.dispatch(auth, raw, body())).error.code, "STALE_RUN");
  state.actor.desired = "enabled";
  const unknown = request({ method: "unknown.method" });
  assert.throws(() => dispatcher.preflight(auth, unknown), error => error.code === "INVALID_REQUEST");
  assert.equal((await dispatcher.dispatch(auth, unknown, body())).error.code, "UNKNOWN_METHOD");
});

test("P1 public validation: successful requests re-read and re-decode rather than caching preflight", async () => {
  for (const method of ["git.submit", "context.publish"]) {
    const { dispatcher, auth, calls } = fixture(); const raw = request({ method });
    dispatcher.preflight(auth, raw);
    const result = await dispatcher.dispatch(auth, raw, body());
    assert.equal(result.ok, true); assert.equal(result.id, raw.id);
    // Preflight and dispatch each read current authority and decode again.
    assert.equal(calls.actors, 2); assert.equal(calls.params, 2); assert.equal(calls.admission, 2);
    assert.equal(calls.effects.length, 1); assert.equal(calls.refresh, 1);
  }
});

test("P1 public validation: read/ephemeral keys and draining admission remain fail-closed", async () => {
  for (const method of ["status.get", "agent.wait"]) {
    const { dispatcher, auth, state, calls } = fixture();
    assert.equal((await dispatcher.dispatch(auth, request({ method, params: {} }), null)).error.code, "INVALID_REQUEST");
    const raw = { v: 1, id: "read", method, params: {} };
    assert.equal((await dispatcher.dispatch(auth, raw, null)).ok, true); assert.equal(calls.admission, 0);
    state.draining = true; state.denyAdmission = true;
    assert.equal((await dispatcher.dispatch(auth, raw, null)).error.code, "BROKER_UNAVAILABLE");
    assert.equal(calls.effects.length, 0);
  }
});

test("P1 public validation: failed current-state observation is never treated as authorization", async () => {
  const { dispatcher, auth, state, calls, StoreError } = fixture();
  state.observationError = new StoreError("STORE_CORRUPT", "cannot observe actor");
  assert.throws(() => dispatcher.preflight(auth, request()), error => error === state.observationError);
  assert.equal((await dispatcher.dispatch(auth, request(), body())).error.code, "STORE_CORRUPT");
  assert.equal(calls.effects.length, 0);
});


test("P1 public validation: bundle-omitted submission without a stream remains valid", async () => {
  const { dispatcher, auth, calls } = fixture();
  const result = await dispatcher.dispatch(auth, request({ params: {} }), null);
  assert.equal(result.ok, true); assert.equal(calls.effects.length, 1);
  assert.equal(calls.actors, 1); assert.equal(calls.admission, 1);
});

test("P11 public mail.send without approval does not inspect the operation ledger", async () => {
  const { dispatcher, auth, state, calls } = fixture();
  state.throwOnOperationCheck = true;
  const raw = request({ method: "mail.send", params: { to: [], subject: "subject", kind: "message", body: "body" } });
  const result = await dispatcher.dispatch(auth, raw, null);
  assert.equal(result.ok, true);
  assert.equal(calls.operationChecks, 0);
});

test("P11 public mail.send approval checks the ledger before Git publication", async () => {
  const { dispatcher, auth, calls } = fixture();
  const raw = request({ method: "mail.send", params: { to: [], subject: "subject", kind: "message", body: "body", approvalFor: { candidate: "candidate" } } });
  const result = await dispatcher.dispatch(auth, raw, null);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "CANDIDATE_NOT_PUBLISHED");
  assert.deepEqual(calls.order, ["operation", "published"]);
  assert.equal(calls.effects.length, 0);
});
