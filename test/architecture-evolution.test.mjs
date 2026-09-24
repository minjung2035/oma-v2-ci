import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import ts from "typescript";
import {
  createArchitectureProgram,
  graphFromProgram,
} from "../scripts/dependency-graph.mjs";
import { KERNEL_ZONES, kernelFindings } from "../scripts/kernel-zones.mjs";
import {
  declarationSurface,
  resolveExportDeclaration,
} from "../scripts/contract-surface.mjs";

const root = process.cwd();
const baseline = createArchitectureProgram();
const read = (file) => readFileSync(resolve(root, file), "utf8");
const snapshots = JSON.parse(read("test/fixtures/architecture-surfaces.json"));
const wire = "implementation/contracts/public-wire.ts";
const durable = "implementation/contracts/durable.ts";
const methods = "src/protocol/methods.ts";
const publicDispatcher = "src/broker/public-dispatcher.ts";
const response = "src/protocol/response-codec.ts";
const codec = "src/storage/operation-codec.ts";
const validate = "src/validate.ts";

// All mutations stay in compiler memory. Production files and v1 fixtures are untouched.
function programWith(overrides) {
  const options = baseline.getCompilerOptions();
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (file, version, ...rest) => {
    const key = relative(root, file).replaceAll("\\", "/");
    return Object.hasOwn(overrides, key)
      ? ts.createSourceFile(file, overrides[key], version, true)
      : original(file, version, ...rest);
  };
  return ts.createProgram({
    options,
    host,
    rootNames: [
      ...new Set([
        ...baseline.getRootFileNames(),
        ...Object.keys(overrides).map((file) => resolve(root, file)),
      ]),
    ],
  });
}
function replaceOnce(text, before, after) {
  assert.equal(
    text.split(before).length,
    2,
    `mutation anchor must be unique: ${before}`,
  );
  return text.replace(before, after);
}
const errors = (program) =>
  ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.category === ts.DiagnosticCategory.Error);
const message = (diagnostic) =>
  ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
const hasError = (diagnostics, file, code, text) =>
  diagnostics.some(
    (d) =>
      d.file?.fileName === resolve(root, file) &&
      d.code === code &&
      message(d).includes(text),
  );
function interfaceSurface(text, file) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  return declarationSurface(
    source.statements
      .filter(ts.isInterfaceDeclaration)
      .map((node) => node.getText(source))
      .join("\n"),
    file,
  );
}
function literalKinds(type) {
  return (type.isUnion() ? type.types : [type])
    .map((part) => {
      assert.ok(part.isStringLiteral());
      return part.value;
    })
    .sort();
}
function assertOperationClosure(program) {
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(resolve(root, durable));
  const type = (name) =>
    checker.getTypeAtLocation(resolveExportDeclaration(checker, source, name));
  const kinds = literalKinds(type("MutationMethod"));
  const results = literalKinds(
    checker.getTypeOfSymbolAtLocation(
      type("OperationResult").getProperty("kind"),
      source,
    ),
  );
  assert.deepEqual(results, kinds, "operation result kind closure");
  const codecs = checker.getTypeAtLocation(
    resolveExportDeclaration(
      checker,
      program.getSourceFile(resolve(root, codec)),
      "OPERATION_CODECS",
    ),
  );
  assert.deepEqual(
    codecs
      .getProperties()
      .map((property) => property.name)
      .sort(),
    kinds,
    "operation codec closure",
  );
  const validator = program
    .getSourceFile(resolve(root, validate))
    .statements.find(
      (node) =>
        ts.isFunctionDeclaration(node) &&
        node.name?.text === "operationResultCheck",
    );
  const cases = validator.body.statements
    .find(ts.isSwitchStatement)
    .caseBlock.clauses.filter(ts.isCaseClause);
  assert.deepEqual(
    cases.map((clause) => clause.expression.text).sort(),
    kinds,
    "operation result validator closure",
  );
}

test("P22 positive control: current production compiles and has closed operation/dispatch surfaces", () => {
  assert.equal(ts.version, "5.9.3");
  assert.deepEqual(errors(baseline).map(message), []);
  assertOperationClosure(baseline);
  for (const [file, expected] of Object.entries(snapshots.dispatch))
    assert.deepEqual(interfaceSurface(read(file), file), expected);
});

