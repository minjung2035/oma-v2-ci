import test from "node:test";
import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import type { HostConfigV1 } from "../implementation/contracts.js";
import { loadConfig } from "../src/config.js";
import {
  deploymentManifest,
  deploymentDigest,
  assertDeploymentDigest,
} from "../src/runtime/deployment-manifest.js";
import { assertHostDirectoryLayout } from "../src/runtime/assets.js";
import { assertStorageQuotaSupported } from "../src/domain/resources.js";
import { assertStorageQuotaAdmission } from "../src/storage/quota.js";
import { ProcessLock } from "../src/runtime/process-lock.js";
import { TEST_RESOURCES } from "./fixtures/spec.js";

const project = fileURLToPath(new URL("../../", import.meta.url));
function config(root: string): HostConfigV1 {
  return {
    schemaVersion: 1,
    society: "fixture",
    installation: {
      node: process.execPath,
      libdir: root,
      rootfs: root,
      deploymentDigest: deploymentDigest(root),
    },
    modelProfiles: {
      model: {
        provider: "fixture",
        model: "fixture",
        inferenceTimeoutSeconds: 1,
      },
    },
    agentProfiles: {
      p: {
        modelProfile: "model",
        capabilities: [],
        delegable: [],
        childProfile: null,
        resources: TEST_RESOURCES,
      },
    },
    principalProfile: "p",
    initialResidents: [],
    quota: {
      societyAgents: 1,
      lineageAgents: 1,
      storageBytes: 1024,
    },
    integration: { policyRevision: "fixture", protectedPaths: [], checks: [] },
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
      idleStreamSeconds: 1,
      receiptWaitSeconds: 1,
    },
  };
}

test("P02: canonical deployment manifest pins every selected byte independent of root and traversal order", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-deployment-codec-"));
  const contents: Record<string, string> = {
    "dist/src/z.js": "z\n",
    "dist/src/nested/a.js": "a\n",
    "dist/implementation/contracts.js": "export {};\n",
    "implementation/systemd/resident.path.in": "[Path]\n",
    "implementation/schema-v3.sql": "schema\n",
    // AV16: the sandbox's `oma` command is pinned with the rest.
    "dist/libexec/oma": "#!/bin/sh\n",
    "package.json": "{}",
    "package-lock.json": "{}",
  };
  try {
    for (const [path, bytes] of Object.entries(contents)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), bytes);
    }
    const expected = {
      version: 1,
      files: Object.keys(contents)
        .sort()
        .map((path) => ({
          path,
          bytes: Buffer.byteLength(contents[path]!),
          sha256: createHash("sha256").update(contents[path]!).digest("hex"),
        })),
    };
    assert.deepEqual(deploymentManifest(root), expected);
    assert.deepEqual(deploymentManifest(`${root}/`), expected);
    const digest = createHash("sha256")
      .update(JSON.stringify(expected))
      .digest("hex");
    assert.equal(deploymentDigest(root), digest);
    assert.doesNotThrow(() => assertDeploymentDigest(root, digest));
    for (const path of Object.keys(contents)) {
      writeFileSync(join(root, path), contents[path]! + " ");
      assert.throws(() => assertDeploymentDigest(root, digest), {
        code: "UNSUPPORTED_PROFILE",
      });
      writeFileSync(join(root, path), contents[path]!);
    }
    rmSync(join(root, "dist/src/z.js"));
    symlinkSync("nested/a.js", join(root, "dist/src/z.js"));
    assert.throws(() => deploymentDigest(root), {
      code: "UNSUPPORTED_PROFILE",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("P02: installed broker refuses deployment mismatch BEFORE SQLite or unit effects", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-deployment-entry-"));
  try {
    for (const path of [
      "dist/src",
      "dist/implementation",
      "implementation/systemd",
      "implementation/schema-v3.sql",
      "dist/libexec",
      "package.json",
      "package-lock.json",
    ]) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      cpSync(join(project, path), join(root, path), { recursive: true });
    }
    symlinkSync(join(project, "node_modules"), join(root, "node_modules"));
    const cfg = config(root);
    const configPath = join(root, "host.json");
    const state = join(root, "data/oma/fixture");
    const runtime = join(root, "run/oma/fixture");
    mkdirSync(state, { recursive: true });
    const run = () => {
      writeFileSync(configPath, JSON.stringify(cfg));
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        HOME: root,
        XDG_DATA_HOME: join(root, "data"),
        XDG_RUNTIME_DIR: join(root, "run"),
      };
      delete env.NOTIFY_SOCKET;
      delete env.DBUS_SESSION_BUS_ADDRESS;
      const result = spawnSync(
        process.execPath,
        [
          join(root, "dist/src/entry/broker.js"),
          "--society",
          "fixture",
          "--config",
          configPath,
        ],
        { env, encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024 },
      );
      assert.equal(result.error, undefined);
      assert.equal(result.signal, null);
      assert.notEqual(result.status, 0);
      for (const suffix of ["", "-wal", "-shm"])
        assert.equal(existsSync(join(state, `runtime.sqlite${suffix}`)), false);
      assert.equal(existsSync(join(runtime, "admin.sock")), false);
      const lock = ProcessLock.acquire(join(runtime, "broker.lock"));
      lock.close();
      return result.stderr;
    };
    const asset = join(root, "dist/src/mail/facts.js");
    const bytes = readFileSync(asset);
    writeFileSync(
      asset,
      Buffer.concat([bytes, Buffer.from("\n// changed deployment byte\n")]),
    );
    assert.match(run(), /UNSUPPORTED_PROFILE.*deploymentDigest/);
    writeFileSync(asset, bytes);
    for (const invalid of ["", "fixture", "A".repeat(64), "a".repeat(63)]) {
      cfg.installation.deploymentDigest = invalid;
      writeFileSync(configPath, JSON.stringify(cfg));
      assert.throws(() => loadConfig(configPath), { code: "INVALID_REQUEST" });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("P05: symlinked host ancestors are explicitly unsupported, not store corruption", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-host-layout-"));
  try {
    mkdirSync(join(root, "volume"));
    symlinkSync("volume", join(root, "state"));
    assert.doesNotThrow(() =>
      assertHostDirectoryLayout(join(root, "volume/new/society"), true),
    );
    assert.throws(
      () => assertHostDirectoryLayout(join(root, "state/new/society"), true),
      { code: "UNSUPPORTED_PROFILE" },
    );
    assert.throws(() => assertHostDirectoryLayout(join(root, "missing")), {
      code: "UNSUPPORTED_PROFILE",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("P01: positive storage quota admits an observed owned tree and rejects overflow", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-storage-quota-"));
  try {
    writeFileSync(join(root, "payload"), Buffer.alloc(4096));
    assert.doesNotThrow(() => assertStorageQuotaAdmission(root, 1024 * 1024));
    assert.doesNotThrow(() => assertStorageQuotaAdmission(root, 1));
    assert.doesNotThrow(() => assertStorageQuotaAdmission(root, 1024 * 1024, 1024 * 1024));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  assert.doesNotThrow(() => assertStorageQuotaSupported(0));
  for (const cap of [-1, Infinity, NaN])
    assert.throws(() => assertStorageQuotaSupported(cap), { code: "UNSUPPORTED_PROFILE" });
});
