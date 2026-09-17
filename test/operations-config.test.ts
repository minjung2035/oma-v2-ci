import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import type { HostConfigV1 } from "../implementation/contracts.js";
import { loadConfig, loadConfiguration } from "../src/config.js";
import { TEST_RESOURCES } from "./fixtures/spec.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "oma-operations-"));
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
    resources: TEST_RESOURCES,
  };
  const config: HostConfigV1 = {
    schemaVersion: 1,
    society: "demo",
    installation: {
      node: "/usr/bin/node",
      libdir: installation,
      rootfs: "/rootfs",
      deploymentDigest: "a".repeat(64),
    },
    modelProfiles: { standard: model, review: { ...model, model: "model-b" } },
    agentProfiles: {
      principal: profile,
      resident: profile,
      verifier: { ...profile, modelProfile: "review" },
    },
    principalProfile: "principal",
    initialResidents: [{ name: "worker", profile: "resident", brief: "work" }],
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
    limits: {
      frameBytes: 262144,
      mailBodyBytes: 262144,
      subjectBytes: 512,
      addresses: 64,
      replyReferences: 64,
      contextFiles: 256,
      contextBytes: 8388608,
      bundleBytes: 268435456,
      logBytes: 1048576,
      batchMaxMessages: 24,
      idleStreamSeconds: 60,
      receiptWaitSeconds: 60,
    },
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
  assert.equal(result.status, 0, result.stderr);
  const edit = (file: string, update: (value: Record<string, any>) => void) => {
    const path = join(output, file);
    const value = JSON.parse(readFileSync(path, "utf8"));
    update(value);
    writeFileSync(path, JSON.stringify(value));
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
}

test("OPS config: migration preserves the closed host contract and does not overwrite input/output", () => {
  const f = fixture();
  try {
    const before = readFileSync(f.input);
    const config = loadConfiguration(f.path);
    assert.deepEqual(config.config, loadConfig(f.input));
    assert.deepEqual(Object.keys(config.roles), [
      "principal",
      "resident",
      "verifier",
    ]);
    assert.equal(config.roles.verifier!.prompt, "");
    assert.equal(config.roles.verifier!.extensions.length, 1);
    assert.match(
      config.roles.verifier!.extensions[0]!.sha256,
      /^[a-f0-9]{64}$/,
    );
    assert.equal(f.migrate().status, 2);
    assert.deepEqual(readFileSync(f.input), before);
    const alias = join(f.root, "selected-config.json");
    symlinkSync(f.path, alias);
    assert.deepEqual(loadConfig(alias), config.config);
    assert.deepEqual(loadConfig(f.path), config.config);
  } finally {
    f.close();
  }
});

test("OPS config: role models/prompts/extensions change only in a newly loaded snapshot", () => {
  const f = fixture();
  try {
    const old = loadConfiguration(f.path);
    writeFileSync(
      join(f.output, "prompts/verifier.md"),
      "Verify independently.\n",
    );
    writeFileSync(
      join(f.installation, "verifier.js"),
      "throw new Error('configuration must not execute extensions');\n",
    );
    f.edit("roles/verifier.json", (role) =>
      role.extensions.push("verifier.js"),
    );
    f.edit("models.json", (models) => {
      models.review.model = "model-c";
    });
    const fresh = loadConfiguration(f.path);
    assert.equal(old.config.modelProfiles.review!.model, "model-b");
    assert.equal(old.roles.verifier!.prompt, "");
    assert.equal(old.roles.verifier!.extensions.length, 1);
    assert.equal(fresh.config.modelProfiles.review!.model, "model-c");
    assert.equal(fresh.roles.verifier!.prompt, "Verify independently.\n");
    assert.equal(fresh.roles.verifier!.extensions.length, 2);
    assert.ok(Object.isFrozen(fresh.roles));
    assert.ok(Object.isFrozen(fresh.roles.verifier));
    assert.ok(Object.isFrozen(fresh.roles.verifier!.extensions));
    assert.equal(fresh.config.agentProfiles.resident!.modelProfile, "standard");
  } finally {
    f.close();
  }
});

for (const [name, file, update] of [
  [
    "unknown manifest field",
    "config.json",
    (v: any) => {
      v.extra = true;
    },
  ],
  [
    "duplicate ownership",
    "host.json",
    (v: any) => {
      v.modelProfiles = {};
    },
  ],
  [
    "missing model",
    "roles/verifier.json",
    (v: any) => {
      v.agentProfile.modelProfile = "missing";
    },
  ],
  [
    "missing required model setting",
    "models.json",
    (v: any) => {
      delete v.review.provider;
    },
  ],
  [
    "extra role field",
    "roles/verifier.json",
    (v: any) => {
      v.permissions = ["all"];
    },
  ],
  [
    "removed core extension",
    "roles/verifier.json",
    (v: any) => {
      v.extensions = [];
    },
  ],
  [
    "path traversal",
    "roles/verifier.json",
    (v: any) => {
      v.promptFile = "../legacy.json";
    },
  ],
  [
    "remote extension",
    "roles/verifier.json",
    (v: any) => {
      v.extensions.push("https://example.invalid/plugin.js");
    },
  ],
] as const) {
  test(`OPS config: rejects ${name} without fallback defaults`, () => {
    const f = fixture();
    try {
      f.edit(file, update);
      assert.throws(() => loadConfiguration(f.path), {
        code: "INVALID_REQUEST",
      });
    } finally {
      f.close();
    }
  });
}
test("OPS config: runner entry selects the broker-rendered role at startup without executing Pi", () => {
  const f = fixture();
  try {
    const capture = join(f.root, "selected.json");
    const preload = join(f.root, "capture.mjs");
    writeFileSync(
      preload,
      `import { writeFileSync } from 'node:fs';
      import { RunnerModule } from ${JSON.stringify(new URL("../src/runner.js", import.meta.url).href)};
      RunnerModule.prototype.run = async function () { writeFileSync(${JSON.stringify(capture)}, JSON.stringify(this.profile)); return 0; };`,
    );
    const run = spawnSync(
      process.execPath,
      [
        "--import",
        preload,
        resolve("dist/src/entry/runner.js"),
        "--society",
        "demo",
        "--agent",
        "worker",
        "--config",
        f.path,
      ],
      {
        env: {
          ...process.env,
          OMA_PROFILE_HEX: Buffer.from("verifier").toString("hex"),
        },
        encoding: "utf8",
        timeout: 10000,
      },
    );
    assert.equal(run.status, 0, run.stderr);
    const selected = JSON.parse(readFileSync(capture, "utf8"));
    assert.equal(selected.name, "verifier");
    assert.equal(selected.model.model, "model-b");
    assert.equal(
      selected.settings.extensions[0].path,
      join(f.installation, "dist/src/pi-extension.js"),
    );
  } finally {
    f.close();
  }
});

test("OPS config: rejects symlinked and oversized prompt assets", () => {
  const f = fixture();
  try {
    const prompt = join(f.output, "prompts/verifier.md");
    rmSync(prompt);
    symlinkSync(f.input, prompt);
    assert.throws(() => loadConfiguration(f.path), { code: "INVALID_REQUEST" });
    rmSync(prompt);
    writeFileSync(prompt, "x".repeat(1024 * 1024 + 1));
    assert.throws(() => loadConfiguration(f.path), { code: "INVALID_REQUEST" });
  } finally {
    f.close();
  }
});
