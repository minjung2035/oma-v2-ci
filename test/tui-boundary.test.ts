import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { PUBLIC_METHODS, INTERNAL_METHODS } from "../src/protocol/methods.js";

const root = fileURLToPath(new URL("../../", import.meta.url));

function sourceOf(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
}

interface Edge { readonly specifier: string; readonly typeOnly: boolean }

function importsOf(source: ts.SourceFile): Edge[] {
  const edges: Edge[] = [];
  const push = (node: ts.Node, specifier: ts.Expression | undefined, typeOnly: boolean): void => {
    void node;
    if (specifier && ts.isStringLiteral(specifier)) edges.push({ specifier: specifier.text, typeOnly });
  };
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      const allTypes = clause?.isTypeOnly === true ||
        (clause?.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings) &&
          clause.name === undefined && clause.namedBindings.elements.every(element => element.isTypeOnly));
      push(statement, statement.moduleSpecifier, allTypes === true);
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier)
      push(statement, statement.moduleSpecifier, statement.isTypeOnly);
  }
  return edges;
}

/** Repository-relative runtime closure. Type-only edges are erased at build
 * time and therefore cannot carry a capability or an effect.
 */
function closureOf(entry: string, options: { readonly includeTypes?: boolean } = {}): Set<string> {
  const seen = new Set<string>();
  const walk = (file: string): void => {
    const rel = relative(root, file);
    if (seen.has(rel)) return;
    seen.add(rel);
    for (const edge of importsOf(sourceOf(file))) {
      if (!edge.specifier.startsWith(".")) continue;
      if (edge.typeOnly && options.includeTypes !== true) continue;
      const target = resolve(dirname(file), edge.specifier).replace(/\.js$/, ".ts");
      if (existsSync(target)) walk(target);
    }
  };
  walk(resolve(root, entry));
  return seen;
}

const tuiClosure = closureOf("src/entry/oma.ts");
const cliClosure = closureOf("src/cli.ts");

test("T91/TUI-002: the host TUI and the model-facing CLI share no argv parser or command module", () => {
  const tuiOnly = [...tuiClosure].filter(file => file.startsWith("src/tui/") || file === "src/entry/oma.ts");
  assert.ok(tuiOnly.length > 5, "the TUI closure should contain the product surface");

  // Neither entrypoint reaches the other's command surface.
  for (const file of cliClosure) assert.ok(!file.startsWith("src/tui/"), `model-facing CLI must not reach ${file}`);
  assert.ok(!cliClosure.has("src/entry/oma.ts"));
  for (const file of tuiClosure)
    assert.ok(!file.startsWith("src/cli/commands/") && file !== "src/cli.ts",
      `host TUI must not reach the model-facing command surface: ${file}`);
  assert.ok(!tuiClosure.has("src/cli/arguments.ts"), "the two entrypoints must not share an argv parser");
  assert.ok(!tuiClosure.has("src/cli/exit.ts"), "the two entrypoints must not share an exit owner");
});

test("T91/TUI-003: no sandbox mount or Resident surface exposes the product entrypoint", () => {
  for (const file of ["src/sandbox.ts", "src/runner.ts", "src/runtime/pi-adapter.ts"]) {
    const text = readFileSync(resolve(root, file), "utf8");
    assert.doesNotMatch(text, /tui|entry\/oma/i, `${file} must not reference the product surface`);
  }
  // The model-facing help text must not advertise the Control Panel.
  const usage = readFileSync(resolve(root, "src/cli/exit.ts"), "utf8");
  assert.doesNotMatch(usage, /Ctrl\+X|Control Panel|Dashboard/i);
  const views = readFileSync(resolve(root, "src/views.ts"), "utf8");
  assert.doesNotMatch(views, /Ctrl\+X|Control Panel/i);
});

test("T95/TUI-001: the product surface adds no wire or internal socket method", () => {
  // The closed method surface is the one the broker already dispatches. A TUI
  // that needed a new method would change these key sets.
  assert.deepEqual(Object.keys(PUBLIC_METHODS).sort(), [
    "agent.continue", "agent.create", "agent.start", "agent.stop", "agent.wait",
    "context.publish", "git.integrate", "git.known", "git.submit",
    "logs.read", "mail.ack", "mail.send", "operation.get", "route.follow",
    "route.unfollow", "status.get",
  ]);
  assert.deepEqual(Object.keys(INTERNAL_METHODS).sort(), [
    "batch.complete", "batch.prepare", "batch.read",
    "host.principalRelay", "host.reconcile",
    "principal.attach", "principal.detach", "runner.observe", "runner.open", "runner.pending",
  ]);
});

test("T95/TUI-006: the product surface owns no durable store and writes no ledger row", () => {
  const forbidden = ["src/store.ts", "src/storage/transaction.ts", "src/storage/rows.ts", "src/durable.ts"];
  for (const file of forbidden)
    assert.ok(!tuiClosure.has(file), `the TUI must not reach the durable store owner: ${file}`);
  for (const file of tuiClosure) {
    if (!file.startsWith("src/tui/")) continue;
    const text = readFileSync(resolve(root, file), "utf8");
    assert.doesNotMatch(text, /\bCREATE TABLE\b|\bINSERT INTO\b|\bUPDATE\s+\w+\s+SET\b/i,
      `${file} must not carry schema or row mutation`);
  }
});

test("T95/TUI-006: only the two declared source owners perform writes on the product surface", () => {
  const writers = new Set(["src/tui/sources/settings.ts", "src/tui/sources/extensions.ts"]);
  for (const file of tuiClosure) {
    if (!file.startsWith("src/tui/")) continue;
    const text = readFileSync(resolve(root, file), "utf8");
    const writes = /replaceDerivedFile|writeFileSync|writeExclusiveFsyncedFile|renameSync|unlinkSync|mkdirSync/.test(text);
    if (writes) assert.ok(writers.has(file), `${file} performs a filesystem write but is not a declared write owner`);
  }
  // The mail surface is strictly read-only: it must not move or rename mail.
  const mail = readFileSync(resolve(root, "src/tui/sources/mail.ts"), "utf8");
  assert.doesNotMatch(mail, /renameSync|writeFileSync|unlinkSync|moveToCur/);
});

test("T95/TUI-001: the product surface reaches the broker only through its single transport owner", () => {
  for (const file of tuiClosure) {
    if (!file.startsWith("src/tui/") || file === "src/tui/transport.ts") continue;
    const text = readFileSync(resolve(root, file), "utf8");
    assert.doesNotMatch(text, /protocol\/channel\.js/, `${file} must use the TUI transport owner`);
  }
  const transport = readFileSync(resolve(root, "src/tui/transport.ts"), "utf8");
  assert.match(transport, /status\.get/);
  // Read-only observation: the Dashboard must not drive the relay or reconcile,
  // both of which have side effects.
  assert.doesNotMatch(transport, /host\.principalRelay|host\.reconcile/);
});

test("T92/TUI-014: the product never offers a Pi entrypoint as a normal path", () => {
  for (const file of tuiClosure) {
    if (!file.startsWith("src/tui/") && file !== "src/entry/oma.ts") continue;
    const text = readFileSync(resolve(root, file), "utf8");
    assert.doesNotMatch(text, /`pi config`|"pi config"|pi install|pi update/,
      `${file} must not present a Pi command as a product path`);
  }
});
