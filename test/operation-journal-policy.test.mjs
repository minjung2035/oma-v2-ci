import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import ts from "typescript";
import { StoreError } from "@oma/domain/errors";
import { reused } from "@oma/domain/request-identity";

// Execute the actual mechanism with controlled transition collaborators and
// its declared domain dependency. SQLite characterization remains separate.
const code = ts.transpileModule(readFileSync("packages/storage/src/operation-journal.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS },
}).outputText;
const module = { exports: {} };
new Script(code).runInNewContext({ module, exports: module.exports,
  require(name) {
    assert.ok(["@oma/domain/errors", "@oma/domain/request-identity"].includes(name), name);
    return name === "@oma/domain/errors" ? { StoreError } : { reused };
  },
});
const { OperationJournal } = module.exports;

function fixture() {
  let live = false, row = null, insertError = null, racedRow = null;
  const calls = [];
  const scope = { requireLive() { if (!live) throw new StoreError("INTERNAL_ERROR", "expired"); } };
  const read = {
    operation(actor, key) { calls.push(["get", actor, key]); return row; },
    operationById(id) { calls.push(["getById", id]); return row; },
    recoverableIds() { calls.push(["recoverableIds"]); return ["id"]; },
  };
  const write = Object.fromEntries(["insert", "updatePlan", "succeed", "fail", "unknown"].map(name => [name, (...args) => {
    scope.requireLive(); calls.push([name, ...args]);
    if (name === "insert" && insertError) { row = racedRow; throw insertError; }
  }]));
  return { journal: new OperationJournal(read, write, scope), calls,
    live(value) { live = value; }, row(value) { row = value; },
    race(error, next) { insertError = error; racedRow = next; } };
}
const input = Object.freeze({ id: "id", actor: "alice", requestKey: "key", requestHash: "hash",
  kind: "route.follow", payloadJson: '{"topic":"dev"}', planJson: '{"kind":"route.follow"}' });

test("P3 Journal: classify is read-only and preserves retry/reused/absence", () => {
  const f = fixture();
  assert.equal(f.journal.classifyKey("alice", "key", "hash"), "absent");
  f.row({ requestHash: "hash" });
  assert.equal(f.journal.classifyKey("alice", "key", "hash"), "retry");
  assert.equal(f.journal.classifyKey("alice", "key", "other"), "reused");
  assert.ok(f.calls.every(call => call[0] === "get"));
});

test("P3 Journal: accept requires the live scope even for an exact retry", () => {
  const f = fixture(); f.row({ requestHash: "hash" });
  assert.throws(() => f.journal.accept(input), { code: "INTERNAL_ERROR" });
  assert.equal(f.calls.length, 0);
  f.live(true); assert.equal(f.journal.accept(input), "retry");
  assert.deepEqual(f.calls, [["get", "alice", "key"]]);
});

test("P3 Journal: acceptance inserts once without changing frozen bytes", () => {
  const f = fixture(); f.live(true);
  assert.equal(f.journal.accept(input), "inserted");
  assert.deepEqual(f.calls, [["get", "alice", "key"], ["insert", input]]);
  assert.equal(f.calls[1][1], input);
});

test("P3 Journal: a different hash is rejected before insert", () => {
  const f = fixture(); f.live(true); f.row({ requestHash: "other" });
  assert.throws(() => f.journal.accept(input), {
    code: "REQUEST_KEY_REUSED", message: reused("alice", "key").message,
  });
  assert.equal(f.calls.filter(call => call[0] === "insert").length, 0);
});

for (const matching of [true, false]) test(`P3 Journal: unique-key winner is re-observed, matching=${matching}`, () => {
  const f = fixture(); f.live(true);
  f.race(new StoreError("REQUEST_KEY_REUSED", "unique"), { requestHash: matching ? "hash" : "other" });
  if (matching) assert.equal(f.journal.accept(input), "retry");
  else assert.throws(() => f.journal.accept(input), { code: "REQUEST_KEY_REUSED" });
  assert.deepEqual(f.calls.map(call => call[0]), ["get", "insert", "get"]);
});

test("P3 Journal: non-key failures propagate unchanged", () => {
  const f = fixture(); f.live(true); const error = new StoreError("STORE_CORRUPT", "broken");
  f.race(error, null);
  assert.throws(() => f.journal.accept(input), value => value === error);
  assert.equal(f.calls.length, 2);
});

test("P3 Journal: transition methods delegate to the existing single owner", () => {
  const f = fixture(); f.live(true);
  f.journal.prepare("id", "frozen plan"); f.journal.succeed("id", "frozen result");
  f.journal.fail("id", "CHECK_FAILED"); f.journal.markUnknown("id");
  assert.deepEqual(f.calls, [["updatePlan", "id", "frozen plan"], ["succeed", "id", "frozen result"],
    ["fail", "id", "CHECK_FAILED"], ["unknown", "id"]]);
  f.live(false);
  for (const action of [() => f.journal.insert(input), () => f.journal.prepare("id", "{}"),
    () => f.journal.succeed("id", "{}"), () => f.journal.fail("id", "CHECK_FAILED"), () => f.journal.markUnknown("id")])
    assert.throws(action, { code: "INTERNAL_ERROR" });
});

test("P3 Journal: readers preserve decoded object identity and recoverable order", () => {
  const f = fixture(); const row = Object.freeze({ id: "id" }); f.row(row);
  assert.equal(f.journal.get("alice", "key"), row);
  assert.equal(f.journal.getById("id"), row);
  assert.deepEqual(f.journal.recoverableIds(), ["id"]);
});

test("P3 Journal: mechanism has no SQL, callback workflow, or effect import", () => {
  const source = ts.createSourceFile("journal.ts", readFileSync("packages/storage/src/operation-journal.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const imports = source.statements.filter(ts.isImportDeclaration)
    .filter(node => !node.importClause?.isTypeOnly).map(node => node.moduleSpecifier.text);
  assert.deepEqual(imports, ["@oma/domain/errors", "@oma/domain/request-identity"]);
  const calls = [];
  const visit = node => { if (ts.isCallExpression(node)) calls.push(node.expression.getText(source)); ts.forEachChild(node, visit); };
  visit(source);
  assert.ok(calls.every(name => /^(?:this\.(?:read\.(?:operation|operationById|recoverableIds)|write\.(?:insert|updatePlan|succeed|fail|unknown)|scope\.requireLive|get|classifyKey|insert)|reused)$/.test(name)), calls.join("\n"));
});
