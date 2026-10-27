/** P3: explicit routing tests with controlled physical owners.
 * Method bodies come from production source. This is not systemd/crash proof.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { StoreError } from "@oma/domain/errors";
import { assertNever } from "@oma/domain/exhaustive";
import { PUBLIC_METHODS } from "@oma/protocol/methods";
import { preacceptEvent } from "@oma/reconcile/preaccept-event";

const kinds = Object.entries(PUBLIC_METHODS).filter(([, entry]) => entry.mode === "mutation").map(([kind]) => kind);
function method(file, className, name) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const cls = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className);
  const node = cls?.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === name);
  assert.ok(node, `${file}:${className}.${name}`);
  return { node, source, text: node.getText(source) };
}
const recover = method("packages/reconcile/src/index.ts", "ReconcileModule", "recover");
const startup = method("packages/reconcile/src/index.ts", "ReconcileModule", "startup");
const gitReconcile = method("packages/git/src/index.ts", "GitModule", "reconcile");
function switchOf(entry) {
  let found;
  function walk(node) {
    if (ts.isSwitchStatement(node) && node.expression.getText(entry.source) === "operation.kind") found = node;
    ts.forEachChild(node, walk);
  }
  walk(entry.node);
  assert.ok(found, "production method must contain an explicit kind switch");
  return found;
}
function harness(entries, globals) {
  const source = `export class Harness { ${entries.map(entry => entry.text).join("\n")} }`;
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS } }).outputText;
  const context = { exports: {}, StoreError, assertNever, ...globals };
  vm.runInNewContext(js, context, { timeout: 1000 });
  return new context.exports.Harness();
}
function fixture() {
  const calls = [];
  const value = harness([recover, startup], {
    observeStoreFailure: () => {},
    recoveryCategory: kind => kind,
    // DR10: startup's collection of artifacts made before an acceptance.
    collectUnacceptedArtifacts: () => { calls.push(["collect"]); return { removed: [], kept: [] }; },
    // fix/fj: startup reports the collection through this pure event builder;
    // the empty fixture collection returns null before console is touched.
    preacceptEvent, console,
    dirname: path => path,
  });
  Object.assign(value, {
    effects: { observeStoreFailure() {}, assertCanonicalHealthy: async () => { calls.push(["health"]); }, collectUnacceptedArtifacts() { calls.push(["collect"]); return { removed: [], kept: [] }; } },
    starting: false, inFlight: null, mail: { reconcileOperation: async id => { calls.push(["mail", id]); } }, paths: {},
    activation: allowed => allowed, admit: () => () => undefined,
    lifecycle: {
      reconcileSociety: id => { calls.push(["society", id]); },
      reconcileCreate: async (id, allowed) => { calls.push(["create", id, allowed]); },
      reconcileAction: (id, allowed) => { calls.push(["action", id, allowed]); },
    },
    git: { reconcile: async id => { calls.push(["git", id]); } },
    reviews: { advanceAll: async () => { calls.push(["reviews"]); } },
    quiesceResidents: () => { calls.push(["quiesce"]); },
    retainRecoveryFailure: error => { throw error; },
  });
  return { value, calls };
}

test("P3 recovery: physical owners retain every existing route and activation flag", async () => {
  for (const kind of kinds) {
    const { value, calls } = fixture();
    if (["mail.ack", "route.follow", "route.unfollow"].includes(kind)) {
      await assert.rejects(value.recover({ id: kind, kind, state: "pending" }, false), { code: "UNSUPPORTED_PROFILE" });
      assert.deepEqual(calls, []);
      continue;
    }
    await value.recover({ id: kind, kind, state: "pending" }, false);
    const expected = kind === "agent.create" ? ["create", kind, false]
      : ["agent.start", "agent.stop"].includes(kind) ? ["action", kind, false]
      : kind === "society.set" ? ["society", kind]
      : ["attest.record", "mail.send", "agent.continue"].includes(kind) ? ["mail", kind] : ["git", kind];
    assert.deepEqual(calls, [expected]);
  }
});

test("P3 recovery: missing Git owner remains gated without a fallback effect", async () => {
  const { value, calls } = fixture();
  value.git = null;
  await assert.rejects(value.recover({ id: "x", kind: "git.submit", state: "pending" }, true), { code: "UNSUPPORTED_PROFILE" });
  assert.deepEqual(calls, []);
});

test("P3 recovery: startup keeps quiesce/health/requiesce and distinct DB-only handling", async () => {
  const { value, calls } = fixture();
  value.store = {
    path: "/state/runtime.sqlite",
    recoverableOperations: () => kinds,
    getOperationById: id => ({ id, kind: id, state: "pending" }),
  };
  await value.startup(false, async () => { calls.push(["prepare"]); });
  // DR10: the collection runs after the quiesce and before anything is prepared.
  assert.deepEqual(calls.slice(0, 5), [["quiesce"], ["collect"], ["health"], ["quiesce"], ["prepare"]]);
  // mail-v1: startup ends with a reviews advance sweep for requests that
  // became ready while the broker was down.
  assert.deepEqual(calls.at(-1), ["reviews"]);
  const physical = calls.slice(5, -1);
  assert.equal(physical.length, kinds.length - 3);
  assert.deepEqual(physical, kinds.filter(kind => !["mail.ack", "route.follow", "route.unfollow"].includes(kind)).map(kind =>
    kind === "agent.create" ? ["create", kind, false]
      : ["agent.start", "agent.stop"].includes(kind) ? ["action", kind, false]
      : kind === "society.set" ? ["society", kind]
      : ["attest.record", "mail.send", "agent.continue"].includes(kind) ? ["mail", kind] : ["git", kind]));
  assert.ok(physical.every(call => !["mail.ack", "route.follow", "route.unfollow"].includes(call[1])));
  assert.equal(value.starting, false);
});

test("P3 recovery: Git routes its three kinds and explicitly ignores other existing kinds", async () => {
  for (const kind of kinds) {
    const calls = [];
    const value = harness([gitReconcile], {});
    Object.assign(value, {
      store: { getOperationById: () => ({ id: kind, kind, state: "unknown" }) },
      withWriter: async work => work(),
      integrationCoordinator: { reconcile: async operation => { calls.push(["integrate", operation.id]); } },
      submissionCoordinator: { reconcile: async operation => { calls.push(["submit", operation.id]); } },
      contextCoordinator: { reconcile: async operation => { calls.push(["context", operation.id]); } },
    });
    await value.reconcile(kind);
    const owner = { "git.integrate": "integrate", "git.submit": "submit", "context.publish": "context" }[kind];
    assert.deepEqual(calls, owner ? [[owner, kind]] : []);
  }
});

test("P3 recovery: bypassing the closed decoder never turns an unknown kind into success", async () => {
  const { value, calls } = fixture();
  await assert.rejects(value.recover({ id: "bad", kind: "unregistered.kind", state: "pending" }, true), /unhandled closed variant/);
  assert.deepEqual(calls, []);
});

function diagnostics(entry, { extraKind = false, omitKind } = {}) {
  const actual = switchOf(entry);
  const cases = actual.caseBlock.clauses.filter(ts.isCaseClause);
  const names = cases.map(clause => clause.expression.text);
  assert.equal(new Set(names).size, names.length, "duplicate closed-kind case");
  assert.deepEqual([...names].sort(), [...kinds].sort(), "case coverage must derive from current wire mutation vocabulary");
  const fallback = actual.caseBlock.clauses.find(ts.isDefaultClause);
  assert.ok(fallback && /assertNever\(/.test(fallback.getText(entry.source)), "default must prove never");
  const dir = mkdtempSync(join(process.cwd(), "test", ".recovery-types-"));
  try {
    const file = join(dir, "fixture.ts");
    const body = cases.filter(clause => clause.expression.text !== omitKind)
      .map(clause => `case ${clause.expression.getText(entry.source)}: return;`).join("\n");
    const extra = extraKind ? ' | { id: string; kind: "fixture.new"; state: "pending" }' : "";
    const row = entry === recover
      ? `{ id: string; kind: MutationMethod${extraKind ? ' | "fixture.new"' : ""}; state: "pending" }`
      : `DecodedOperation${extra}`;
    writeFileSync(file, `
      import type { MutationMethod } from "../../packages/contracts/src/durable.js";
      import type { DecodedOperation } from "@oma/protocol/operation-codec";
      import { assertNever } from "../../packages/domain/src/exhaustive.js";
      export function check(operation: ${row}): void {
        switch (operation.kind) {
          ${body}
          ${fallback.getText(entry.source)}
        }
      }
    `);
    const program = ts.createProgram([file], {
      noEmit: true, target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true,
      noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, skipLibCheck: true,
    });
    return ts.getPreEmitDiagnostics(program).filter(value => value.category === ts.DiagnosticCategory.Error);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test("P3 recovery: actual case/default coverage compiles, missing/new kinds fail semantic checking", () => {
  for (const entry of [recover, startup, gitReconcile]) {
    assert.deepEqual(diagnostics(entry).map(error => ts.flattenDiagnosticMessageText(error.messageText, "\n")), []);
    for (const mutation of [{ extraKind: true }, { omitKind: "git.submit" }]) {
      const errors = diagnostics(entry, mutation);
      assert.ok(errors.some(error => error.code === 2345), "unhandled kind must fail assertNever");
      assert.ok(errors.every(error => error.code === 2345), "unrelated type errors cannot stand in for an exhaustiveness oracle");
    }
  }
});
