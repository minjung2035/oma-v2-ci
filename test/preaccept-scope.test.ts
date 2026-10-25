import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "@oma/storage";
import { PreparationExecutor } from "@oma/process/preparation";
import type { CommandSpec } from "@oma/process/command";
import { makeValidAgent } from "./fixtures/spec.js";
import { makeValidOperation } from "./fixtures/valid.js";
import { PreacceptScope, publishedArtifact } from "@oma/storage/preaccept-artifact";
import { type PreacceptOwner } from "@oma/contracts/files";

class ObservedOwner implements PreacceptOwner {
  retained = 0;
  discarded = 0;
  constructor(private readonly discardFailures = 0) {}
  retainForOperation(): void { this.retained += 1; }
  discardUnaccepted(): void {
    this.discarded += 1;
    if (this.discarded <= this.discardFailures) throw new Error("cleanup failed");
  }
}
function command(code: string): CommandSpec {
  return {
    executable: process.execPath,
    argv: ["-e", code],
    env: { PATH: process.env.PATH },
    cwd: process.cwd(),
    timeoutMs: 5000,
    stdoutBytes: 4096,
    stderrBytes: 4096,
  };
}


test("V17A: one cleanup failure does not skip another owned resource", () => {
  const failing = new ObservedOwner(1);
  const remaining = new ObservedOwner();
  const scope = new PreacceptScope();
  scope.register({ operationId: "op-a", resource: "failing", owner: failing, observe: () => "unaccepted-known" });
  scope.register({ operationId: "op-a", resource: "remaining", owner: remaining, observe: () => "unaccepted-known" });
  assert.throws(() => scope.settle());
  assert.equal(failing.discarded, 1);
  assert.equal(remaining.discarded, 1, "later cleanup was skipped");
});

test("V17A: observation uncertainty retains every preaccept resource", () => {
  const first = new ObservedOwner();
  const second = new ObservedOwner();
  const scope = new PreacceptScope();
  scope.register({ operationId: "op-a", resource: "first", owner: first, observe: () => "outcome-unknown" });
  scope.register({ operationId: "op-a", resource: "second", owner: second, observe: () => "outcome-unknown" });
  assert.deepEqual(scope.settle().map(entry => entry.disposition), ["outcome-unknown", "outcome-unknown"]);
  assert.deepEqual([first.retained, second.retained], [1, 1]);
  assert.deepEqual([first.discarded, second.discarded], [0, 0]);
});

test("V17A: uncertain native preparation quiescence retains the resource", {
  skip: process.platform !== "linux",
  timeout: 10000,
}, async () => {
  const module = await import("@oma/storage/preaccept-artifact") as Record<string, any>;
  const executor = new PreparationExecutor();
  const controller = new AbortController();
  const running = executor.run(command("setInterval(()=>{},1000)"), controller.signal);
  controller.abort();
  assert.notEqual((await running).kind, "exited");
  assert.equal(executor.quiescence, "unknown");
  const owner = new ObservedOwner();
  const scope = new module.PreacceptScope();
  scope.register({
    operationId: "op-native",
    resource: "native-tree",
    owner,
    quiescent: () => executor.quiescence === "quiescent",
    observe: () => "unaccepted-known",
  });
  assert.deepEqual(scope.settle().map((entry: any) => entry.disposition), ["outcome-unknown"]);
  assert.equal(owner.retained, 1);
  assert.equal(owner.discarded, 0);
});

