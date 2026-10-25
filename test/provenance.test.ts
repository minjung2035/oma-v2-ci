/** D25: authorization by provenance, never by name.
 *
 * The old Principal gate held a literal set of names: a tool answering to an
 * allowed name ran no matter who registered it, and an extension tool with an
 * unlisted name could never run at all. These tests pin the replacement: a
 * builtin's `source: "builtin"` authorizes it, an extension tool is authorized
 * only by the digest-verified `-e` path set the spawn wrote into the engine's
 * environment, and every lookup re-reads the live registry so a shadow, a
 * reload or a post-bind registration is judged on what would execute now. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { realpathSync } from "node:fs";
import { createToolProvenance, verifiedExtensionPaths } from "@oma/tool-runtime/provenance";
import type { ToolInfo } from "@earendil-works/pi-coding-agent";

/** A tool record as the engine reports it: a name plus where it came from. */
function tool(name: string, sourceInfo?: Partial<{ path: string; source: string; scope: string; origin: string }>): ToolInfo {
  return { name, description: "", parameters: {}, sourceInfo } as ToolInfo;
}
const builtin = (name: string): ToolInfo =>
  tool(name, { path: `<builtin:${name}>`, source: "builtin", scope: "user", origin: "top-level" });

test("verifiedExtensionPaths: absent, empty and malformed env spellings", () => {
  assert.deepEqual(verifiedExtensionPaths(undefined), { paths: [], malformed: false });
  assert.deepEqual(verifiedExtensionPaths("   "), { paths: [], malformed: false });
  for (const raw of ["{", "\"not-a-list\"", "[1]", "[\"\"]", "[]bogus",
    JSON.stringify(["a", "a", 1]), JSON.stringify([42])]) {
    assert.deepEqual(verifiedExtensionPaths(raw), { paths: [], malformed: true }, raw);
  }
  assert.deepEqual(verifiedExtensionPaths(JSON.stringify(["/a", "/b"])),
    { paths: ["/a", "/b"], malformed: false });
});

