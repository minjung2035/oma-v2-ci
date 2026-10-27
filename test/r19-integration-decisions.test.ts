import { gitLedger } from "#oma-test/app/broker/git-ledger";
import { serializePlanIntent } from "./fixtures/plan.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthContext, Capability } from "@oma/contracts";
import { Store } from "@oma/storage";
import { StoreError } from "@oma/domain/errors";
import type { OperationOf } from "@oma/protocol/operation-codec";
import { generateOperationId } from "@oma/native/identity";
import { requestHash } from "@oma/domain/request-identity";
import { IntegrationCoordinator, type IntegrationEffects } from "@oma/git/integration";
import type { IntegrationPolicy, IntegrationPolicyReader } from "@oma/domain/integration-policy";
import type { GitObservation, GitProcessEvidence, ChangedPath } from "@oma/contracts/git";
import type { RefAfterCas } from "@oma/git/observe";
import { makeValidAgent } from "./fixtures/spec.js";

// Unit decision oracles use an actual Store and explicitly injected observations.
// They are not substitutes for the retained real-Git, SIGKILL or systemd suites.
const BASE = "1".repeat(40); const CANDIDATE = "2".repeat(40); const THIRD = "3".repeat(40);
const EMPTY_DIGEST = "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945";
const input = { candidate: CANDIDATE, expected: BASE };
const basePolicy = (): IntegrationPolicy => ({ policyRevision: "p1", protectedPaths: [], checks: [] });
const checkedPolicy = (): IntegrationPolicy => ({ ...basePolicy(), checks: [{ id: "trusted", argv: ["/bin/true"], env: {},
   }] });
