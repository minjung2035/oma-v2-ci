/** Complete inline + operations configuration, checked by the real loader.
 * Local extension bytes and a placeholder deployment digest are NOT an installed
 * runtime fixture, a provider credential, or permission to start a society. */
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import type { HostConfig } from "@oma/contracts";
import { loadConfiguration } from "@oma/config";
import { TEST_PROTOCOL_LIMITS } from "./limits.js";

export function createCompleteConfigurationFixture() {
  const root = mkdtempSync(join(tmpdir(), "oma-operations-"));
  try {
    const installation = join(root, "installation");
    mkdirSync(join(installation, "packages/extension/dist"), { recursive: true });
    writeFileSync(
      join(installation, "packages/extension/dist/index.js"),
      "export default function () {}\n",
    );
    const model = {
      provider: "fixture",
      model: "model-a",
      inferenceTimeoutSeconds: 30,
    };
    const profile = {
      modelProfile: "standard",
      capabilities: [],
      delegable: [],
      childProfile: null,
    };
    const config: HostConfig = {
    schemaVersion: 4,
    society: "demo",
    installation: {
        // A node that exists here: a runner entry resolves it for confinement.
        node: process.execPath,
        libdir: installation,
        deploymentDigest: "a".repeat(64),
    },
    modelProfiles: {
        standard: model,
        review: { ...model, model: "model-b" },
    },
    agentProfiles: {
        principal: structuredClone(profile),
        resident: structuredClone(profile),
        verifier: { ...structuredClone(profile), modelProfile: "review" },
    },
    principalProfile: "principal",
    initialResidents: [
        { name: "worker", profile: "resident", brief: "work" },
    ],
    integration: { policyRevision: "test", protectedPaths: [], checks: [] },
    limits: { ...TEST_PROTOCOL_LIMITS }
};
    const input = join(root, "legacy.json");
    writeFileSync(input, JSON.stringify(config));
    const output = join(root, "operations");
    const path = join(output, "config.json");
    const migrate = () =>
      spawnSync(
        process.execPath,
        [resolve("scripts/split-operations-config.mjs"), input, output],
        { encoding: "utf8", timeout: 10000 },
      );
    const result = migrate();
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    // Test-only reference values must still satisfy every production relation.
    // Assembly/readConfigurationSource alone is not this validation boundary.
    const inline = loadConfiguration(input);
    const operations = loadConfiguration(path);
    assert.deepEqual(operations.config, inline.config);
    // Deliberate authoring/corruption seam AFTER a validated baseline. Callers
    // must reload edited candidates themselves; edited bytes are not branded valid.
    const edit = (
      file: string,
      update: (value: Record<string, any>) => void,
    ) => {
      const target = join(output, file);
      const value = JSON.parse(readFileSync(target, "utf8"));
      update(value);
      writeFileSync(target, JSON.stringify(value));
    };
    return {
      root,
      installation,
      config,
      input,
      output,
      path,
      migrate,
      edit,
      close() {
        // Published managed generations are read-only (D02); the fixture owns them.
        spawnSync("chmod", ["-R", "u+rwX", root]);
        rmSync(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
