import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { surfaceRuleFindings } from "../scripts/architecture/rules/surface-rules.mjs";
function findings(files) {
  const root = mkdtempSync(join(tmpdir(), "oma-module-rule-"));
  try { for (const [name, text] of Object.entries(files)) { const path = join(root, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }
    return surfaceRuleFindings(root).filter(row => ["tui-module-boundary", "tui-public-api", "runtime-module-boundary", "package-public-api", "society-conversation-boundary", "platform-adapter-boundary"].includes(row.rule));
  } finally { rmSync(root, { recursive: true, force: true }); }
}
test("DR41: module boundaries reject implementation imports including erased type edges", () => {
  for (const specifier of ["../../../apps/oma/src/runtime/user-files.js", "../../../apps/oma/src/application/settings.js", "../../storage/src/immutable-file.js", "node:fs", "../../config/src/index.js", "../../broker/src/index.js"])
    assert.equal(findings({ "packages/tui/src/example.ts": `import type { X } from ${JSON.stringify(specifier)};` })[0]?.rule, "tui-module-boundary");
  for (const text of ['import("../../../apps/oma/src/runtime/user-files.js");', 'require("fs");', 'export type { X } from "../../../apps/oma/src/application/settings.js";', 'type X = import("../../../apps/oma/src/runtime/user-files.js").X;', 'import(selectedModule);'])
    assert.equal(findings({ "packages/tui/src/example.ts": text })[0]?.rule, "tui-module-boundary", text);
  assert.equal(findings({ "apps/oma/src/runtime/example.ts": "import { X } from \"../../../../packages/tui/src/model.js\";" })[0]?.rule, "runtime-module-boundary");
  assert.equal(findings({ "apps/oma/src/entry/example.ts": "import { X } from \"../../../../packages/tui/src/view/notice.js\";" })[0]?.rule, "tui-public-api");
  assert.equal(findings({ "apps/oma/src/application/example.ts": 'import { X } from "../runtime/packages/store.js";' })[0]?.rule, "package-public-api");
});
test("DR44: conversation and native lifecycle boundaries also reject erased, deferred and re-exported implementation imports", () => {
  for (const [file, target, rule] of [
    ["apps/oma/src/application/society-interaction.ts", "@oma/engine/principal-session", "society-conversation-boundary"],
    ["apps/oma/src/application/society-runtime.ts", "@oma/tui/model", "society-conversation-boundary"],
    ["packages/platform-linux/src/sandbox.ts", "../../../apps/oma/src/application/society-runtime.js", "platform-adapter-boundary"],
    ["packages/platform-mac/src/keychain-client.ts", "../../../apps/oma/src/application/society-transition.js", "platform-adapter-boundary"],
  ]) for (const text of [
    `import type { X } from "${target}";`, `export type { X } from "${target}";`,
    `type X = import("${target}").X;`, `import("${target}");`, `require("${target}");`,
  ]) assert.equal(findings({ [file]: text }).some(row => row.rule === rule), true, text);
  assert.deepEqual(findings({
    "packages/platform-linux/src/sandbox.ts": 'import type { SandboxPlan } from "@oma/contracts";',
    "apps/oma/src/application/society-interaction.ts": 'import type { ConversationUi } from "./society-conversation.js";',
  }), []);
});
test("DR41: Application composes public modules and TUI consumes contracts without loading their effects", () => {
  assert.deepEqual(findings({ "packages/tui/src/example.ts": "import type { ConfigField } from \"../../domain/src/settings.js\";",
    "apps/oma/src/application/example.ts": "import { societyPanelPorts } from \"../../../../packages/tui/src/society-panel.js\"; import { readPackageIndex } from \"../runtime/packages/index.js\";",
    "packages/tui/src/example.ts": "import { exceptionText } from \"../../domain/src/errors.js\";" }), []);
});
