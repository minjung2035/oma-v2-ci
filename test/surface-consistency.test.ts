import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SURFACE_BOUNDS } from "../src/tui/limits.js";
import { SURFACE_LIMITS } from "../src/domain/tool-surface.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (file: string): string => readFileSync(resolve(root, file), "utf8");

function filesUnder(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
    const rel = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(rel));
    else if (entry.name.endsWith(".ts")) out.push(rel);
  }
  return out;
}

const PRODUCT_SOURCES = [...filesUnder("src/tui"), "src/domain/tool-surface.ts", "src/config/defaults.ts"];

/** Strip comments and string literals: a number inside prose or a message is
 * not a magic constant, and a bound's own declaration is where numbers belong.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    // A character identity is not a policy bound: ESC, CR and LF name a byte,
    // they do not say how much of anything the surface will hold.
    .replace(/String\.fromCharCode\([^)]*\)/g, "String.fromCharCode()");
}

test("the product surface states its bounds in a descriptor, not in the code that uses them", () => {
  // Core declares limits once (RESOURCE_FIELDS, PROTOCOL_LIMIT_FIELDS); the
  // product surface follows the same rule.
  const declarations = ["src/tui/limits.ts", "src/domain/tool-surface.ts", "src/config/defaults.ts"];
  for (const file of PRODUCT_SOURCES) {
    if (declarations.includes(file)) continue;
    const literals = [...codeOnly(read(file)).matchAll(/(?<![\w.])(\d{2,})(?![\w])/g)].map(match => match[1]!);
    // 0-1 and small indices are structure, not policy; anything larger is a bound.
    const policy = literals.filter(value => Number(value) > 16 && !/^0[xo]/.test(value));
    assert.deepEqual(policy, [], `${file} carries an undeclared bound: ${policy.join(", ")}`);
  }
});

test("every declared bound is positive, finite and explains itself", () => {
  for (const [name, bound] of Object.entries(SURFACE_BOUNDS)) {
    assert.ok(Number.isSafeInteger(bound.value) && bound.value > 0, `${name} must be a positive safe integer`);
    assert.ok(bound.why.length > 0, `${name} must say why`);
    assert.ok(["cells", "lines", "bytes", "count"].includes(bound.unit), `${name} needs a unit`);
  }
  for (const [name, value] of Object.entries(SURFACE_LIMITS))
    assert.ok(Number.isSafeInteger(value) && value > 0, `tool surface ${name} must be a positive safe integer`);
});

test("the product surface uses the closed error vocabulary, never bare Error", () => {
  for (const file of PRODUCT_SOURCES) {
    const code = codeOnly(read(file));
    assert.doesNotMatch(code, /throw new Error\(/, `${file} must use StoreError with a closed code`);
  }
});

test("closed unions are handled exhaustively rather than falling through", () => {
  // A switch over a closed union either handles every case or says assertNever.
  const app = read("src/tui/app.ts");
  assert.match(app, /assertNever\(effect\)/, "the effect union must be exhaustive");
});

test("each engine primitive has exactly one owner, and layout is not borrowed", () => {
  // Borrowing the engine's arithmetic is good; borrowing its presentation is
  // not. Every import of the engine's terminal library is declared here with
  // the primitive it owns, so a second importer has to change this list.
  const OWNERS: Readonly<Record<string, readonly string[]>> = {
    "src/tui/render.ts": ["visibleWidth"],
    "src/tui/keys.ts": ["parseKey"],
  };
  for (const file of PRODUCT_SOURCES) {
    // An import specifier is a string literal, so this reads the raw source.
    const source = read(file);
    const imports = /from "@earendil-works\/pi-tui"/.test(source);
    const declared = Object.hasOwn(OWNERS, file);
    assert.equal(imports, declared, `${file}: engine imports must match the declared owner list`);
    if (!declared) continue;
    for (const symbol of OWNERS[file]!)
      assert.ok(source.includes(symbol), `${file} must own ${symbol}`);
  }
  // Fitting, wrapping and screen control carry the engine's own presentation.
  const render = read("src/tui/render.ts");
  assert.doesNotMatch(render, /truncateToWidth|wrapTextWithAnsi/);
  assert.doesNotMatch(read("src/tui/screen.ts"), /@earendil-works/);
});

test("the engine is never modified, only consumed", () => {
  // Nothing in this repository may write into the vendored engine.
  for (const file of [...PRODUCT_SOURCES, "src/runtime/pi-runtime.ts", "src/runtime/pi-adapter.ts"]) {
    const code = codeOnly(read(file));
    assert.doesNotMatch(code, /node_modules/, `${file} must not address the engine tree directly`);
  }
});

test("one owner per field placement: the Config routing table is not duplicated", () => {
  const settings = read("src/tui/sources/settings.ts");
  // The transform and the writer must not each carry their own field switch.
  const switches = [...settings.matchAll(/switch \(field\)/g)];
  assert.equal(switches.length, 1, "field behaviour belongs to one switch and one placement table");
  assert.match(settings, /const PLACEMENT/);
});
