import test from "node:test";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname, posix } from "node:path";
import { tmpdir } from "node:os";
import ts from "typescript";
import { declarationSurface, mergeSurfaces, resolveExportDeclaration } from "../scripts/contract-surface.mjs";
import { analyzeProgram } from "../scripts/architecture-check.mjs";

const root = new URL("../", import.meta.url);
const read = file => readFileSync(new URL(file, root), "utf8");
const files = readdirSync(new URL("implementation/contracts/", root)).filter(file => file.endsWith(".ts")).map(file => `implementation/contracts/${file}`);
const golden = JSON.parse(read("test/fixtures/contracts-v1-surface.json"));
const additions = JSON.parse(read("test/fixtures/contracts-dr27-additions.json"));
const dr34Additions = JSON.parse(read("test/fixtures/contracts-dr34-additions.json"));
const digest = surface => createHash("sha256").update(JSON.stringify(surface)).digest("hex");
// Keep the original P2 golden intact. Only the reviewed additions are
// projected out -- IPC-008's receipt paging, DR24's model effort (an
// optional ModelProfile field and the level names it takes), and DR25's
// installed-package directory (an optional installation field); a change to
// any other declaration still fails the old digest. DR27 deltas below are
// exact anchors; new declarations have their own explicit syntax fixture.
const REVIEWED_CHANGES = Object.freeze({
  "implementation/contracts/errors.ts": [["'INTEGRATION_CONDITIONS' | ", ""],
    ["  | 'REQUEST_CLOSED' | 'REQUEST_EXISTS' | 'SELF_REVIEW' | 'APPROVAL_STALE' | 'REVERT_CONFLICT'\n", ""]],
  "implementation/contracts/durable.ts": [
    ['  | { kind: "society.set"; state: "open" | "closed" }\n  | { kind: "attest.record"; message: MessageId; recipientCount: number; archivePath: string }', ""],
    ['  | { kind: "society.set"; state: "open" | "closed" }\n  | { kind: "attest.record"; fact: LegacyAttestationInput; message: MessagePlan }', ""],
    ['  | { kind: "attest.record"; fact: ReviewFact; messages: MessagePlan[] }', ""],
    ['  | { kind: "attest.record"; request: string; messages: MessageId[]; recipientCount: number }', ""],
    ["\n  audience?: \"workers\";\n  review?: ReviewMailMeta;", ""],
    ['; merge?: { name: string; notices: MessageId[]; recipientCount: number }', ""],
    [';\n      merge?: { version: 1; request: OperationId; name: string; tier: RiskTier; notice: MessagePlan[] }', ""],
    ["; publication?: { message: MessageId; recipientCount: number; effectiveTier: RiskTier; authorityDigest: string }", ""],
    ["; publication?: { tiered: TieredAcceptance; message: MessagePlan; noopRef: string | null }", ""],
    ["; goalMail?: { subject: string }; noopRef?: string | null", ""],
  ],
  "implementation/contracts/public-wire.ts": [
    ['  "society.set": { params: { state: "open" | "closed" }; result: Receipt };', ""],
    ['  "attest.record": { params: AttestationInput; result: Receipt };', ""],
    ["'agent.wait': { params: { observe?: true };", "'agent.wait': { params: Record<string, never>;"],
    ["expected: Oid; tier?: RiskTier", "expected: Oid"],
    ["content: BlobDescriptor; goalMail?: { subject: string }", "content: BlobDescriptor"],
    ["  'operation.read': { params: { key: RequestKey; offset: number; sha256?: string }; result: { sha256: string; bytes: number; offset: number; data: string; next: number | null } };", ""],
    ["params: { agent?: Actor; after?: Actor }; result: { observedAtMs: number; agents: AgentStatus[]; next?: Actor }", "params: { agent?: Actor }; result: { observedAtMs: number; agents: AgentStatus[] }"],
    ["'operation.get' | 'operation.read' | 'status.get'", "'operation.get' | 'status.get'"],
    [" | 'review.status'", ""],
    ["\n  /** mail-v1 §8: the read model over the review ledger. Workers see every\n   * request; the Principal sees only a request its approval mail named (or an\n   * applied one), and only the fields the approval flow already gave it. */\n  'review.status': { params: { name?: string }; result: ReviewStatusResult };", ""],
  ],
  "implementation/contracts/host.ts": [
    ["    tiered?: TieredPolicy;", ""],
    ["\n/** The effort levels the engine runs a model with, as it names them. */\nexport type EffortLevel = \"off\" | \"minimal\" | \"low\" | \"medium\" | \"high\" | \"xhigh\" | \"max\";\n", ""],
    ["\n  /** DR24: the effort the model runs with; the engine's default when absent. */\n  thinking?: EffortLevel;", ""],
    ["; deploymentDigest: string; packages?: string };", "; deploymentDigest: string };"],
    ["\n  egress?: HostEgressConfig;", ""],
  ],
});
/** DR24's model effort level and DR34's egress clause are the public names the
 * reviewed additions export. */
