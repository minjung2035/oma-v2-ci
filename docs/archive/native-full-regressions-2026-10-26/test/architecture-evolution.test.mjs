import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import ts from "typescript";
import { addInterfaceMember, removeInterfaceMember, setMemberResult, setMemberParameter, prependType, addRegistryProperty, replaceRegistryProperty, addSwitchCase } from "./helpers/architecture-mutations.mjs";
import {
  createArchitectureProgram,
  graphFromProgram,
  installWorkspaceSourceResolution,
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
const wire = "packages/contracts/src/public-wire.ts";
const durable = "packages/contracts/src/durable.ts";
const methods = "packages/protocol/src/methods.ts";
const publicDispatcher = "packages/broker/src/public-dispatcher.ts";
const brokerPorts = "packages/broker/src/ports.ts";
const response = "packages/protocol/src/response-codec.ts";
const codec = "packages/protocol/src/operation-codec.ts";
const validate = "packages/domain/src/validation.ts";

// All mutations stay in compiler memory. Production files and v1 fixtures are untouched.
// Unchanged inputs answer the baseline's own SourceFiles: parsing, binding and
// module resolution are functions of file content, so the shared syntax is what
// a reparse would produce (the language service reuses SourceFiles the same way
// across program versions). The check is unaffected -- every diagnostic below
// is still computed by the mutation program's own checker over live sources.
function programWith(overrides) {
  const options = baseline.getCompilerOptions();
  const host = installWorkspaceSourceResolution(ts.createCompilerHost(options), options, root);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (file, version, ...rest) => {
    const key = relative(root, file).replaceAll("\\", "/");
    if (Object.hasOwn(overrides, key))
      return ts.createSourceFile(file, overrides[key], version, true);
    return baseline.getSourceFile(file) ?? original(file, version, ...rest);
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
const errors = (program) =>
  ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.category === ts.DiagnosticCategory.Error);
// Assertions that pin one file's diagnostics pay for one file, not the whole
// program: a full getPreEmitDiagnostics rechecks every source (~10 s) while the
// per-file pair asks the checker only for what the assertion reads. Assertions
// that must prove the program is error-free keep `errors` (whole program).
const fileErrors = (program, file) => {
  const source = program.getSourceFile(resolve(root, file));
  assert.ok(source, `mutation program is missing ${file}`);
  return [
    ...program.getSyntacticDiagnostics(source),
    ...program.getSemanticDiagnostics(source),
  ].filter((d) => d.category === ts.DiagnosticCategory.Error);
};
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
  for (const [file, expected] of Object.entries(snapshots.dispatch)) {
    assert.deepEqual(interfaceSurface(read(file), file), expected);
  }
});

test("P22 A: adding a public read method requires DTO, descriptor, handler and response decoder", () => {
  const changedWire = prependType(addInterfaceMember(read(wire), "PublicMethods",
    '"probe.read": { params: Record<string, never>; result: { accepted: boolean } };'), "ReadMethod", '"probe.read"');
  const changes = { [wire]: changedWire };
  assert.ok(
    hasError(fileErrors(programWith(changes), methods), methods, 1360, "probe.read"),
    "DTO alone must not bypass descriptor closure",
  );
  changes[methods] = addRegistryProperty(read(methods), "PUBLIC_METHODS",
    '"probe.read": { mode: "read", key: "forbidden", stream: "none", channel: "actor", result: "probe.read", capability: null, authority: ["current-actor"], paramsCheck: fixed(agentWaitParamsCheck) },');
  assert.ok(
    hasError(fileErrors(programWith(changes), publicDispatcher), publicDispatcher, 2345, "never"),
    "descriptor must not bypass real handler closure",
  );
  changes[publicDispatcher] = addSwitchCase(read(publicDispatcher), "dispatchChecked",
    'case "probe.read": return okAnswer(id, { accepted: true });');
  assert.ok(
    hasError(fileErrors(programWith(changes), response), response, 1360, "probe.read"),
    "handler must not bypass response decoder closure",
  );
  changes[response] = addRegistryProperty(read(response), "checks", '"probe.read": checkObject({ accepted: checkBool() }),');
  changes[methods] = addSwitchCase(changes[methods], "principalRequestAllowed", 'case "probe.read": return true;');
  assert.deepEqual(
    errors(programWith(changes)).map(message),
    [],
    "fully connected read-method fixture must compile",
  );
});

