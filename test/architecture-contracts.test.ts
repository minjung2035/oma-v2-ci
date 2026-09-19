import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const script = fileURLToPath(new URL("../../scripts/architecture-check.mjs", import.meta.url));
const moduleUrl = pathToFileURL(script).href;

interface Finding { rule: string; file: string; line: number; sourceHash: string; snippetHash: string }

function fixture(files: Record<string, string>, checkContracts = false): { status: number | null; findings: Finding[] } {
  const root = mkdtempSync(join(tmpdir(), "oma-architecture-"));
  try {
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "es2022", module: "esnext", moduleResolution: "bundler", strict: true, types: [], noEmit: true },
      include: ["src/**/*.ts", "implementation/**/*.ts"],
    }));
    for (const [file, source] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), source);
    }
    const code = `
      import {createArchitectureProgram, analyzeProgram} from ${JSON.stringify(moduleUrl)};
      const root = ${JSON.stringify(root)};
      const findings = analyzeProgram(createArchitectureProgram(root), {rootDir: root, checkContracts: ${checkContracts}});
      console.log(JSON.stringify(findings));
      process.exitCode = findings.length ? 1 : 0;
    `;
    const child = spawnSync(process.execPath, ["--input-type=module", "--eval", code], {
      encoding: "utf8", timeout: 30_000,
    });
    assert.equal(child.error, undefined, child.stderr);
    assert.equal(child.signal, null, child.stderr);
    return { status: child.status, findings: JSON.parse(child.stdout) as Finding[] };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

function rejects(rule: string, files: Record<string, string>, checkContracts = false): void {
  const output = fixture(files, checkContracts);
  assert.equal(output.status, 1);
  assert.ok(output.findings.some(finding => finding.rule === rule), JSON.stringify(output.findings));
  for (const finding of output.findings) {
    assert.ok(finding.line > 0);
    assert.match(finding.sourceHash, /^[0-9a-f]{64}$/);
    assert.match(finding.snippetHash, /^[0-9a-f]{64}$/);
  }
}

const capabilityOwner = `export const CAPABILITIES = ["mail.send", "git.submit", "code.integrate"] as const;`;
const methodsOwner = `
  export const PUBLIC_METHODS = {"mail.send": {}, "git.submit": {}, "git.integrate": {}};
  export const INTERNAL_METHODS = {};
`;

test("positive syntax/type-only fixtures do not confuse comments, grants, or custom add with schema bugs", () => {
  const output = fixture({
    "src/domain/capabilities.ts": capabilityOwner,
    "src/domain/identifiers.ts": `export const NAME_RE = /^[a-z]{1,8}$/;`,
    "src/store.ts": `export class Store { transaction(callback: () => void) { callback(); } }`,
    "src/domain/canonical-json.ts": `
      import type {Store} from "../store.js";
      const set = new Set<string>();
      if (!set.has("x")) set.add("x");
      class Custom { add(_value: string) { return true; } }
      if (!new Custom().add("x")) throw new Error("not added");
      const text = "!set.add(x), capability copies and /^example$/ are documentation";
      const hostPolicy = {capabilities: ["mail.send", "git.submit", "code.integrate"]};
      export type Port = Pick<Store, "transaction">;
      export {text, hostPolicy};
    `,
  });
  assert.equal(output.status, 0, JSON.stringify(output.findings));
});

test("native Set.add used for truthiness is rejected, including a local alias of the Set", () => {
  rejects("set-add-membership", { "src/bad.ts": `const seen = new Set<string>(); const alias = seen; if (!alias.add("x")) throw new Error();` });
});

test("executable capability, method, identifier, resource and limit schema copies are rejected", () => {
  rejects("duplicate-capability-schema", {
    "src/domain/capabilities.ts": capabilityOwner,
    "src/bad.ts": `const copy = ["mail.send", "git.submit", "code.integrate"] as const;`,
  });
  rejects("duplicate-method-schema", {
    "src/protocol/methods.ts": methodsOwner,
    "src/bad.ts": `const copy = ["git.submit", "mail.send", "git.integrate"];`,
  });
  rejects("duplicate-id-schema", {
    "src/domain/identifiers.ts": `export const NAME_RE = /^[a-z]{1,8}$/;`,
    "src/bad.ts": `const name = /^[a-z]{1,8}$/;`,
  });
  // The declared mirror exemption is conditional: the same grammar verbatim is
  // allowed, a divergent id grammar in the mirror is not.
  const accepts = (files: Record<string, string>): void => {
    const output = fixture(files, false);
    assert.equal(output.status, 0, JSON.stringify(output.findings));
  };
  accepts({
    "src/domain/identifiers.ts": `export const NAME_RE = /^[a-z]{1,8}$/; export const OP_RE = /^op-[0-9a-f]{8}$/;`,
    "src/extension/batch-view.ts": `const NAME = /^[a-z]{1,8}$/;`,
  });
  rejects("duplicate-id-schema", {
    "src/domain/identifiers.ts": `export const NAME_RE = /^[a-z]{1,8}$/; export const OP_RE = /^op-[0-9a-f]{8}$/;`,
    "src/extension/batch-view.ts": `const NAME = /^[a-z]{1,8}$/; const WEAK = /^op-[0-9a-f]{2}$/;`,
  });
  const contracts = `export interface ResourceLimits {cpu: number; memory: number; tasks: number}
    export interface ProtocolLimits {frame: number; body: number; files: number}`;
  rejects("duplicate-resource-schema", {
    "implementation/contracts.ts": contracts,
    "src/bad.ts": `const check = (_value: unknown) => null; const copy = {cpu: check, memory: check, tasks: check};`,
  });
  rejects("duplicate-limit-schema", {
    "implementation/contracts.ts": contracts,
    "src/bad.ts": `const copy = {frame: {minInclusive: 1}, body: {minInclusive: 1}, files: {minInclusive: 1}};`,
  });
});

