import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AuthContext } from "@oma/contracts";
import { Store } from "@oma/storage";
import { operationPlanCheck } from "@oma/domain/durable";
import { assertActorIdentity, assertCurrentActor } from "@oma/domain/authority";
import { generateOperationId } from "@oma/native/identity";
import { resolvedSpecDigest } from "@oma/domain/spec-identity";
import { residentUnitsFor } from "@oma/domain/derived";
import { LifecycleModule } from "@oma/lifecycle";
import { ReconcileModule } from "@oma/reconcile";
import { ProcessLock } from "@oma/native/process-lock";
import { makeValidAgent, makeValidResolvedSpec } from "./fixtures/spec.js";
import { makeValidMessagePlan } from "./fixtures/valid.js";
import { lifecycleReplayFixture } from "./fixtures/lifecycle-replay.js";

test("V03-S1: durable plan owner itself rejects a mismatched resolved spec digest", () => {
  const operationId = generateOperationId();
  const spec = makeValidResolvedSpec("bob");
  const check = operationPlanCheck("agent.create", {
    operationId,
    actor: "alice",
    stateRoot: "/fixture",
    repositoryIdentity: { society: "fixture" },
  });
  const plan = {
    kind: "agent.create",
    spec,
    specHash: resolvedSpecDigest(spec),
    parent: "alice",
    workspacePath: "/fixture/agents/bob/workspace",
    unitNames: residentUnitsFor("fixture", "bob"),
    existingCreation: null,
    initialMessage: makeValidMessagePlan(operationId, { recipient: "bob" }),
  };
  assert.equal(check(plan), null);
  assert.equal(
    check({ ...plan, specHash: "f".repeat(64) }),
    "resolved spec hash mismatch",
  );
});

test("V03-S2: acceptance authority owner checks durable capability independently of a permissive live lease", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-authority-owner-"));
  const store = new Store(join(root, "runtime.sqlite"));
  try {
    store.transaction((tx) =>
      tx.insertAgent(makeValidAgent("alice", { capabilities: [] })),
    );
    const auth: AuthContext = {
      actor: "alice",
      role: "resident",
      channel: "actor",
      incarnation: 1,
      capabilities: new Set(["mail.send"]),
      peer: { pid: process.pid, uid: 1000, gid: 1000 },
    };
    assert.equal(assertActorIdentity(store, auth).name, "alice");
    assert.doesNotThrow(() => assertCurrentActor(store, auth));
    assert.throws(() => assertCurrentActor(store, auth, "mail.send"), {
      code: "CAPABILITY_DENIED",
    });
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("V03-S3: Store update owner forbids every retired state exit without workflow help", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-retired-owner-"));
  const store = new Store(join(root, "runtime.sqlite"));
  try {
    store.transaction((tx) =>
      tx.insertAgent(makeValidAgent("alice", { desired: "retired" })),
    );
    for (const desired of ["enabled", "stopped", "provisioning"] as const) {
      assert.throws(
        () =>
          store.transaction((tx) => tx.updateAgent({ name: "alice", desired })),
        { code: "INVALID_REQUEST" },
      );
      assert.equal(store.getAgent("alice")?.desired, "retired");
    }
    assert.doesNotThrow(() =>
      store.transaction((tx) =>
        tx.updateAgent({ name: "alice", desired: "retired" }),
      ),
    );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("P08: missing activation gates fail at construction and an explicit closed gate emits no start effect", async () => {
  const f = lifecycleReplayFixture();
  try {
    const paths = {
      stateRoot: f.root,
      projectGit: join(f.root, "project.git"),
      society: "replay",
      hasGoal: () => true,
    };
    assert.throws(
      () =>
        Reflect.construct(LifecycleModule, [
          f.store,
          f.units,
          paths,
          () => null,
        ]),
      { code: "UNSUPPORTED_PROFILE" },
    );
    assert.throws(
      () =>
        Reflect.construct(ReconcileModule, [
          f.store,
          null,
          null,
          null,
          f.units,
          f.lifecycle,
          { projectGit: paths.projectGit },
        ]),
      { code: "UNSUPPORTED_PROFILE" },
    );
    f.controls.allowActivation = false;
    (await assert.rejects(async () => (await f.lifecycle.start(f.auth, "a", "closed")), {
      code: "AGENT_NOT_READY",
    }));
    assert.equal(f.store.getOperation("manager", "closed"), null);
    assert.deepEqual(f.units.effects, []);
    f.controls.allowActivation = true;
    assert.equal((await f.lifecycle.start(f.auth, "a", "open")).state, "succeeded");
    assert.equal(f.units.effects.length, 1);
  } finally {
    f.close();
  }
});

test("A02: a second same-process lock open cannot borrow the first descriptor's authority", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-single-lock-"));
  const path = join(root, "broker.lock");
  const first = ProcessLock.acquire(path);
  try {
    assert.throws(() => ProcessLock.acquire(path), {
      code: "BROKER_UNAVAILABLE",
    });
    first.assertHeld(path);
  } finally {
    first.close();
  }
  try {
    const next = ProcessLock.acquire(path);
    next.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