test("P22 A: adding a public read method requires DTO, descriptor, handler and response decoder", () => {
  const changedWire = replaceOnce(
    replaceOnce(
      read(wire),
      "export interface PublicMethods {",
      'export interface PublicMethods {\n  "probe.read": { params: Record<string, never>; result: { accepted: boolean } };',
    ),
    "export type ReadMethod =",
    'export type ReadMethod = "probe.read" |',
  );
  const changes = { [wire]: changedWire };
  assert.ok(
    hasError(errors(programWith(changes)), methods, 1360, "probe.read"),
    "DTO alone must not bypass descriptor closure",
  );
  changes[methods] = replaceOnce(
    read(methods),
    "export const PUBLIC_METHODS = {",
    'export const PUBLIC_METHODS = {\n  "probe.read": { mode: "read", key: "forbidden", stream: "none", channel: "actor", result: "probe.read", capability: null, resource: "read", authority: ["current-actor"], paramsCheck: fixed(agentWaitParamsCheck) },',
  );
  assert.ok(
    hasError(errors(programWith(changes)), publicDispatcher, 2345, "never"),
    "descriptor must not bypass real handler closure",
  );
  changes[publicDispatcher] = replaceOnce(
    read(publicDispatcher),
    "default: return assertNever(method);",
    'case "probe.read": return okAnswer(id, { accepted: true });\n      default: return assertNever(method);',
  );
  assert.ok(
    hasError(errors(programWith(changes)), response, 1360, "probe.read"),
    "handler must not bypass response decoder closure",
  );
  changes[response] = replaceOnce(
    read(response),
    "const checks = {",
    'const checks = {\n  "probe.read": checkObject({ accepted: checkBool() }),',
  );
  assert.deepEqual(
    errors(programWith(changes)).map(message),
    [],
    "fully connected read-method fixture must compile",
  );
});

test("P22 B: a new operation kind cannot omit result, codec or result-validator ownership", () => {
  const changes = {
    [durable]: replaceOnce(
      read(durable),
      "export type OperationPlan =",
      'export type OperationPlan =\n  | { kind: "probe.mutate" }',
    ),
  };
  const planOnly = programWith(changes);
  assert.throws(() => assertOperationClosure(planOnly), /result kind closure/);
  assert.ok(
    hasError(errors(planOnly), codec, 1360, "probe.mutate"),
    "actual codec registry must reject a missing kind",
  );
  changes[durable] = replaceOnce(
    changes[durable],
    "export type OperationResult =",
    'export type OperationResult =\n  | { kind: "probe.mutate" }',
  );
  assert.throws(
    () => assertOperationClosure(programWith(changes)),
    /codec closure/,
  );
  changes[codec] = replaceOnce(
    read(codec),
    "export const OPERATION_CODECS = Object.freeze({",
    'export const OPERATION_CODECS = Object.freeze({\n  "probe.mutate": codecFor("probe.mutate"),',
  );
  assert.throws(
    () => assertOperationClosure(programWith(changes)),
    /result validator closure/,
  );
  changes[validate] = replaceOnce(
    read(validate),
    "export function operationResultCheck(kind: string): Check {\n  switch (kind) {",
    'export function operationResultCheck(kind: string): Check {\n  switch (kind) {\n    case "probe.mutate": return checkObject({ kind: checkEnum(["probe.mutate"]) });',
  );
  assertOperationClosure(programWith(changes)); // Schema links only, not a fictitious implemented workflow.
});

test("P22 C: a new kernel file fails until it receives an explicit semantic owner", () => {
  const file = "src/domain/evolution-probe.ts";
  const graph = graphFromProgram(
    programWith({ [file]: "export const probe = 1;" }),
  );
  assert.ok(
    kernelFindings(graph).some(
      (f) => f.rule === "kernel-zone-unclassified" && f.file === file,
    ),
  );
  const owned = KERNEL_ZONES.map((zone) =>
    zone.name === "K0-values"
      ? { ...zone, files: [...zone.files, file] }
      : zone,
  );
  assert.equal(
    kernelFindings(graph, owned).length,
    0,
    "explicit K0 membership is the positive control",
  );
});

test("P22 D: optional repair/recover/transaction capabilities cannot silently widen consumer ports", () => {
  for (const [file, port] of [
    [publicDispatcher, "PublicStorePort"],
    ["src/broker/internal-dispatcher.ts", "InternalStorePort"],
  ]) {
    for (const capability of ["repair", "recover", "transaction"]) {
      const changed = replaceOnce(
        read(file),
        `export interface ${port} {`,
        `export interface ${port} {\n  readonly ${capability}?: () => void;`,
      );
      assert.deepEqual(
        errors(programWith({ [file]: changed })).map(message),
        [],
        "optional widening is not caught by ordinary assignability",
      );
      assert.notDeepEqual(
        interfaceSurface(changed, file),
        snapshots.dispatch[file],
        `${port}.${capability} must require explicit surface review`,
      );
    }
  }
});

test("V29A: the request-hash set-field recipe is a closed registry of mutation methods and their array params", () => {
  const identity = "src/domain/request-identity.ts";
  const base = read(identity);
  for (const [name, before, after] of [
    ["an unknown method", '"mail.send": ["to"],', '"mail.sned": ["to"],'],
    ["a field the method does not have", '"mail.send": ["to"],', '"mail.send": ["recipients"],'],
    ["a field that is not a set", '"mail.send": ["to"],', '"mail.send": ["subject"],'],
  ]) {
    const diagnostics = errors(programWith({ [identity]: replaceOnce(base, before, after) }));
    assert.ok(diagnostics.some((d) => d.file?.fileName === resolve(root, identity)), `${name} compiled`);
  }
});
