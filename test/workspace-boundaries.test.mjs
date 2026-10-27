import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { moduleFindings } from "../scripts/check-modules.mjs";

function inspect(t, files = {}, manifests = {}) {
  const root = mkdtempSync(join(tmpdir(), "oma-module-negative-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, value) => {
    const file = join(root, path); mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  };
  write("package.json", { version: "0.1.0" });
  for (const name of ["contracts", "domain", "protocol", "client", "tui", "native", "process", "storage", "config", "mail", "git", "review", "tool-files", "tool-runtime", "tool-lsp", "platform-linux", "platform-mac"]) {
    write(`packages/${name}/package.json`, { name: `@oma/${name}`, version: "0.1.0", type: "module",
      exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } }, ...manifests[name] });
    write(`packages/${name}/src/index.ts`, "export type Value = string;");
  }
  for (const [path, value] of Object.entries(files)) write(path, value);
  return moduleFindings(root);
}
test("workspace guard accepts declared public imports and rejects transitive and private imports", t => {
  const file = "packages/domain/src/index.ts";
  assert.deepEqual(inspect(t, { [file]: 'import type { Value } from "@oma/contracts"; export type Own = Value;' },
    { domain: { dependencies: { "@oma/contracts": "0.1.0" } } }), []);
  assert.match(inspect(t, { [file]: 'import "hidden-transitive";' },
    { contracts: { dependencies: { "hidden-transitive": "1.0.0" } } }).join("\n"), /undeclared runtime dependency hidden-transitive/);
  for (const statement of ['import("@oma/contracts/src/index");', 'type X = import("@oma/contracts/private").Value;',
    'import type { Value } from "../../contracts/src/index.js";'])
    assert.match(inspect(t, { [file]: statement }, { domain: { dependencies: { "@oma/contracts": "0.1.0" } } }).join("\n"), /private or missing export|relative import leaves workspace/);
});
test("DR46: Git and config can use declared file APIs but cannot import ledger implementations or types", t => {
  const storage = { exports: {
    ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
    "./preaccept-artifact": { types: "./dist/preaccept-artifact.d.ts", default: "./dist/preaccept-artifact.js" },
  } };
  for (const name of ["git", "config"]) {
    const manifests = { storage, [name]: { dependencies: { "@oma/storage": "0.1.0" } } };
    assert.deepEqual(inspect(t, {
      "packages/storage/src/preaccept-artifact.ts": "export interface Value {}",
      [`packages/${name}/src/index.ts`]: 'import type { Value } from "@oma/storage/preaccept-artifact";',
    }, manifests), []);
    for (const statement of ['import "@oma/storage";', 'import type { Value } from "@oma/storage";',
      'type Value = import("@oma/storage").Value;'])
      assert.match(inspect(t, { "packages/storage/src/preaccept-artifact.ts": "export interface Value {}",
        [`packages/${name}/src/index.ts`]: statement }, manifests).join("\n"), /storage ledger capability forbidden/);
  }
  assert.match(inspect(t, { "packages/review/src/index.ts": 'import "node:fs";' }).join("\n"), /effectful builtin forbidden/);
  assert.match(inspect(t, { "packages/git/src/index.ts": 'import type { Value } from "@oma/review";' },
    { git: { dependencies: { "@oma/review": "0.1.0" } } }).join("\n"), /forbidden dependency/);
});
test("workspace guard includes type-only cycles and createRequire aliases", t => {
  assert.match(inspect(t, {
    "packages/domain/src/index.ts": "import type { Value } from \"../../contracts/src/index.js\";",
    "packages/contracts/src/index.ts": "import type { Value } from \"../../domain/src/index.js\";",
  }, { domain: { dependencies: { "@oma/contracts": "0.1.0" } }, contracts: { dependencies: { "@oma/domain": "0.1.0" } } }).join("\n"), /dependency cycle/);
  assert.match(inspect(t, { "packages/client/src/index.ts":
    'import { createRequire as loader } from "node:module"; const load = loader(import.meta.url); load("hidden");' }).join("\n"), /undeclared runtime dependency hidden/);
});
test("workspace guard refuses effectful UI imports and unowned runtime assets", t => {
  assert.match(inspect(t, { "packages/tui/src/index.ts": 'import "node:sqlite";' }).join("\n"), /effectful builtin forbidden/);
  assert.match(inspect(t, { "packages/protocol/src/index.ts": 'import "node:net";' }).join("\n"), /effectful builtin forbidden/);
  assert.match(inspect(t, { "packages/domain/src/index.ts": 'new URL("./missing.sql", import.meta.url);' }).join("\n"), /unowned or missing package asset/);
});