const evidence: GitProcessEvidence = { status: 0, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
const present = <T>(value: T): GitObservation<T> => ({ kind: "present", value, evidence });
const unavailable = <T>(): GitObservation<T> => ({ kind: "unknown", reason: "injected unavailable observation", evidence: { ...evidence, status: null } });
const code = (expected: string) => (error: unknown): boolean => error instanceof StoreError && error.code === expected;

function fixture(policy: IntegrationPolicy | null = basePolicy(), reader: IntegrationPolicyReader | null = null) {
  const root = mkdtempSync(join(tmpdir(), "oma-r19-decisions-"));
  const store = new Store(join(root, "runtime.sqlite"));
  store.bindRepositoryIdentity({ society: "demo" });
  store.transaction(tx => tx.insertAgent(makeValidAgent("alice", { capabilities: ["code.integrate"] })));
  let capabilities: ReadonlySet<Capability> = new Set(["code.integrate"]);
  const auth: AuthContext = {
    actor: "alice", incarnation: 1, role: "resident", channel: "actor",
    get capabilities() { return capabilities; }, peer: { pid: 1, uid: 1000, gid: 1000 },
  };
  const calls: string[] = [];
  const model: {
    main: GitObservation<string>; published: GitObservation<readonly string[]>;
    ancestry: GitObservation<boolean>; paths: GitObservation<readonly ChangedPath[]>;
    links: GitObservation<readonly string[]>;
    cas: RefAfterCas | null; beforePaths: (() => void) | null;
  } = { main: present(BASE), published: present([CANDIDATE]), ancestry: present(true),
    paths: present([{ status: "M", path: "file.txt" }]), links: present([]), cas: null, beforePaths: null };
  const record = (name: string): void => {
    assert.equal(store.inTransaction, false, `physical observation ${name} must remain outside T-intent`);
    calls.push(name);
  };
  const effects: IntegrationEffects = {
    verifyObjectFormat: oids => { record("format"); assert.ok(oids.every(oid => /^[0-9a-f]{40}$/.test(oid))); },
    main: () => { record("main"); return model.main; },
    published: () => { record("published"); return model.published; },
    ancestry: (base, candidate) => { record("ancestry"); assert.equal(base, BASE); assert.equal(candidate, CANDIDATE); return model.ancestry; },
    changedPaths: () => { record("paths"); model.beforePaths?.(); return model.paths; },
    gitlinks: () => { record("gitlinks"); return model.links; },
    compareAndSwap: (base, candidate) => {
      record("cas"); assert.equal(base, BASE); assert.equal(candidate, CANDIDATE);
      if (model.cas !== null) return model.cas;
      model.main = present(candidate); return { kind: "candidate", oid: candidate };
    },
    runCheck: async () => { record("check"); },
  };
  return { root, store, auth, model, calls, effects,
    coordinator: new IntegrationCoordinator(gitLedger(store), effects, policy, reader),
    revoke: () => { capabilities = new Set(); },
    close: () => { store.close(); rmSync(root, { recursive: true, force: true }); },
  };
}
function operation(store: Store, key: string): OperationOf<"git.integrate"> {
  const row = store.getOperation("alice", key);
  assert.ok(row?.kind === "git.integrate"); return row;
}
function accept(store: Store, key: string): string {
  const id = generateOperationId();
  const plan = {policyIdentity: "02c010d0ad2a2e60c59a05b83368e8699b97567828b4f75ffa160dfd35b1bb70", noopRef: null,  kind: "git.integrate", repo: "project", target: "refs/heads/main", base: BASE,
    candidate: CANDIDATE, policyRevision: "p1", checkProfileDigest: EMPTY_DIGEST,
    };
  store.transaction(tx => tx.acceptOperation({ id, actor: "alice", requestKey: key, kind: "git.integrate",
    requestHash: requestHash("git.integrate", input), payloadJson: JSON.stringify(input), planJson: serializePlanIntent(plan) }));
  return id;
}

test("R19: execution writes a complete canonical plan without a redundant result and never repeats CAS on replay", async () => {
  const f = fixture();
  try {
    const receipt = await f.coordinator.execute(f.auth, "execute", input);
    assert.equal(receipt.state, "succeeded");
    assert.deepEqual(receipt.result, { kind: "git.integrate", base: BASE, candidate: CANDIDATE,
      target: "refs/heads/main", policyRevision: "p1", changed: true });
    const row = operation(f.store, "execute");
    assert.deepEqual(Object.keys(row.plan).sort(), ["base", "candidate", "checkProfileDigest", "kind", "noopRef", "policyIdentity", "policyRevision", "repo", "target"]);
    assert.equal(row.plan.checkProfileDigest, EMPTY_DIGEST);
    assert.deepEqual(f.calls, ["format", "published", "gitlinks", "main", "main", "published", "ancestry", "gitlinks", "paths",
      "main", "published", "ancestry", "gitlinks", "paths", "cas"]);
    const before = row.resultJson; const count = f.calls.length;
    assert.deepEqual(await f.coordinator.execute(f.auth, "execute", input), receipt);
    assert.equal(f.calls.length, count); assert.equal(operation(f.store, "execute").resultJson, before);
    f.revoke();
    await assert.rejects(f.coordinator.execute(f.auth, "execute", input), code("CAPABILITY_DENIED"));
    assert.equal(f.calls.length, count, "terminal replay cannot bypass current authentication");
  } finally { f.close(); }
});

for (const [condition, expected] of [["missing", "CANDIDATE_NOT_PUBLISHED"], ["ancestry", "NOT_DESCENDANT"], ["protected", "PROTECTED_PATH"]] as const) {
  test(`R19: ${condition} rejects before main CAS`, async () => {
    const f = fixture({ ...basePolicy(), protectedPaths: ["secret/"] });
    try {
      if (condition === "missing") f.model.published = present([]);
      if (condition === "ancestry") f.model.ancestry = present(false);
      if (condition === "protected") f.model.paths = present([{ status: "M", path: "secret/key" }]);
      await assert.rejects(f.coordinator.execute(f.auth, condition, input), code(expected));
      assert.equal(f.calls.includes("cas"), false); assert.deepEqual(f.model.main, present(BASE));
      if (condition === "missing") assert.equal(f.store.getOperation("alice", condition), null);
      else assert.equal(operation(f.store, condition).state, "failed");
    } finally { f.close(); }
  });
}

test("UX-09/INT-001: a candidate whose tree carries gitlinks is refused with their paths before a row exists", async () => {
  const f = fixture();
  try {
    f.model.links = present(["dep", "vendor/nested"]);
    await assert.rejects(f.coordinator.execute(f.auth, "gitlinks", input), (error: unknown) =>
      error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE" &&
      error.message.includes("dep") && error.message.includes("vendor/nested") &&
      JSON.stringify(error.details) === JSON.stringify({ paths: ["dep", "vendor/nested"] }));
    assert.equal(f.store.getOperation("alice", "gitlinks"), null, "the refusal precedes the operation row");
    assert.equal(f.calls.includes("cas"), false);
    assert.equal(f.calls.includes("check"), false, "a refused candidate never reaches a check argv");
  } finally { f.close(); }
});

for (const condition of ["unknown", "refused", "corrupt"] as const) {
  test(`UX-09: a ${condition} gitlink observation refuses — uncertain is never "no gitlinks"`, async () => {
    const f = fixture();
    try {
      f.model.links = condition === "unknown" ? unavailable()
        : condition === "refused" ? { kind: "refused" as const, reason: "injected candidate refusal", evidence }
        : { kind: "corrupt" as const, reason: "injected malformed output", evidence };
      const expected = condition === "unknown" ? "REF_STATE_UNKNOWN" : condition === "refused" ? "INVALID_REQUEST" : "STORE_CORRUPT";
      await assert.rejects(f.coordinator.execute(f.auth, `gitlinks-${condition}`, input), code(expected));
      assert.equal(f.store.getOperation("alice", `gitlinks-${condition}`), null);
      assert.equal(f.calls.includes("cas"), false);
    } finally { f.close(); }
  });
}

for (const change of ["revoke", "stop", "incarnation"] as const) {
  test(`R19: live ${change} after intent prevents the physical commit`, async () => {
    const f = fixture();
    try {
      let reads = 0;
      f.model.beforePaths = () => {
        if (++reads !== 2) return;
        if (change === "revoke") f.revoke();
        else f.store.transaction(tx => tx.updateAgent(change === "stop"
          ? { name: "alice", desired: "stopped" } : { name: "alice", incarnation: 2 }));
      };
      await assert.rejects(f.coordinator.execute(f.auth, change, input), code(change === "stop" ? "CANCELLED_BEFORE_COMMIT" : change === "revoke" ? "CAPABILITY_DENIED" : "STALE_RUN"));
      assert.equal(f.calls.includes("cas"), false); assert.deepEqual(f.model.main, present(BASE));
      assert.equal(operation(f.store, change).state, "failed");
    } finally { f.close(); }
  });
}

test("R19: a same-revision full-policy change is rejected outside the acceptance transaction", async () => {
  let reads = 0;
  const f = fixture(basePolicy(), () => { reads++; return { ...basePolicy(), protectedPaths: ["new/"] }; });
  try {
    await assert.rejects(f.coordinator.execute(f.auth, "policy", input), code("POLICY_CHANGED"));
    assert.equal(reads, 1); assert.equal(f.calls.includes("cas"), false);
    // DR8: facts the broker does not hold are refused before acceptance.
    assert.equal(f.store.getOperation("alice", "policy"), null);
  } finally { f.close(); }
});

test("R19: missing policy cannot enable a production legacyDirect path", async () => {
  const f = fixture(null);
  try {
    await assert.rejects(f.coordinator.execute(f.auth, "no-policy", input), code("UNSUPPORTED_PROFILE"));
    assert.deepEqual(f.calls, []); assert.equal(f.store.getOperation("alice", "no-policy"), null);
  } finally { f.close(); }
});

for (const scenario of ["success", "failure", "unknown", "stop", "policy", "main"] as const)
  test(`INT-004: trusted check ${scenario} is reobserved before CAS and retry preserves intent`, async t => {
    let revision = "p1";
    const f = fixture(checkedPolicy(), () => ({ ...checkedPolicy(), policyRevision: revision })); t.after(() => f.close());
    f.effects.runCheck = async (candidate, check) => {
      assert.equal(candidate, CANDIDATE); assert.equal(check.id, "trusted");
      assert.equal(f.store.inTransaction, false); assert.equal(operation(f.store, "checked").state, "pending");
      await Promise.resolve();
      f.calls.push("check");
      if (scenario === "failure") throw new StoreError("CHECK_FAILED", "check returned nonzero");
      if (scenario === "unknown") throw new StoreError("REF_STATE_UNKNOWN", "manager wait unavailable");
      if (scenario === "stop") f.store.transaction(tx => tx.updateAgent({ name: "alice", desired: "stopped" }));
      if (scenario === "policy") revision = "p2";
      if (scenario === "main") f.model.main = present(THIRD);
    };
    if (["failure", "unknown", "stop", "policy"].includes(scenario))
      await assert.rejects(f.coordinator.execute(f.auth, "checked", input), code(
        scenario === "failure" ? "CHECK_FAILED" : scenario === "unknown" ? "REF_STATE_UNKNOWN" :
          scenario === "stop" ? "CANCELLED_BEFORE_COMMIT" : "POLICY_CHANGED"));
    else {
      const receipt = await f.coordinator.execute(f.auth, "checked", input);
      assert.equal(receipt.state, scenario === "success" ? "succeeded" : "unknown");
    }
    assert.equal(f.calls.filter(value => value === "cas").length, scenario === "success" ? 1 : 0);
    const before = operation(f.store, "checked");
    if (scenario !== "stop") {
      const count = f.calls.length;
      assert.equal((await f.coordinator.execute(f.auth, "checked", input)).state, before.state);
      assert.equal(f.calls.length, count, "same-key retry does not rerun checks or CAS");
      assert.equal(operation(f.store, "checked").planJson, before.planJson);
    }
  });

for (const result of ["expected", "third", "unknown"] as const) {
  test(`R19: post-CAS ${result} remains unknown and blocks another repository writer`, async () => {
    const f = fixture();
    try {
      f.model.cas = result === "unknown" ? { kind: "unknown", observation: unavailable() }
        : { kind: result, oid: result === "expected" ? BASE : THIRD };
      const receipt = await f.coordinator.execute(f.auth, "uncertain", input);
      assert.equal(receipt.state, "unknown"); assert.equal(f.calls.filter(name => name === "cas").length, 1);
      assert.deepEqual(await f.coordinator.execute(f.auth, "uncertain", input), receipt);
      await assert.rejects(f.coordinator.execute(f.auth, "another", input), code("REF_STATE_UNKNOWN"));
      assert.equal(f.store.getOperation("alice", "another"), null);
      assert.equal(f.calls.filter(name => name === "cas").length, 1);
    } finally { f.close(); }
  });
}

{
  test("R19: recovery of canonical intent settles candidate without replaying execute", async () => {
    const f = fixture(null);
    try {
      const id = accept(f.store, "recover"); const before = operation(f.store, "recover").planJson;
      f.model.main = present(CANDIDATE);
      f.store.transaction(tx => tx.updateAgent({ name: "alice", desired: "stopped" }));
      await f.coordinator.reconcile(operation(f.store, "recover"));
      const row = operation(f.store, "recover");
      assert.equal(row.id, id); assert.equal(row.state, "succeeded"); assert.equal(row.planJson, before);
      assert.deepEqual(row.result, { kind: "git.integrate", base: BASE, candidate: CANDIDATE,
        target: "refs/heads/main", policyRevision: "p1", changed: true });
      assert.deepEqual(f.calls, ["main"], "proven effects settle without rerunning checks/CAS or requiring a new lease");
      await f.coordinator.reconcile(row);
      assert.equal(operation(f.store, "recover").resultJson, row.resultJson);
      assert.deepEqual(f.calls, ["main"]);
    } finally { f.close(); }
  });
}

test("R19: base recovery rechecks conditions twice and completes the same operation", async () => {
  const f = fixture();
  try {
    const id = accept(f.store, "base"); const before = operation(f.store, "base").planJson;
    await f.coordinator.reconcile(operation(f.store, "base"));
    assert.equal(operation(f.store, "base").id, id); assert.equal(operation(f.store, "base").state, "succeeded");
    assert.equal(operation(f.store, "base").planJson, before);
    assert.equal(f.calls.filter(name => name === "paths").length, 2); assert.equal(f.calls.filter(name => name === "cas").length, 1);
  } finally { f.close(); }
});

for (const state of ["third", "absent", "unknown"] as const) {
  test(`R19: recovery main=${state} blocks without invoking execute`, async () => {
    const f = fixture();
    try {
      accept(f.store, "recover");
      f.model.main = state === "third" ? present(THIRD) : state === "absent" ? { kind: "absent", evidence } : unavailable();
      await f.coordinator.reconcile(operation(f.store, "recover"));
      assert.equal(operation(f.store, "recover").state, "unknown"); assert.deepEqual(f.calls, ["main"]);
    } finally { f.close(); }
  });
}

test("R19: an unavailable pre-CAS observation is neither absence nor a failed physical effect", async () => {
  const f = fixture();
  try {
    f.model.ancestry = unavailable();
    await assert.rejects(f.coordinator.execute(f.auth, "pending", input), code("REF_STATE_UNKNOWN"));
    assert.equal(operation(f.store, "pending").state, "pending"); assert.equal(f.calls.includes("cas"), false);
    await assert.rejects(f.coordinator.execute(f.auth, "blocked", input), code("REF_STATE_UNKNOWN"));
    assert.equal(f.store.getOperation("alice", "blocked"), null);
  } finally { f.close(); }
});

test("P0V-64 / R09, P0-2: a refusal after acceptance that a cleanup failure was bundled with settles by its own code", async () => {
  const f = fixture();
  try {
    let asked = 0;
    f.effects.ancestry = () => {
      asked += 1;
      if (asked === 1) return present(true);
      // The execution's observation is refused, and a cleanup failed beside it.
      throw new AggregateError([new StoreError("NOT_DESCENDANT", "candidate no longer descends"), new Error("EIO while removing a temporary")]);
    };
    const coordinator = new IntegrationCoordinator(gitLedger(f.store), f.effects, basePolicy(), null);
    await assert.rejects(coordinator.execute(f.auth, "bundled", input), code("NOT_DESCENDANT"));
    const row = operation(f.store, "bundled");
    assert.equal(row.state, "failed", "the refusal was read as an internal error and left the operation pending");
    assert.equal(row.errorCode, "NOT_DESCENDANT");
    assert.equal(f.calls.includes("cas"), false);
  } finally { f.close(); }
});
