import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { surfaceRuleFindings } from "../scripts/architecture/rules/surface-rules.mjs";
function findings(files) {
  const root = mkdtempSync(join(tmpdir(), "oma-module-rule-"));
  try { for (const [name, text] of Object.entries(files)) { const path = join(root, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }
    return surfaceRuleFindings(root).filter(row => ["tui-module-boundary", "tui-public-api", "runtime-module-boundary", "package-public-api"].includes(row.rule));
  } finally { rmSync(root, { recursive: true, force: true }); }
}
test("DR41: module boundaries reject implementation imports including erased type edges", () => {
  for (const specifier of ["../runtime/pi-rpc.js", "../application/settings.js", "../storage/paths.js", "node:fs", "../config.js", "../broker.js"])
    assert.equal(findings({ "src/tui/example.ts": `import type { X } from ${JSON.stringify(specifier)};` })[0]?.rule, "tui-module-boundary");
  for (const text of ['import("../runtime/pi-rpc.js");', 'require("fs");', 'export type { X } from "../application/settings.js";', 'type X = import("../runtime/pi-rpc.js").X;', 'import(selectedModule);'])
    assert.equal(findings({ "src/tui/example.ts": text })[0]?.rule, "tui-module-boundary", text);
  assert.equal(findings({ "src/runtime/example.ts": 'import { X } from "../tui/model.js";' })[0]?.rule, "runtime-module-boundary");
  assert.equal(findings({ "src/entry/example.ts": 'import { X } from "../tui/transcript.js";' })[0]?.rule, "tui-public-api");
  assert.equal(findings({ "src/application/example.ts": 'import { X } from "../runtime/packages/store.js";' })[0]?.rule, "package-public-api");
});
test("DR41: Application composes public modules and TUI consumes contracts without loading their effects", () => {
  assert.deepEqual(findings({ "src/tui/example.ts": 'import type { ConfigField } from "../protocol/settings.js";',
    "src/application/example.ts": 'import { societyPanelPorts } from "../tui/society-panel.js"; import { readPackageIndex } from "../runtime/packages/index.js";',
    "src/tui/words.ts": 'import { productText } from "../platform/product-text.js";' }), []);
});
