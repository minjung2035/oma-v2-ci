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
      include: ["apps/oma/src/**/*.ts", "implementation/**/*.ts", "packages/*/src/**/*.ts"],
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
    return { status: child.status, findings: JSON.parse(child.stdout || JSON.stringify([{ error: child.stderr }])) as Finding[] };
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
    "packages/domain/src/capabilities.ts": capabilityOwner,
    "packages/domain/src/identifiers.ts": `export const NAME_RE = /^[a-z]{1,8}$/;`,
    "packages/storage/src/store.ts": `export class Store { transaction(callback: () => void) { callback(); } }`,
    "packages/domain/src/canonical-json.ts": "\n      import type {Store} from \"../../storage/src/store.js\";\n      const set = new Set<string>();\n      if (!set.has(\"x\")) set.add(\"x\");\n      class Custom { add(_value: string) { return true; } }\n      if (!new Custom().add(\"x\")) throw new Error(\"not added\");\n      const text = \"!set.add(x), capability copies and /^example$/ are documentation\";\n      const hostPolicy = {capabilities: [\"mail.send\", \"git.submit\", \"code.integrate\"]};\n      export type Port = Pick<Store, \"transaction\">;\n      export {text, hostPolicy};\n    ",
  });
  assert.equal(output.status, 0, JSON.stringify(output.findings));
});

test("native Set.add used for truthiness is rejected, including a local alias of the Set", () => {
  rejects("set-add-membership", { "apps/oma/src/bad.ts": `const seen = new Set<string>(); const alias = seen; if (!alias.add("x")) throw new Error();` });
});

test("set-add-membership fires on aliased callees -- the resolved signature, not the accessed name, decides", () => {
  // A callee that resolves to Set.add's declaration under another name is the
  // same misuse spelled differently: no syntactic name gate may stand between
  // the boolean-position test and the signature resolution.
  const output = fixture({ "apps/oma/src/bad.ts": [
    `declare const box: { foo: Set<string>["add"] };`,
    `const direct = new Set<string>();`,
    `const obj = { m: new Set<string>().add };`,
    `if (direct.add("c")) {}`,
    `if (box.foo("a")) {}`,
    `if (obj.m("z")) {}`,
    `if (box["foo"]("b")) {}`,
    ``,
  ].join("\n") });
  assert.equal(output.status, 1);
  const fired = output.findings.filter(finding => finding.rule === "set-add-membership");
  assert.deepEqual(fired.map(finding => finding.line), [4, 5, 6, 7], JSON.stringify(output.findings));
});

test("executable capability, method, identifier and protocol limit schema copies are rejected", () => {
  rejects("duplicate-capability-schema", {
    "packages/domain/src/capabilities.ts": capabilityOwner,
    "apps/oma/src/bad.ts": `const copy = ["mail.send", "git.submit", "code.integrate"] as const;`,
  });
  rejects("duplicate-method-schema", {
    "packages/protocol/src/methods.ts": methodsOwner,
    "apps/oma/src/bad.ts": `const copy = ["git.submit", "mail.send", "git.integrate"];`,
  });
  rejects("duplicate-id-schema", {
    "packages/domain/src/identifiers.ts": `export const NAME_RE = /^[a-z]{1,8}$/;`,
    "apps/oma/src/bad.ts": `const name = /^[a-z]{1,8}$/;`,
  });
  rejects("duplicate-id-schema", {
    "packages/domain/src/identifiers.ts": `export const NAME_RE = /^[a-z]{1,8}$/;`,
    "packages/tool-runtime/src/batch-view.ts": `const NAME = /^[a-z]{1,8}$/;`,
  });
  const contracts = `export interface ProtocolLimits {frame: number; body: number; files: number}`;
  rejects("duplicate-limit-schema", {
    "packages/contracts/src/index.ts": contracts,
    "apps/oma/src/bad.ts": `const copy = {frame: {minInclusive: 1}, body: {minInclusive: 1}, files: {minInclusive: 1}};`,
  });
});

test("pure boundaries, runtime test dependencies, dynamic imports, and raw effects have owners", () => {
  rejects("pure-boundary-import", { "packages/domain/src/bad.ts": `import {readFileSync} from "node:fs"; export const read = readFileSync;` });
  rejects("pure-boundary-import", {
    "packages/storage/src/store.ts": `export class Store {}`,
    "packages/protocol/src/bad.ts": "import {Store} from \"../../storage/src/store.js\"; export const store = new Store();",
  });
  rejects("production-test-import", {
    "apps/oma/src/bad.ts": `import {helper} from "../test/helper.js"; export {helper};`,
    "test/helper.ts": `export const helper = 1;`,
  });
  rejects("dynamic-import", { "apps/oma/src/bad.ts": `const target = "./plugin.js"; void import(target);` });
  rejects("sqlite-owner", { "apps/oma/src/bad.ts": `import {DatabaseSync} from "node:sqlite"; export {DatabaseSync};` });
  rejects("subprocess-owner", { "apps/oma/src/bad.ts": `import {spawnSync} from "node:child_process"; export {spawnSync};` });
  const positive = fixture({
    "packages/storage/src/store.ts": `import {DatabaseSync} from "node:sqlite"; export {DatabaseSync};`,
    "packages/process/src/run.ts": `import {spawnSync} from "node:child_process"; export {spawnSync};`,
  });
  assert.equal(positive.status, 0, JSON.stringify(positive.findings));
});

