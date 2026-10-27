import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { legacyFindings } from "../scripts/check-legacy.mjs";

test("DR59: retired presentation and invocation channels cannot return under another owner", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-native-channel-removal-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "apps/oma/src/runtime/example.ts");
  mkdirSync(dirname(path), { recursive: true });
  for (const source of ['const value = process.env.INVOCATION_ID;', 'const value = process.env["INVOCATION_ID"];',
    'const value = process.env["OMA_PRODUCT_TEXT"];', 'export function surfaceWords(text) { return text; }']) {
    writeFileSync(path, source);
    assert.ok(legacyFindings(root).length > 0, source);
  }
  writeFileSync(path, 'const value = process.env.OMA_TOOL_SURFACE_HEX;');
  assert.deepEqual(legacyFindings(root), []);
});

test("DR59: retired inference handoff is rejected without banning the active Principal channel", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-native-relay-removal-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const relay = join(root, "apps/oma/src/runtime/inference-relay.ts");
  mkdirSync(dirname(relay), { recursive: true });
  writeFileSync(relay, 'class InferenceRelay { static detached() {} accept() {} }');
  assert.match(legacyFindings(root).join("\n"), /retired relay handoff/);
  writeFileSync(relay, 'class InferenceRelay {}');
  const principal = join(root, "packages/extension/src/principal-channel.ts");
  mkdirSync(dirname(principal), { recursive: true });
  writeFileSync(principal, 'class PrincipalChannel { static detached() {} }');
  assert.deepEqual(legacyFindings(root), []);
});

test("NATIVE-010: the removed tool-runtime file implementation cannot return as a compatibility export", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-tool-files-removal-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "packages/tool-runtime/src/contained-files.ts");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, 'export * from "@oma/tool-files";');
  assert.match(legacyFindings(root).join("\n"), /removed compatibility surface/);
});

test("completed removals reject old import facades and declarations while retaining same-build recovery", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-legacy-removals-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, text) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  write("packages/domain/src/recovery.ts", "// enforceQuota was removed; unknown receipts still recover.\nexport function recoverPending() {}\n");
  assert.deepEqual(legacyFindings(root), []);
  write("src/process/run.ts", 'export * from "@oma/process/run";');
  assert.match(legacyFindings(root).join("\n"), /removed compatibility surface/);
  rmSync(join(root, "src/process"), { recursive: true });
  write("packages/domain/src/recovery.ts", "export const enforceQuota = () => {};\n");
  assert.match(legacyFindings(root).join("\n"), /removed declaration enforceQuota/);
});

test("DR46 current format: removed resource and attestation types cannot be reintroduced under another owner", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-removed-formats-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "packages/contracts/src"), { recursive: true });
  const target = join(root, "packages/contracts/src/host.ts");
  for (const declaration of ["export interface ResourceLimits { cpu: number }", "export type LegacyAttestationInput = { kind: 'peer' };"])
  { writeFileSync(target, declaration); assert.match(legacyFindings(root).join("\n"), /removed declaration/); }
});

test("DR46-F02: a tool cannot reintroduce a configurable vendor verification location", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-vendor-override-removal-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "packages/tool-lsp/src/options.ts");
  mkdirSync(dirname(path), { recursive: true });
  for (const property of ["bundleDir", '\"bundleDir\"']) {
    writeFileSync(path, `export interface Options { ${property}?: string }\n`);
    assert.match(legacyFindings(root).join("\n"), /removed vendor location override/);
  }
  writeFileSync(path, "export function verifyOwnedBundle(bundleDir: string) {}\n");
  assert.deepEqual(legacyFindings(root), []);
});

test("DR46: core extension compatibility entries and mirrored channel aliases stay removed", t => {
  const root = mkdtempSync(join(tmpdir(), "oma-extension-owner-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of ["src/pi-extension.ts", "src/extension/entry.ts", "tsconfig.extension.json"]) {
    const path = join(root, file); mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{}");
    assert.match(legacyFindings(root).join("\n"), /removed compatibility surface/);
    rmSync(path);
    if (file.startsWith("src/extension/")) rmSync(dirname(path), { recursive: true });
  }
  const file = join(root, "packages/extension/src/principal-channel.ts");
  mkdirSync(dirname(file), { recursive: true });
  for (const name of ["PRINCIPAL_CHANNEL_ENV", "PRINCIPAL_CHANNEL_FD"]) {
    writeFileSync(file, `export const ${name} = 3;`);
    assert.match(legacyFindings(root).join("\n"), /removed declaration/);
  }
});