test("D25: builtins and verified extension paths are permitted; anything else is not", () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-prov-"));
  try {
    const ext = join(dir, "verified.js"); writeFileSync(ext, "export {};\n");
    const own = join(dir, "oma.js"); writeFileSync(own, "export {};\n");
    const other = join(dir, "other.js"); writeFileSync(other, "export {};\n");
    const registry = new Map<string, ToolInfo>([
      ["read", builtin("read")],
      ["from_ext", tool("from_ext", { path: ext, source: "local", scope: "user", origin: "package" })],
      ["from_other", tool("from_other", { path: other, source: "local", scope: "user", origin: "package" })],
      ["oma_mail_read", tool("oma_mail_read", { path: own, source: "local", scope: "user", origin: "top-level" })],
    ]);
    const provenance = createToolProvenance(() => [...registry.values()], own, [ext]);

    assert.equal(provenance.permitted("read"), true, "a builtin is permitted");
    assert.equal(provenance.permitted("from_ext"), true, "a verified-path extension tool is permitted");
    assert.equal(provenance.permitted("from_other"), false, "an unverified extension path is not");
    assert.equal(provenance.permitted("oma_mail_read"), true, "OMA's own file's tools are permitted");
    assert.equal(provenance.own("oma_mail_read"), true);
    assert.equal(provenance.permitted("missing"), false, "an unknown name is not permitted");
    // Per-call read: a registration that lands after the provenance was made
    // is judged when the call is checked, not when the surface was built.
    registry.set("late", tool("late", { path: ext, source: "local", scope: "user", origin: "package" }));
    assert.equal(provenance.permitted("late"), true, "a post-bind registration from a verified path is permitted");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("D25: a name shadowed by an unverified registration is not permitted, and is not OMA's", () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-prov-"));
  try {
    const own = join(dir, "oma.js"); writeFileSync(own, "export {};\n");
    const evil = join(dir, "evil.js"); writeFileSync(evil, "export {};\n");
    const registry = new Map<string, ToolInfo>([
      ["read", builtin("read")],
      ["oma_mail_read", tool("oma_mail_read", { path: own, source: "local", scope: "user", origin: "top-level" })],
    ]);
    const provenance = createToolProvenance(() => [...registry.values()], own, []);
    assert.equal(provenance.permitted("read"), true);
    assert.equal(provenance.own("oma_mail_read"), true);

    // A later registration replaces the name -- the registry's effective
    // entry now spells a different file, and the call must close.
    registry.set("read", tool("read", { path: evil, source: "local", scope: "user", origin: "package" }));
    registry.set("oma_mail_read", tool("oma_mail_read", { path: evil, source: "local", scope: "user", origin: "package" }));
    assert.equal(provenance.permitted("read"), false, "a shadowed builtin is not permitted");
    assert.equal(provenance.permitted("oma_mail_read"), false, "a shadowed OMA tool is not permitted");
    assert.equal(provenance.own("oma_mail_read"), false, "a shadow is not OMA's tool");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("D25: the same file spelled differently still matches -- the comparison is the real path", () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-prov-"));
  try {
    const real = join(dir, "ext.js"); writeFileSync(real, "export {};\n");
    const alias = join(dir, "alias.js"); symlinkSync("ext.js", alias);
    const nested = join(dir, "sub"); mkdirSync(nested);
    const registry = [tool("x", { path: alias, source: "local", scope: "user", origin: "package" })];
    const provenance = createToolProvenance(() => registry, real, [join(dir, "sub", "..", "ext.js")]);
    assert.equal(provenance.permitted("x"), true, "a verified path and a symlinked spelling name the same file");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("D25: missing or malformed provenance state fails closed, including a registry that cannot be read", () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-prov-"));
  try {
    const own = join(dir, "oma.js"); writeFileSync(own, "export {};\n");
    // No verified list at all: only builtins and OMA's own file pass.
    const bare = createToolProvenance(() => [builtin("read")], own, []);
    assert.equal(bare.permitted("read"), true);
    assert.equal(bare.permitted("anything_else"), false);

    // A tool record with no provenance, or a registry that throws, closes.
    const noInfo = createToolProvenance(() => [tool("x", undefined), tool("y", {})], own, []);
    assert.equal(noInfo.permitted("x"), false);
    assert.equal(noInfo.permitted("y"), false);
    const broken = createToolProvenance(() => { throw new Error("registry unavailable"); }, own, []);
    assert.equal(broken.permitted("read"), false);
    assert.equal(broken.own("read"), false);

    // A realpath the filesystem cannot answer still compares by spelling.
    const ghost = createToolProvenance(() => [tool("x", { path: join(dir, "gone.js"), source: "local", scope: "user", origin: "package" })],
      own, [join(dir, "gone.js")]);
    assert.equal(ghost.permitted("x"), true, "a missing file that was verified is still its spelling");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("D25: the spawn plans write the verified list the engine reads, in the same spelling", async () => {
  // The two sides must never disagree about the name: session.ts and
  // pi-spawn-plan.ts mirror the constant because the extension's files may not
  // be imported there (PI-001), so a test binds the mirror.
  const { VERIFIED_EXTENSIONS_ENV } = await import("@oma/tool-runtime/provenance");
  const { sessionEnv } = await import("@oma/engine/principal-session");
  const spawnPlan = await import("@oma/engine/pi-spawn-plan");
  assert.equal(VERIFIED_EXTENSIONS_ENV, "OMA_VERIFIED_EXTENSIONS");
  assert.equal(spawnPlan.VERIFIED_EXTENSIONS_ENV, VERIFIED_EXTENSIONS_ENV);

  const dir = mkdtempSync(join(tmpdir(), "oma-prov-env-"));
  try {
    const core = join(dir, "core.js"); writeFileSync(core, "export {};\n");
    const ext = join(dir, "ext.js"); writeFileSync(ext, "export {};\n");
    const env = sessionEnv({ HOME: "/h" }, {
      society: "demo", provider: "pi", model: "current", extensions: [{ path: ext, sha256: "0".repeat(64) }],
    }, { coreExtension: core });
    assert.deepEqual(verifiedExtensionPaths(env[VERIFIED_EXTENSIONS_ENV]),
      { paths: [core, ext], malformed: false }, "the env is the -e argv list, core first");
    // The trusted extension's own file is in that list: the loader spells it
    // as argv did, and provenance finds it by the same canonical path.
    const provenance = createToolProvenance(
      () => [tool("oma_mail_read", { path: core, source: "local", scope: "user", origin: "top-level" }),
             tool("ext_tool", { path: ext, source: "local", scope: "user", origin: "package" }),
             builtin("read")],
      realpathSync(core), verifiedExtensionPaths(env[VERIFIED_EXTENSIONS_ENV]).paths);
    assert.equal(provenance.permitted("oma_mail_read"), true);
    assert.equal(provenance.permitted("ext_tool"), true);
    assert.equal(provenance.permitted("read"), true);
    assert.equal(provenance.permitted("other"), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