test("pure boundaries, runtime test dependencies, dynamic imports, and raw effects have owners", () => {
  rejects("pure-boundary-import", { "src/domain/bad.ts": `import {readFileSync} from "node:fs"; export const read = readFileSync;` });
  rejects("pure-boundary-import", {
    "src/store.ts": `export class Store {}`,
    "src/protocol/bad.ts": `import {Store} from "../store.js"; export const store = new Store();`,
  });
  rejects("production-test-import", {
    "src/bad.ts": `import {helper} from "../test/helper.js"; export {helper};`,
    "test/helper.ts": `export const helper = 1;`,
  });
  rejects("dynamic-import", { "src/bad.ts": `const target = "./plugin.js"; void import(target);` });
  rejects("sqlite-owner", { "src/bad.ts": `import {DatabaseSync} from "node:sqlite"; export {DatabaseSync};` });
  rejects("subprocess-owner", { "src/bad.ts": `import {spawnSync} from "node:child_process"; export {spawnSync};` });
  const positive = fixture({
    "src/store.ts": `import {DatabaseSync} from "node:sqlite"; export {DatabaseSync};`,
    "src/process/run.ts": `import {spawnSync} from "node:child_process"; export {spawnSync};`,
  });
  assert.equal(positive.status, 0, JSON.stringify(positive.findings));
});

test("persisted JSON aliases and independent request-byte construction cannot bypass owners", () => {
  rejects("persisted-plan-cast", {
    "implementation/contracts.ts": `export type OperationPlan = {kind: "one"};`,
    "src/bad.ts": `import type {OperationPlan} from "../implementation/contracts.js";
      const raw = JSON.parse("{}"); const alias = raw; export const plan = alias as OperationPlan;`,
  });
  rejects("raw-request-hash", { "src/bad.ts": `function canonicalJson(value: unknown) {return JSON.stringify(value);}
    export const raw = canonicalJson({method: "mail.send", params: {to: []}});` });
});

test("transaction analysis follows local call aliases and rejects filesystem and thenable effects", () => {
  const store = `class Store {transaction(callback: () => unknown) {return callback();}} const store = new Store();`;
  rejects("transaction-effect", { "src/bad.ts": `import {writeFileSync as write} from "node:fs";
    ${store} function helper() {write("/tmp/not-executed", "data");} const alias = helper; store.transaction(() => alias());` });
  rejects("transaction-await", { "src/bad.ts": `${store} store.transaction(async () => {await Promise.resolve();});` });
  rejects("transaction-thenable", { "src/bad.ts": `${store} const helper = () => Promise.resolve(1); store.transaction(() => helper());` });
  const positive = fixture({ "src/domain/canonical-json.ts": `${store} function pure(value: number) {return value + 1;} store.transaction(() => pure(1));` });
  assert.equal(positive.status, 0, JSON.stringify(positive.findings));
});

test("runtime SCCs are rejected while type-only cycles do not form runtime edges", () => {
  rejects("runtime-import-cycle", {
    "src/a.ts": `import {b} from "./b.js"; export const a = () => b;`,
    "src/b.ts": `import {a} from "./a.js"; export const b = () => a;`,
  });
  const positive = fixture({
    // A type-only cycle inside one measured layer is not a runtime coupling.
    "src/domain/canonical-json.ts": `import type {B} from "./spec-identity.js"; export interface A {b: B}`,
    "src/domain/spec-identity.ts": `import type {A} from "./canonical-json.js"; export interface B {a: A}`,
  });
  assert.equal(positive.status, 0, JSON.stringify(positive.findings));
});

function registryFixture(missingResult: boolean): Record<string, string> {
  const kinds = Array.from({ length: 11 }, (_, index) => `kind${index}`);
  return {
    "implementation/contracts.ts": `export type OperationPlan = ${kinds.map(kind => `{kind: "${kind}"}`).join(" | ")};
      export interface PublicMethods {"public.one": {params: {}}} export interface InternalMethods {"internal.one": {params: {}}}`,
    "src/protocol/methods.ts": `export const PUBLIC_METHODS = {"public.one": {}}; export const INTERNAL_METHODS = {"internal.one": {}};`,
    "src/durable.ts": `export const OPERATION_CODECS = {${kinds.map((kind, index) =>
      `"${kind}": {planCheck: (_v: unknown) => null, ${missingResult && index === 0 ? "" : "resultCheck: (_v: unknown) => null,"} relationsCheck: (_v: unknown) => null}`).join(",")}};`,
  };
}

test("all operation kinds need plan/result/relation decoders and method maps must be exhaustive", () => {
  const positive = fixture(registryFixture(false), true);
  assert.equal(positive.status, 0, JSON.stringify(positive.findings));
  rejects("operation-exhaustiveness", registryFixture(true), true);
  rejects("method-exhaustiveness", {
    ...registryFixture(false), "src/protocol/methods.ts": `export const PUBLIC_METHODS = {}; export const INTERNAL_METHODS = {"internal.one": {}};`,
  }, true);
});

test("the real project gate is an executable non-warning check", () => {
  const output = spawnSync(process.execPath, [script, "--root", process.cwd()], { encoding: "utf8", timeout: 60_000 });
  assert.equal(output.error, undefined);
  assert.equal(output.status, 0, `${output.stdout}\n${output.stderr}`);
});