test("P22 B: a new operation kind cannot omit result, codec or result-validator ownership", () => {
  const changes = { [durable]: prependType(read(durable), "OperationPlan", '{ kind: "probe.mutate" }') };
  const planOnly = programWith(changes);
  assert.throws(() => assertOperationClosure(planOnly), /result kind closure/);
  assert.ok(
    hasError(fileErrors(planOnly, codec), codec, 1360, "probe.mutate"),
    "actual codec registry must reject a missing kind",
  );
  changes[durable] = prependType(changes[durable], "OperationResult", '{ kind: "probe.mutate" }');
  assert.throws(
    () => assertOperationClosure(programWith(changes)),
    /codec closure/,
  );
  // The codec registry now follows the method declaration automatically.
  // A new method still cannot manufacture the independent result validator.
  changes[methods] = addRegistryProperty(read(methods), "PUBLIC_METHODS",
    '"probe.mutate": { mode: "mutation", key: "required", stream: "none", channel: "actor", result: "receipt", capability: null, resource: "admit", authority: ["current-actor"], paramsCheck: fixed(societySetParamsCheck) },');
  assert.throws(
    () => assertOperationClosure(programWith(changes)),
    /result validator closure/,
  );
  changes[validate] = addSwitchCase(read(validate), "operationResultCheck",
    'case "probe.mutate": return checkObject({ kind: checkEnum(["probe.mutate"]) });');
  assertOperationClosure(programWith(changes)); // Schema links only, not a fictitious implemented workflow.
});

test("P22 C: a new kernel file fails until it receives an explicit semantic owner", () => {
  const file = "packages/domain/src/evolution-probe.ts";
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
  // One program carries every optional member: if ordinary assignability
  // caught any single widening the whole-program diagnostic would name it,
  // so one compile proves all six widen silently. The surface review pin
  // stays per capability below -- it is pure syntax, no program needed.
  const widened = {};
  for (const [file, port] of [
    [brokerPorts, "PublicStorePort"],
    [brokerPorts, "InternalStorePort"],
  ])
    widened[file] = ["repair", "recover", "transaction"].reduce(
      (text, capability) =>
        addInterfaceMember(text, port, `readonly ${capability}?: () => void;`),
      widened[file] ?? read(file),
    );
  assert.deepEqual(
    errors(programWith(widened)).map(message),
    [],
    "optional widening is not caught by ordinary assignability",
  );
  for (const [file, port] of [
    [brokerPorts, "PublicStorePort"],
    [brokerPorts, "InternalStorePort"],
  ]) {
    for (const capability of ["repair", "recover", "transaction"]) {
      const changed = addInterfaceMember(read(file), port, `readonly ${capability}?: () => void;`);
      assert.notDeepEqual(
        interfaceSurface(changed, file),
        snapshots.dispatch[file],
        `${port}.${capability} must require explicit surface review`,
      );
    }
  }
});

test("V29A: the request-hash set-field recipe is a closed registry of mutation methods and their array params", () => {
  const identity = "packages/domain/src/request-identity.ts";
  const base = read(identity);
  for (const [name, after] of [
    ["an unknown method", '"mail.sned": ["to"]'],
    ["a field the method does not have", '"mail.send": ["recipients"]'],
    ["a field that is not a set", '"mail.send": ["subject"]'],
  ]) {
    const program = programWith({ [identity]: replaceRegistryProperty(base, "SET_FIELD_RECIPE", "mail.send", after) });
    assert.ok(fileErrors(program, identity).length > 0, `${name} compiled`);
  }
});


test("DR40: Architecture mutations select syntax owners through comments and reformatting", () => {
  const original = 'export interface /* owner */ Probe\n { readonly value : string; }';
  const changed = addInterfaceMember(original, "Probe", "readonly repair?: () => void;");
  assert.deepEqual(declarationSurface(removeInterfaceMember(changed, "Probe", "repair"), "fixture.ts"), declarationSurface(original, "fixture.ts"));
  const table = 'const checks /* registry */ = ( { "probe": false } as const );';
  assert.match(addRegistryProperty(table, "checks", '"added": true,'), /"added": true/);
  assert.throws(() => addRegistryProperty('const a = {};', "checks", '"added": true,'), /exactly one syntax owner/);
});
