import { sha256Hex } from "@oma/domain/canonical-json";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { HostConfig } from "@oma/contracts";
import { StoreError } from "@oma/domain/errors";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
import { HOST_CONFIGURATION_VERSION } from "@oma/domain/config-format";
import { CAPABILITIES, isCapability } from "@oma/domain/capabilities";

import { PROTOCOL_LIMIT_FIELDS } from "@oma/domain/limits";
import { loadConfig } from "@oma/config";
import { readConfigurationSource } from "@oma/config/operations";
import { defaultHostConfig, defaultSocietyFor } from "@oma/config/defaults";
import { readSettings } from "#oma-test/app/application/settings";
import { PUBLIC_METHODS, INTERNAL_METHODS } from "@oma/protocol/methods";

const scratch = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix));

function installedConfig(root: string): HostConfig {
  mkdirSync(dirname(join(root, DEPLOYMENT_LAYOUT.extension)), { recursive: true });
  writeFileSync(join(root, DEPLOYMENT_LAYOUT.extension), "export {};\n");
  return defaultHostConfig({
    society: defaultSocietyFor(root, sha256Hex(root)), node: process.execPath,
    libdir: root,  deploymentDigest: "b".repeat(64),
  });
}

test("the generated configuration passes core's own closed validator unchanged", () => {
  const root = scratch("oma-couple-config-");
  try {
    const path = join(root, "config.json");
    writeFileSync(path, JSON.stringify(installedConfig(root), null, 2));
    // Not a relaxed parse: this is the validator broker and runner use.
    const loaded = loadConfig(path);
    assert.equal(loaded.schemaVersion, HOST_CONFIGURATION_VERSION);

    // Every capability the product grants must be in core's closed vocabulary.
    for (const profile of Object.values(loaded.agentProfiles)) {
      for (const capability of [...profile.capabilities, ...profile.delegable])
        assert.ok(isCapability(capability), `unknown capability ${capability}`);
    }
    for (const field of Object.keys(PROTOCOL_LIMIT_FIELDS))
      assert.ok(Object.hasOwn(loaded.limits, field), `missing limit ${field}`);
    // The product must not invent a capability that core does not know.
    assert.ok(CAPABILITIES.length > 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a default configuration seeds one autonomous Worker without canonical main authority", () => {
  const root = scratch("oma-couple-grant-");
  try {
    const config = installedConfig(root);
    for (const [name, profile] of Object.entries(config.agentProfiles))
      assert.ok(!profile.capabilities.includes("code.integrate"), `${name} must not integrate by default`);
    assert.equal(config.initialResidents.length, 1);
    assert.equal(config.initialResidents[0]!.profile, "resident");
    assert.equal(config.agentProfiles[config.principalProfile]!.childProfile, null);
    assert.ok(!config.agentProfiles[config.principalProfile]!.capabilities.includes("agent.create"));
    // A child can never exceed its parent's delegable set (CREATE-002's rule).
    const principal = config.agentProfiles[config.principalProfile]!;
    const childName = principal.childProfile;
    if (childName !== null) {
      const child = config.agentProfiles[childName]!;
      for (const capability of child.capabilities)
        assert.ok(principal.delegable.includes(capability),
          `child capability ${capability} is not delegable by the principal`);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("D23: a tool surface declared in a role fails the load -- it is internal policy, not configuration", () => {
  const root = scratch("oma-couple-surface-");
  try {
    const libdir = join(root, "lib");
    mkdirSync(dirname(join(libdir, DEPLOYMENT_LAYOUT.extension)), { recursive: true });
    writeFileSync(join(libdir, DEPLOYMENT_LAYOUT.extension), "export {};\n");
    writeFileSync(join(root, "prompt.md"), "");
    writeFileSync(join(root, "host.json"), JSON.stringify({ installation: { libdir } }));
    writeFileSync(join(root, "models.json"), JSON.stringify({}));
    const index = join(root, "index.json");
    writeFileSync(index, JSON.stringify({
      kind: "oma-operations-v1", host: "host.json", models: "models.json", roles: { resident: "role.json" },
    }));
    const writeRole = (extra: Record<string, unknown>): void => {
      writeFileSync(join(root, "role.json"), JSON.stringify({
        agentProfile: { modelProfile: "m" },
        extensions: [DEPLOYMENT_LAYOUT.extension],
        promptFile: "prompt.md",
        ...extra,
      }));
    };

    // Even a well-formed declaration is refused: the field is closed, so no
    // spelling of it can take effect through configuration.
    writeRole({ toolSurface: { defaultMode: "DISABLED", direct: ["read"],
      groups: [{ name: "web", description: "w", members: [{ tool: "fetch" }] }] } });
    assert.throws(() => readConfigurationSource(index),
      (error: unknown) => error instanceof StoreError && error.code === "INVALID_REQUEST");

    // Without it the same role loads, and its recorded extensions still carry
    // the digests the spawn path re-checks.
    writeRole({});
    const role = readConfigurationSource(index).roles["resident"]!;
    for (const extension of role.extensions) assert.match(extension.sha256, /^[0-9a-f]{64}$/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the product surface did not widen the broker's method surface", () => {
  // The TUI and the projection are read and configuration work. If either had
  // needed a new socket method, these closed sets would have changed.
  // IPC-008 adds the actor/key-bound receipt read, not a TUI capability;
  // mail-v1 adds review.status, the public filtered review read.
  assert.equal(Object.keys(PUBLIC_METHODS).length, 20);
  assert.equal(PUBLIC_METHODS["operation.read"].mode, "read");
  assert.equal(Object.keys(INTERNAL_METHODS).length, 8);
  for (const name of Object.keys(PUBLIC_METHODS))
    assert.doesNotMatch(name, /tui|surface|panel|config\./i, `${name} looks like a product-surface method`);
  for (const name of Object.keys(INTERNAL_METHODS))
    assert.doesNotMatch(name, /tui|surface|panel/i, `${name} looks like a product-surface method`);
  // Inference was removed with the relay; no method may reintroduce it here.
  for (const name of [...Object.keys(PUBLIC_METHODS), ...Object.keys(INTERNAL_METHODS)])
    assert.doesNotMatch(name, /inference/i);
});

test("a settings read composes through core rather than parsing config itself", () => {
  const root = scratch("oma-couple-read-");
  try {
    const path = join(root, "config.json");
    writeFileSync(path, JSON.stringify(installedConfig(root), null, 2));
    const settings = readSettings(path);
    // The composed config is the validator's output, so an invalid file cannot
    // reach a screen as a partially-parsed object.
    assert.deepEqual(settings.config, loadConfig(path));
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, society: "x" }));
    assert.throws(() => readSettings(path), (error: unknown) => error instanceof StoreError);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
