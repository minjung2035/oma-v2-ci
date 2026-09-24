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
import type { HostConfigV1 } from "../../implementation/contracts.js";
import { loadConfiguration } from "../../src/config.js";
import { TEST_RESOURCES } from "./spec.js";
import { TEST_PROTOCOL_LIMITS } from "./limits.js";

export function createCompleteConfigurationFixture() {
  const root = mkdtempSync(join(tmpdir(), "oma-operations-"));
  try {
    const installation = join(root, "installation");
    mkdirSync(join(installation, "dist/src"), { recursive: true });
    writeFileSync(
      join(installation, "dist/src/pi-extension.js"),
      "export default function () {}\n",
    );
    const model = {
      provider: "fixture",
      model: "model-a",
      credentialRef: "host-reference",
      codecRevision: "fixture-v1",
      pricingRevision: "price-v1",
      maxInputTokens: 1024,
      maxOutputTokens: 128,
      inferenceTimeoutSeconds: 30,
    };
    const profile = {
      modelProfile: "standard",
      capabilities: [],
      delegable: [],
      childProfile: null,
      resources: { ...TEST_RESOURCES },
    };
    const config: HostConfigV1 = {
      schemaVersion: 1,
      society: "demo",
      installation: {
        // A node that exists here: a runner entry resolves it for confinement.
        node: process.execPath,
        libdir: installation,
        rootfs: "/rootfs",
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
      quota: {
        societyAgents: 4,
        lineageAgents: 4,
        societyUnits: 4,
        lineageUnits: 4,
        principalReservedUnits: 1,
        inferenceSlots: 2,
        principalReservedSlots: 1,
        storageBytes: 1048576,
      },
      integration: { policyRevision: "test", protectedPaths: [], checks: [] },
      limits: { ...TEST_PROTOCOL_LIMITS },
      features: {
        notmuch: false,
        reflinkSeed: false,
        formalApproval: false,
        egress: false,
      },
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
        rmSync(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