const REVIEWED_NAMES = Object.freeze(["EffortLevel", "HostEgressConfig"]);
/** Additions declared with `export type` (the rest are `export interface`). */
const ADDITION_TYPE_NAMES = new Set(["PrincipalDecision", "AttestationInput", "LegacyAttestationInput", "ReviewInput", "ReviewFact", "ReviewMailMeta", "ReviewStatusResult"]);
function beforeReviewedChanges(text, file) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  for (const node of [...source.statements].reverse()) {
    const expected = node.name && (additions[node.name.text] ?? dr34Additions[node.name.text]);
    if (expected === undefined) continue;
    assert.deepEqual(declarationSurface(node.getText(source), file), declarationSurface(expected, file),
      `DR27 declaration changed: ${node.name.text}`);
    text = text.slice(0, node.getStart(source)) + text.slice(node.end);
  }
  const changes = REVIEWED_CHANGES[file];
  if (changes === undefined) return text;
  for (const [added, prior] of changes) {
    assert.equal(text.split(added).length, 2, `reviewed wire delta changed: ${added}`);
    text = text.replace(added, prior);
  }
  return text;
}
const surfaces = () => mergeSurfaces(files.map(file => declarationSurface(beforeReviewedChanges(read(file), file), file)));

test("P2 contracts: every public and private v1 declaration retains its exact normalized syntax", () => {
  assert.equal(digest(surfaces()), golden.declarationsSha256);
  assert.equal(Object.keys(surfaces()).length, golden.declarationCount);
});
test("DR27 contracts: every explicit addition is present and changes cannot hide in the projection", () => {
  const actual = mergeSurfaces(files.map(file => declarationSurface(read(file), file)));
  for (const [name, expected] of Object.entries({ ...additions, ...dr34Additions })) {
    assert.deepEqual(actual[name], declarationSurface(expected, "fixture.ts")[name], name);
    const file = files.find(file => Object.hasOwn(declarationSurface(read(file), file), name));
    const changed = read(file).replace(`export ${ADDITION_TYPE_NAMES.has(name) ? "type" : "interface"} ${name}`,
      `declare ${ADDITION_TYPE_NAMES.has(name) ? "type" : "interface"} ${name}`);
    assert.throws(() => beforeReviewedChanges(changed, file), { code: "ERR_ASSERTION" }, name);
  }
  for (const [file, changes] of Object.entries(REVIEWED_CHANGES)) {
    for (const [added] of changes) assert.throws(() => beforeReviewedChanges(read(file).replace(added, ""), file), { code: "ERR_ASSERTION" });
  }
});
test("P2 contracts: optionality, field values, and private envelope changes are detected", () => {
  for (const [file, before, after] of [
    ["implementation/contracts/values.ts", "profile?: never", "profile?: string"],
    ["implementation/contracts/public-wire.ts", "v: 1; id: string", "v: 2; id: string"],
    ["implementation/contracts/durable.ts", "stagingPath: string", "stagingPath?: string"],
  ]) {
    assert.ok(read(file).includes(before));
    const changed = mergeSurfaces(files.map(current => declarationSurface(beforeReviewedChanges(current === file ? read(current).replace(before, after) : read(current), current), current)));
    assert.notEqual(digest(changed), golden.declarationsSha256, file);
  }
});
test("P2 contracts: facade exports exactly the existing public names with no executable statements", () => {
  const source = ts.createSourceFile("facade.ts", read("implementation/contracts.ts"), ts.ScriptTarget.Latest, true);
  const names = [];
  for (const statement of source.statements) {
    assert.ok(ts.isExportDeclaration(statement) && statement.isTypeOnly);
    assert.ok(statement.exportClause && ts.isNamedExports(statement.exportClause));
    for (const item of statement.exportClause.elements) names.push(item.name.text);
  }
  assert.equal(new Set(names).size, names.length);
  for (const name of REVIEWED_NAMES) assert.ok(names.includes(name), `reviewed export ${name} is missing`);
  assert.deepEqual(names.filter(name => !REVIEWED_NAMES.includes(name)).sort(), golden.exportedNames);
});
test("P2 contracts: leaf definitions have an acyclic owner graph and cannot import the facade or module ports", () => {
  const leaves = files.filter(file => !file.endsWith("/module-contracts.ts"));
  const graph = new Map(leaves.map(file => [file, []]));
  for (const file of leaves) {
    const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
    const visit = node => {
      let literal;
      if (ts.isImportDeclaration(node)) {
        assert.ok(node.importClause?.isTypeOnly, `${file}: runtime import`);
        literal = node.moduleSpecifier;
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) literal = node.argument.literal;
      if (literal && ts.isStringLiteral(literal)) {
        const target = posix.normalize(posix.join(posix.dirname(file), literal.text)).replace(/\.js$/, ".ts");
        assert.notEqual(target, "implementation/contracts.ts");
        assert.notEqual(target, "src/module-ports.ts");
        if (graph.has(target)) graph.get(file).push(target);
      }
      ts.forEachChild(node, visit);
    }; visit(source);
  }
  const active = new Set(), done = new Set();
  const visit = file => {
    assert.ok(!active.has(file), `type dependency cycle at ${file}`);
    if (done.has(file)) return;
    active.add(file); for (const target of graph.get(file)) visit(target);
    active.delete(file); done.add(file);
  };
  for (const file of graph.keys()) visit(file);
});
test("P2 contracts: architecture exhaustiveness follows type re-exports instead of declaration location", () => {
  const directory = mkdtempSync(join(tmpdir(), "oma-contract-export-"));
  try {
    const fixture = {
      "implementation/contracts.ts": 'export type { PublicMethods, InternalMethods, OperationPlan } from "./owners.js";',
      "implementation/owners.ts": 'export interface PublicMethods { sample: unknown }; export interface InternalMethods {}; export type OperationPlan = { kind: "a" } | { kind: "b" };',
      "src/protocol/methods.ts": 'export const PUBLIC_METHODS = { sample: {} }; export const INTERNAL_METHODS = {};',
      "src/registry.ts": 'const codec = { planCheck() {}, resultCheck() {}, relationsCheck() {} }; export const OPERATION_CODECS = { a: codec, b: codec };',
    };
    const names = Object.entries(fixture).map(([file, text]) => { const target = join(directory, file); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, text); return target; });
    const make = () => ts.createProgram(names, { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, noLib: true, noEmit: true });
    let program = make();
    const relevant = () => analyzeProgram(program, { rootDir: directory }).filter(item => ["operation-exhaustiveness", "method-exhaustiveness"].includes(item.rule));
    assert.deepEqual(relevant(), []);
    assert.equal(resolveExportDeclaration(program.getTypeChecker(), program.getSourceFile(names[0]), "OperationPlan")?.name.text, "OperationPlan");
    writeFileSync(names[3], fixture["src/registry.ts"].replace("a: codec, b: codec", "a: codec"));
    program = make();
    assert.ok(relevant().some(item => item.rule === "operation-exhaustiveness"));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