test("package tests may use their own implementation but cannot borrow undeclared or private dependencies", t => {
  const file = "packages/tui/test/unit.test.mjs";
  assert.deepEqual(inspect(t, { [file]: 'import "../dist/index.js"; import "@oma/tui";' }), []);
  assert.match(inspect(t, { [file]: 'import "../../client/src/index.js";' }).join("\n"), /relative import leaves workspace/);
  assert.match(inspect(t, { [file]: 'import "hidden-test-library";' }).join("\n"), /undeclared runtime dependency/);
  assert.match(inspect(t, { [file]: 'import { createRequire as factory } from "node:module"; const load = factory(import.meta.url); load("../../client/dist/index.js");' }).join("\n"), /relative import leaves workspace/);
  assert.match(inspect(t, { "packages/native/src/index.ts": 'import type { Value } from "@oma/client"; export type Result = Value;' },
    { native: { devDependencies: { "@oma/client": "0.1.0" } } }).join("\n"), /forbidden dependency @oma\/client/);
});

test("DR46: tool packages use their declared runtime API and cannot borrow state owners", t => {
  const file = "packages/tool-lsp/src/index.ts";
  assert.deepEqual(inspect(t, { [file]: 'import type { Value } from "@oma/tool-runtime";' },
    { "tool-lsp": { dependencies: { "@oma/tool-runtime": "0.1.0" } } }), []);
  assert.match(inspect(t, { [file]: 'import type { Value } from "@oma/native";' },
    { "tool-lsp": { dependencies: { "@oma/native": "0.1.0" } } }).join("\n"), /forbidden dependency/);
  assert.match(inspect(t, { [file]: 'import "../../../src/mail.js";' }).join("\n"), /relative import leaves workspace/);
});

test("NATIVE-008: tool-files is independent of the SDK and application owners; consumers use its public API", t => {
  const file = "packages/tool-files/src/index.ts";
  assert.deepEqual(inspect(t, { [file]: 'import "node:fs"; export type Value = string;' }), []);
  for (const name of ["@oma/storage", "@oma/tool-runtime", "@oma/client", "@earendil-works/pi-coding-agent"])
    for (const statement of [`import "${name}";`, `import type { Value } from "${name}";`, `type Value = import("${name}").Value;`])
      assert.match(inspect(t, { [file]: statement }, { "tool-files": { dependencies: { [name]: "0.1.0" } } }).join("\n"), /tool-files may import only/);
  assert.match(inspect(t, {}, { "tool-files": { dependencies: { "hidden-sdk": "1.0.0" } } }).join("\n"), /no runtime package dependencies/);
  for (const name of ["tool-runtime", "tool-lsp"])
    assert.deepEqual(inspect(t, { [`packages/${name}/src/index.ts`]: 'import type { Value } from "@oma/tool-files";' },
      { [name]: { dependencies: { "@oma/tool-files": "0.1.0" } } }), []);
  assert.match(inspect(t, { "packages/tool-runtime/src/index.ts": 'import "@oma/tool-files/descriptor-files";' },
    { "tool-runtime": { dependencies: { "@oma/tool-files": "0.1.0" } } }).join("\n"), /private or missing export/);
});

test("DR46: a local compiled module URL resolves only to an authored executable module in that workspace", t => {
  assert.deepEqual(inspect(t, { "packages/domain/src/index.ts": 'new URL("./owned.js", import.meta.url);',
    "packages/domain/src/owned.ts": 'export const owned = true;' }), []);
  for (const target of ["./missing.js", "../dist/unowned.js", "../../contracts/src/index.js", "./payload.sql", "./ambient.js"])
    assert.match(inspect(t, { "packages/domain/src/index.ts": `new URL(${JSON.stringify(target)}, import.meta.url);`,
      "packages/domain/src/ambient.d.ts": 'export type Ambient = string;' }).join("\n"), /unowned or missing package asset/);
});

test("native generated asset ownership accepts only reviewed owner, output and declared source", t => {
  for (const [owner, directory, output, extension] of [["platform-mac", "seatbelt", "oma-seatbelt", "c"], ["native", "metadata", "oma-file-metadata", "c"], ["platform-mac", "keychain", "oma-keychain", "swift"]]) {
    const manifest = { oma: { assets: [`${directory}/main.${extension}`], darwinExecutables: [`${directory}/${output}`] } };
    const source = `new URL("./${directory}/${output}", import.meta.url);`;
    const files = { [`packages/${owner}/src/index.ts`]: source, [`packages/${owner}/src/${directory}/main.${extension}`]: "// native build input" };
    assert.deepEqual(inspect(t, files, { [owner]: manifest }), []);
    assert.match(inspect(t, { "packages/domain/src/index.ts": source, [`packages/domain/src/${directory}/main.${extension}`]: "// native build input" },
      { domain: manifest }).join("\n"), /unowned or missing package asset/);
    assert.match(inspect(t, { [`packages/${owner}/src/index.ts`]: source }, { [owner]: manifest }).join("\n"), /unowned or missing package asset/);
    for (const change of [{ assets: [] }, { darwinExecutables: [`${directory}/other`] }, { darwinExecutables: [`${directory}/${output}`, `${directory}/${output}`] }])
      assert.match(inspect(t, files, { [owner]: { oma: { ...manifest.oma, ...change } } }).join("\n"), /unowned or missing package asset/);
  }
});