test("V17A: scope preserves the primary cause, aggregates cleanup, and reports dispositions", async () => {
  const module = await import("@oma/storage/preaccept-artifact") as Record<string, any>;
  assert.equal(typeof module.PreacceptScope, "function", "PreacceptScope is not implemented");
  const root = mkdtempSync(join(tmpdir(), "oma-preaccept-scope-"));
  try {
    const path = join(root, "owned");
    writeFileSync(path, "owned");
    const scope = new module.PreacceptScope();
    const failing = new ObservedOwner(1);
    scope.register({ operationId: "op-a", resource: "failing", owner: failing,
      observe: () => "unaccepted-known" });
    scope.register({ operationId: "op-a", resource: path, owner: publishedArtifact(path),
      observe: () => "unaccepted-known" });
    const primary = new Error("admission failed");
    assert.throws(() => scope.settleFailure(primary), (error: unknown) => {
      assert.ok(error instanceof AggregateError && "report" in error);
      const settlement = error as AggregateError & { report: { disposition: string }[] };
      assert.equal(settlement.errors[0], primary);
      assert.ok(settlement.errors.some(value => value instanceof Error && value.message === "cleanup failed"));
      assert.deepEqual(settlement.report.map(entry => entry.disposition),
        ["cleanup-unconfirmed", "unaccepted-known"]);
      return true;
    });
    assert.equal(existsSync(path), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("V17A: cleanup-unconfirmed can retry once without creating new ownership", async () => {
  const module = await import("@oma/storage/preaccept-artifact") as Record<string, any>;
  const owner = new ObservedOwner(1);
  const scope = new module.PreacceptScope();
  scope.register({ operationId: "op-retry", resource: "retryable", owner,
    observe: () => "unaccepted-known" });
  assert.throws(() => scope.settle(), (error: unknown) => {
    assert.ok(error instanceof AggregateError && "report" in error);
    assert.equal((error as any).report[0].disposition, "cleanup-unconfirmed");
    return true;
  });
  assert.deepEqual(scope.settle().map((entry: any) => entry.disposition), ["unaccepted-known"]);
  assert.deepEqual(scope.settle().map((entry: any) => entry.disposition), ["unaccepted-known"]);
  assert.equal(owner.discarded, 2);
});

test("V17A: identity loss is cleanup-unconfirmed and never deletes the replacement", async () => {
  const module = await import("@oma/storage/preaccept-artifact") as Record<string, any>;
  assert.equal(typeof module.PreacceptScope, "function", "PreacceptScope is not implemented");
  const root = mkdtempSync(join(tmpdir(), "oma-preaccept-identity-"));
  try {
    const path = join(root, "owned");
    const moved = join(root, "moved");
    writeFileSync(path, "original");
    const owner = publishedArtifact(path);
    renameSync(path, moved);
    writeFileSync(path, "replacement");
    const scope = new module.PreacceptScope();
    scope.register({ operationId: "op-b", resource: path, owner,
      observe: () => "unaccepted-known" });
    assert.throws(() => scope.settle(), (error: unknown) => {
      assert.ok(error instanceof AggregateError && "report" in error);
      const settlement = error as AggregateError & { report: { disposition: string }[] };
      assert.equal(settlement.report[0]?.disposition, "cleanup-unconfirmed");
      return true;
    });
    assert.equal(existsSync(path), true);
    assert.equal(existsSync(moved), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("V17B: an accepted row that does not reference the artifact discards it", async () => {
  const module = await import("@oma/storage/preaccept-artifact") as Record<string, any>;
  assert.equal(typeof module.PreacceptScope, "function", "PreacceptScope is not implemented");
  const root = mkdtempSync(join(tmpdir(), "oma-preaccept-linked-"));
  const store = new Store(join(root, "runtime.sqlite"));
  try {
    const operation = makeValidOperation({ stateRoot: root, actor: "alice", requestKey: "linked" });
    store.transaction(() => {
      store.insertAgent(makeValidAgent("alice"));
      store.insertOperation(operation);
    });
    const path = join(root, "orphan-object");
    writeFileSync(path, "orphan");
    const scope = new module.PreacceptScope();
    scope.register({ operationId: operation.id, resource: path, owner: publishedArtifact(path),
      observe: () => store.getOperationById(operation.id) === null
        ? "unaccepted-known"
        : "accepted-unreferenced" });
    assert.deepEqual(scope.settle().map((entry: any) => entry.disposition), ["accepted-unreferenced"]);
    assert.equal(existsSync(path), false);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
