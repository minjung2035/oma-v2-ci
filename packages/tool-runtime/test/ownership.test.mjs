import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { containWorkspaceTools, createContainedWriter } from "@oma/tool-runtime/contained-tools";
import { createToolProvenance } from "@oma/tool-runtime/provenance";
import { Type } from "typebox";
import { registerTypedTool, textResult } from "@oma/tool-runtime/shared";

test("a refused queued write does not poison the next contained write", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-tool-runtime-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  const write = createContainedWriter(workspace);
  const first = write(join(root, "escape"), "must refuse");
  const second = write(join(workspace, "nested", "answer"), "complete");
  await assert.rejects(first);
  await second;
  assert.equal(existsSync(join(root, "escape")), false);
  assert.equal(readFileSync(join(workspace, "nested", "answer"), "utf8"), "complete");
});
test("a later tool shadow is checked against the current registry", () => {
  let tools = [{ name: "read", sourceInfo: { source: "builtin" } }];
  const proof = createToolProvenance(() => tools, "/owned/core.js", []);
  assert.equal(proof.permitted("read"), true);
  tools = [{ name: "read", sourceInfo: { source: "extension", path: "/unverified/shadow.js" } }];
  assert.equal(proof.permitted("read"), false);
  assert.equal(proof.own("read"), false);
  tools = [];
  assert.equal(proof.permitted("read"), false);
});

test("raw and direct-call guards reject coercion before effects and preserve required CAS null", async () => {
  let registered, effects = 0;
  registerTypedTool({ registerTool(tool) { registered = tool; } }, {
    name: "guarded_effect", label: "Guarded effect", description: "Exercise the shared effect boundary.",
    parameters: Type.Object({
      body: Type.String(),
      expectedRevision: Type.Union([Type.String(), Type.Null()]),
      note: Type.Optional(Type.String()),
      replacement: Type.Optional(Type.Object({ candidate: Type.String(), base: Type.String() },
        { additionalProperties: false })),
    }, { additionalProperties: false }),
    async execute(_id, args) { effects++; return textResult("applied", args); },
  });
  for (const body of [null, 1, false]) {
    const args = { body, expectedRevision: null };
    assert.throws(() => registered.prepareArguments(args), /Invalid arguments/);
    await assert.rejects(registered.execute("bad", args), /Invalid arguments/);
  }
  for (const args of [
    { body: "valid", expectedRevision: null, extra: true },
    { body: "valid" },
    { body: "valid", expectedRevision: null, replacement: { candidate: "HEAD" } },
    { body: "valid", expectedRevision: null, replacement: { candidate: "HEAD", base: 1 } },
  ]) {
    assert.throws(() => registered.prepareArguments(args), /Invalid arguments/);
    await assert.rejects(registered.execute("bad", args), /Invalid arguments/);
  }
  assert.equal(effects, 0);
  const optionalNull = { body: "valid", expectedRevision: null, note: null };
  assert.deepEqual(registered.prepareArguments(optionalNull), optionalNull,
    "the guard permits Pi-owned optional-null normalization without changing the CAS null");
  const result = await registered.execute("valid", { body: "valid", expectedRevision: null });
  assert.equal(effects, 1);
  assert.equal(result.details.expectedRevision, null);
});

test("shell metadata adaptation preserves configured executable and changing command prefixes", async t => {
  const workspace = mkdtempSync(join(tmpdir(), "oma-shell-settings-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const shell = join(workspace, "shell");
  writeFileSync(shell, '#!/bin/sh\nexport OMA_SHELL_PROBE=custom\nexec /bin/sh "$@"\n', { mode: 0o755 });
  const tools = new Map();
  let settings;
  containWorkspaceTools({
    registerTool(tool) { tools.set(tool.name, tool); },
    getSettings() {
      assert.ok(settings, "settings are unavailable during registration");
      return settings;
    },
  }, workspace, true);
  const run = () => tools.get("bash").execute("settings-probe",
    { command: 'printf "%s" "$OMA_SHELL_PROBE:$OMA_PREFIX_PROBE"' },
    undefined, undefined, undefined);
  settings = { shellPath: shell, shellCommandPrefix: "export OMA_PREFIX_PROBE=first" };
  assert.equal((await run()).content[0].text, "custom:first");
  settings = { ...settings, shellCommandPrefix: "export OMA_PREFIX_PROBE=second" };
  assert.equal((await run()).content[0].text, "custom:second");
  settings = { shellPath: shell };
  assert.equal((await run()).content[0].text, "custom:");
});