test("persisted JSON aliases and independent request-byte construction cannot bypass owners", () => {
  rejects("persisted-plan-cast", {
    "packages/contracts/src/index.ts": `export type OperationPlan = {kind: "one"};`,
    "apps/oma/src/bad.ts": `import type {OperationPlan} from "@oma/contracts";
      const raw = JSON.parse("{}"); const alias = raw; export const plan = alias as OperationPlan;`,
  });
  rejects("raw-request-hash", { "apps/oma/src/bad.ts": `function canonicalJson(value: unknown) {return JSON.stringify(value);}
    export const raw = canonicalJson({method: "mail.send", params: {to: []}});` });
});

test("transaction analysis follows local call aliases and rejects filesystem and thenable effects", () => {
  const store = `class Store {transaction(callback: () => unknown) {return callback();}} const store = new Store();`;
  rejects("transaction-effect", { "apps/oma/src/bad.ts": `import {writeFileSync as write} from "node:fs";
    ${store} function helper() {write("/tmp/not-executed", "data");} const alias = helper; store.transaction(() => alias());` });
  rejects("transaction-await", { "apps/oma/src/bad.ts": `${store} store.transaction(async () => {await Promise.resolve();});` });
  rejects("transaction-thenable", { "apps/oma/src/bad.ts": `${store} const helper = () => Promise.resolve(1); store.transaction(() => helper());` });
  const positive = fixture({ "packages/domain/src/canonical-json.ts": `${store} function pure(value: number) {return value + 1;} store.transaction(() => pure(1));` });
  assert.equal(positive.status, 0, JSON.stringify(positive.findings));
});

test("runtime and type-only SCCs are rejected by their own dependency rules", () => {
  rejects("runtime-import-cycle", {
    "apps/oma/src/a.ts": `import {b} from "./b.js"; export const a = () => b;`,
    "apps/oma/src/b.ts": `import {a} from "./a.js"; export const b = () => a;`,
  });
  const types = fixture({
    "packages/domain/src/canonical-json.ts": `import type {B} from "./spec-identity.js"; export interface A {b: B}`,
    "packages/domain/src/spec-identity.ts": `import type {A} from "./canonical-json.js"; export interface B {a: A}`,
  });
  assert.notEqual(types.status, 0);
  assert.ok(types.findings.some(finding => finding.rule === "type-import-cycle"), JSON.stringify(types.findings));
  assert.equal(types.findings.some(finding => finding.rule === "runtime-import-cycle"), false,
    "type-only imports were incorrectly counted as runtime effects");
});

function registryFixture(missingResult: boolean): Record<string, string> {
  const kinds = Array.from({ length: 11 }, (_, index) => `kind${index}`);
  return {
    "packages/contracts/src/index.ts": `export type OperationPlan = ${kinds.map(kind => `{kind: "${kind}"}`).join(" | ")};
      export interface PublicMethods {"public.one": {params: {}}} export interface InternalMethods {"internal.one": {params: {}}}`,
    "packages/protocol/src/methods.ts": `export const PUBLIC_METHODS = {"public.one": {}}; export const INTERNAL_METHODS = {"internal.one": {}};`,
    "packages/domain/src/durable.ts": `export const OPERATION_CODECS = {${kinds.map((kind, index) =>
      `"${kind}": {planCheck: (_v: unknown) => null, ${missingResult && index === 0 ? "" : "resultCheck: (_v: unknown) => null,"} relationsCheck: (_v: unknown) => null}`).join(",")}};`,
  };
}

test("all operation kinds need plan/result/relation decoders and method maps must be exhaustive", () => {
  const positive = fixture(registryFixture(false), true);
  assert.equal(positive.status, 0, JSON.stringify(positive.findings));
  rejects("operation-exhaustiveness", registryFixture(true), true);
  rejects("method-exhaustiveness", {
    ...registryFixture(false), "packages/protocol/src/methods.ts": `export const PUBLIC_METHODS = {}; export const INTERNAL_METHODS = {"internal.one": {}};`,
  }, true);
});

test("the real project gate is an executable non-warning check", () => {
  const output = spawnSync(process.execPath, [script, "--root", process.cwd()], { encoding: "utf8", timeout: 60_000 });
  assert.equal(output.error, undefined);
  assert.equal(output.status, 0, `${output.stdout}\n${output.stderr}`);
});
