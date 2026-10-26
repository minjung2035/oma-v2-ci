import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { join } from "node:path";
import ts from "typescript";
import { createArchitectureProgram } from "../scripts/dependency-graph.mjs";
// The envelope rule is the protocol's own (P0V-32), not a copy in this fixture.
import { internalEnvelopeProblem, INTERNAL_METHODS, isInternalMethod } from "@oma/protocol/methods";

const options = {
  strict: true,
  noEmit: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  types: ["node"],
};

function virtualDiagnostics(source) {
  const fileName = join(process.cwd(), "test", ".p11-p12-port-fixture.ts");
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (file) => file === fileName || fileExists(file);
  host.readFile = (file) => (file === fileName ? source : readFile(file));
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (file, version, ...rest) =>
    file === fileName
      ? ts.createSourceFile(file, source, version, true, ts.ScriptKind.TS)
      : getSourceFile(file, version, ...rest);
  const program = ts.createProgram([fileName], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .filter(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    );
}

function mutatedProductionDiagnostics(suffix, mutate) {
  const program = createArchitectureProgram();
  const target = program
    .getSourceFiles()
    .find((source) => source.fileName.endsWith(suffix));
  assert.ok(target, `production Program must contain ${suffix}`);
  const compilerHost = ts.createCompilerHost(program.getCompilerOptions());
  const read = compilerHost.getSourceFile.bind(compilerHost);
  compilerHost.getSourceFile = (file, version, ...rest) => {
    const source = read(file, version, ...rest);
    return file === target.fileName && source
      ? ts.createSourceFile(
          file,
          mutate(source.text),
          version,
          true,
          ts.ScriptKind.TS,
        )
      : source;
  };
  const mutated = ts.createProgram({
    rootNames: [target.fileName],
    options: program.getCompilerOptions(),
    host: compilerHost,
  });
  return {
    target,
    diagnostics: ts
      .getPreEmitDiagnostics(mutated)
      .filter(
        (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
      ),
  };
}

function internalFixture() {
  const calls = { fs: 0, mail: 0, authority: 0 };
  const StoreError = class extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  };
  const source = readFileSync(
    new URL("../packages/broker/src/internal-dispatcher.ts", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const exports = {};
  new Script(compiled.outputText, {
    filename: "internal-dispatcher.cjs",
  }).runInNewContext({
    exports,
    require(name) {
      if (name === "node:fs")
        return {
          readdirSync() {
            calls.fs++;
            throw new Error("unexpected filesystem effect");
          },
        };
      if (name === "node:path") return { join: (...parts) => parts.join("/") };
      if (name === "@oma/domain/errors") return { StoreError };
      if (name === "@oma/domain/admission") return { NO_HOLD: () => undefined };
      if (name === "@oma/domain/exhaustive")
        return {
          assertNever(value) {
            throw new TypeError(String(value));
          },
        };
      if (name === "@oma/protocol/methods") {
        return {
          INTERNAL_METHODS,
          internalEnvelopeProblem,
          isInternalMethod,
        };
      }
      if (name === "./replies.js")
        return {
          errorAnswer: (id, error) => ({ v: 1, id, ok: false, error }),
          okAnswer: (id, result) => ({ v: 1, id, ok: true, result }),
        };
      throw new Error(`uncontrolled dependency: ${name}`);
    },
  });
  const deps = {
    store: {
      getAgentIdentity: () => null,
      pendingDeliveryCount: () => 0,
      getBatchAgent: () => null,
      preparedBatchIds: () => [],
    },
    mail: {
      moveToCur() {
        calls.mail++;
        throw new Error("unexpected mail effect");
      },
    },
    reconcile: null,
    stateRoot: "/state",
    peers: {
      requireHostUnit: () => {
        calls.authority++;
      },
      requireRunnerPeer() {},
      runnerActor() {
        return "runner";
      },
      runnerAuth() {
        return {};
      },
    },
    isDraining: () => false,
    assertAdmission() {},

    failureAnswer: (id, error) => ({ v: 1, id, ok: false, error }),
    refreshViews() {},
    openRun() {
      throw new Error("unexpected run effect");
    },
  };
  return { dispatcher: new exports.InternalDispatcher(deps), calls };
}

test("P11 handler closure: removing a real production case fails the pinned TypeScript exhaustiveness oracle", () => {
  assert.equal(ts.version, "5.9.3");
  const result = mutatedProductionDiagnostics(
    "/packages/broker/src/public-dispatcher.ts",
    (source) => {
      const mutated = source.replace(
        'case "status.get": {',
        'case "status.get.missing": {',
      );
      assert.notEqual(
        mutated,
        source,
        "fixture must remove a real handler case",
      );
      return mutated;
    },
  );
  const internalResult = mutatedProductionDiagnostics(
    "/packages/broker/src/internal-dispatcher.ts",
    (source) => {
      const mutated = source.replace(
        'case "runner.open": {',
        'case "runner.open.missing": {',
      );
      assert.notEqual(
        mutated,
        source,
        "fixture must remove a real internal handler case",
      );
      return mutated;
    },
  );
  assert.ok(
    internalResult.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === 2345 &&
        diagnostic.file?.fileName === internalResult.target.fileName,
    ),
    "omitted real internal handler must fail assertNever",
  );
  assert.ok(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === 2345 &&
        diagnostic.file?.fileName === result.target.fileName,
    ),
    "omitted real handler must fail assertNever",
  );
});

test("P12 capability closure: forbidden methods fail against the real PublicDispatchDependencies type", () => {
  const diagnostics = virtualDiagnostics(`
    import type { PublicDispatchDependencies } from "@oma/broker/ports";
    declare const deps: PublicDispatchDependencies;
    deps.git?.reconcile();
    deps.store.transaction();
  `);
  assert.ok(
    diagnostics.filter((diagnostic) => diagnostic.code === 2339).length >= 2,
    "forbidden Git and Store methods must fail the real port type",
  );
});

test("P11/P12 production dispatcher sources typecheck cleanly with the pinned compiler", () => {
  assert.equal(ts.version, "5.9.3");
  const program = createArchitectureProgram();
  const errors = ts
    .getPreEmitDiagnostics(program)
    .filter(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    );
  assert.deepEqual(errors, []);
});

test("NATIVE-INTERNAL-RELAY-REMOVED-01: the retired host relay cannot consume mail or filesystem effects", async () => {
  const { dispatcher, calls } = internalFixture();
  const result = await dispatcher.dispatch(
    { v: 1, id: "relay", method: "host.principalRelay", params: {} },
    {},
    null,
    "host",
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "UNKNOWN_METHOD");
  assert.equal(calls.authority, 0);
  assert.equal(calls.fs, 0);
  assert.equal(calls.mail, 0);
});