test("DR46 Linux: OS adapters use file APIs and named observations without borrowing configuration or application services", t => {
  const file = "packages/platform-linux/src/index.ts";
  for (const dependency of ["@oma/config", "@oma/client", "@oma/mail"])
    assert.match(inspect(t, { [file]: `import type { Value } from "${dependency}";` },
      { "platform-linux": { dependencies: { [dependency]: "0.1.0" } } }).join("\n"), /forbidden dependency/);
  assert.match(inspect(t, { [file]: 'import type { Value } from "@oma/storage";' },
    { "platform-linux": { dependencies: { "@oma/storage": "0.1.0" } } }).join("\n"), /storage ledger capability forbidden/);
  assert.deepEqual(inspect(t, { [file]: 'import type { Value } from "@oma/storage/durable-fs";',
    "packages/storage/src/durable-fs.ts": 'export interface Value {}' },
    { storage: { exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
        "./durable-fs": { types: "./dist/durable-fs.d.ts", default: "./dist/durable-fs.js" } } },
      "platform-linux": { dependencies: { "@oma/storage": "0.1.0" } } }), []);
});

test("DR46 Mac: native adapters cannot borrow SDK, application, ledger or Git workflow ownership", t => {
  const file = "packages/platform-mac/src/index.ts";
  for (const name of ["@oma/config", "@oma/client", "@oma/storage", "@oma/review", "@oma/git"])
    assert.match(inspect(t, {[file]: `import type { Value } from "${name}";`},
      {"platform-mac": {dependencies: {[name]: "0.1.0"}}}).join("\n"), /forbidden dependency/);
  for (const statement of ['import "@oma/git";', 'import type { Value } from "@oma/git";', 'type Value = import("@oma/git").Value;'])
    assert.match(inspect(t, {[file]: statement}, {"platform-mac": {dependencies: {"@oma/git":"0.1.0"}}}).join("\n"), /forbidden dependency/);
  assert.match(inspect(t, {[file]:'import type { Value } from "@oma/git/project-preparation";'},
    {"platform-mac":{dependencies:{"@oma/git":"0.1.0"}}}).join("\n"), /forbidden dependency/);
  assert.deepEqual(inspect(t, {[file]:'import type { Actor } from "@oma/contracts";'},
    {"platform-mac":{dependencies:{"@oma/contracts":"0.1.0"}}}), []);
});

const privateAppMap = { "#oma-test/app/*": { types: "./apps/oma/dist/*.d.ts", default: "./apps/oma/dist/*.js" } };
function appFiles() {
  const exports = {}, files = { "package.json": { version: "0.1.0", type: "module", imports: privateAppMap } };
  for (const name of ["runtime/assets", "diagnostics/ledger", "diagnostics/integrity", "diagnostics/files"]) {
    exports[`./${name}`] = { types: `./dist/${name}.d.ts`, default: `./dist/${name}.js` };
    files[`apps/oma/src/${name}.ts`] = "export const value = true;";
  }
  files["apps/oma/package.json"] = { name: "@oma/app", version: "0.1.0", type: "module", exports };
  files["apps/oma/src/internal.ts"] = "export const value = true;";
  return files;
}
test("DR47: only root integration tests can name authored App internals", t => {
  for (const file of ["test/probe.test.ts", "implementation/tests/probe.type-test.ts"])
    assert.deepEqual(inspect(t, { ...appFiles(), [file]: 'import "#oma-test/app/internal";' }), []);
  for (const file of ["scripts/probe.mjs", "src/probe.ts", "apps/oma/src/probe.ts", "apps/oma/test/probe.test.mjs", "packages/client/src/probe.ts", "packages/client/test/probe.test.mjs"])
    for (const statement of ['import "#oma-test/app/internal";', 'import.meta.resolve("#oma-test/app/internal");'])
      assert.match(inspect(t, { ...appFiles(), [file]: statement }).join("\n"), /private App test import/);
  for (const name of ["missing", "../internal", "internal.js", "internal//x", "../../packages/client/src/index"])
    assert.match(inspect(t, { ...appFiles(), "test/probe.test.ts": `import "#oma-test/app/${name}";` }).join("\n"), /invalid private App test import/);
  assert.match(inspect(t, { ...appFiles(), "test/probe.test.ts": 'import "@oma/app/internal";' }).join("\n"), /private workspace import/);
});
test("DR47: tampered or widened private maps and resurrected public App APIs are refused", t => {
  for (const imports of [{}, { "#oma-test/app/*": "./apps/oma/dist/*.js" },
    { "#oma-test/app/*": { types: "./packages/client/dist/*.d.ts", default: "./packages/client/dist/*.js" } },
    { ...privateAppMap, "#any/*": "./packages/*/dist/index.js" }])
    assert.match(inspect(t, { ...appFiles(), "package.json": { version: "0.1.0", imports } }).join("\n"), /invalid private App test map/);
  const files = appFiles();
  files["apps/oma/package.json"].exports["./internal"] = { types: "./dist/internal.d.ts", default: "./dist/internal.js" };
  assert.match(inspect(t, files).join("\n"), /App public API differs/);
});
