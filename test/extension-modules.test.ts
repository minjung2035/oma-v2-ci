/** The actual bundled loader and native ESM cache, not a fake cache implementation. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";
import { ExtensionModules } from "@oma/engine/extension-modules";

for (const format of ["ts", "js", "mjs", "module-js"]) test(`Extension modules: ${format} reload observes changed code and rejects its next failure`, async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-extension-modules-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  if (format === "module-js") writeFileSync(join(root, "package.json"), '{"type":"module"}');
  const file = join(root, `fixture.${format === "module-js" ? "js" : format}`);
  const source = (description: string): string => `export default pi => { pi.registerTool({ name: 'fixture', label: 'Fixture', description: '${description}',
    parameters: { type: 'object', properties: {} }, async execute() { return { content: [], details: {} }; } }); };\n`;
  writeFileSync(file, source("before"));
  const modules = new ExtensionModules([file]); t.after(() => modules.close());
  const loader = new DefaultResourceLoader({ cwd: root, agentDir: root, settingsManager: SettingsManager.inMemory(), noExtensions: true,
    noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, additionalExtensionPaths: [file] });
  const description = (): string | undefined => loader.getExtensions().extensions[0]?.tools.get("fixture")?.definition.description;
  await loader.reload(); assert.equal(description(), "before"); loader.getExtensions().runtime.invalidate();
  writeFileSync(file, source("after")); modules.refresh([file]);
  await loader.reload(); assert.equal(description(), "after"); loader.getExtensions().runtime.invalidate();
  writeFileSync(file, 'export default () => { throw new Error("FIXTURE_EXTENSION_FAILURE"); };\n'); modules.refresh([file]);
  await loader.reload(); assert.match(loader.getExtensions().errors[0]!.error, /FIXTURE_EXTENSION_FAILURE/);
  assert.equal(description(), undefined); loader.getExtensions().runtime.invalidate();
});

test("Extension modules: relative dependencies and late imports keep their parent's generation; unrelated modules are unchanged", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-extension-imports-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "entry.mjs"), other = join(root, "other.mjs"), dependency = join(root, "dependency.mjs");
  mkdirSync(join(root, "nested"));
  writeFileSync(file, "export { value } from './dependency.mjs'; export const late = () => import('./nested/late.mjs');\n");
  writeFileSync(dependency, "export const value = 'before';\n");
  writeFileSync(join(root, "nested/late.mjs"), "export const value = 'late';\n");
  writeFileSync(other, "export const value = 'unrelated';\n");
  const normal = await import(pathToFileURL(other).href);
  const modules = new ExtensionModules([file]); t.after(() => modules.close());
  const first = await import(pathToFileURL(file).href); assert.equal(first.value, "before");
  writeFileSync(dependency, "export const value = 'after';\n"); modules.refresh([file]);
  const second = await import(pathToFileURL(file).href); assert.equal(second.value, "after");
  assert.notEqual(first, second); assert.equal(await import(pathToFileURL(other).href), normal);
  assert.notEqual(await first.late(), await second.late(), "a late old import must not enter the replacement's module instance");
  modules.close(); modules.close();
  assert.throws(() => modules.refresh([file]), /owner is closed/);
  assert.equal(await import(pathToFileURL(other).href), normal);
  const unowned = await import(pathToFileURL(file).href);
  assert.notEqual(unowned, second); assert.equal(await import(pathToFileURL(file).href), unowned);
});

test("Extension modules: a failed path replacement preserves the complete selected set and its generation", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-extension-paths-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const firstFile = join(root, "first.mjs"), secondFile = join(root, "second.mjs");
  for (const file of [firstFile, secondFile]) writeFileSync(file, "export const value = {};\n");
  const modules = new ExtensionModules([firstFile, secondFile]); t.after(() => modules.close());
  const first = await import(pathToFileURL(firstFile).href), second = await import(pathToFileURL(secondFile).href);
  assert.throws(() => modules.refresh([firstFile, null as unknown as string]), { code: "ERR_INVALID_ARG_TYPE" });
  assert.equal(await import(pathToFileURL(firstFile).href), first);
  assert.equal(await import(pathToFileURL(secondFile).href), second);
  modules.refresh([secondFile]);
  assert.notEqual(await import(pathToFileURL(firstFile).href), first, "a removed entry uses its normal identity");
  assert.notEqual(await import(pathToFileURL(secondFile).href), second, "the retained entry advances only after complete validation");
});

test("Extension modules: independent owners sharing a dependency do not replace each other's identities", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-extension-owners-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const oneFile = join(root, "one.mjs"), twoFile = join(root, "two.mjs"), dependency = join(root, "shared.mjs");
  for (const file of [oneFile, twoFile]) writeFileSync(file, "export { value } from './shared.mjs';\n");
  writeFileSync(dependency, "export const value = 'before';\n");
  const one = new ExtensionModules([oneFile]), two = new ExtensionModules([twoFile]);
  t.after(() => { two.close(); one.close(); });
  const firstOne = await import(pathToFileURL(oneFile).href), firstTwo = await import(pathToFileURL(twoFile).href);
  assert.equal(firstOne.value, "before"); assert.equal(firstTwo.value, "before");
  writeFileSync(dependency, "export const value = 'after';\n"); one.refresh([oneFile]);
  assert.equal((await import(pathToFileURL(oneFile).href)).value, "after");
  assert.equal(await import(pathToFileURL(twoFile).href), firstTwo);
  one.close(); two.refresh([twoFile]);
  assert.equal((await import(pathToFileURL(twoFile).href)).value, "after");
});
