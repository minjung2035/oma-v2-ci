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
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import type { HostConfig } from "@oma/contracts";
import { loadConfig } from "@oma/config";
import {
  deploymentManifest,
  deploymentDigest,
  assertDeploymentDigest,
} from "#oma-test/app/runtime/deployment-manifest";
import { assertHostDirectoryLayout } from "@oma/native/directory-layout";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
import { ProcessLock } from "@oma/native/process-lock";
import { copyInstalledProduct } from "./fixtures/installation.js";

const project = fileURLToPath(new URL("../../", import.meta.url));
function config(root: string): HostConfig {
  return {
    schemaVersion: 4,
    society: "fixture",
    installation: {
        node: process.execPath,
        libdir: root,
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
        },
    },
    principalProfile: "p",
    initialResidents: [],
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
    }
};
}

test("P02: canonical deployment manifest pins every selected byte independent of root and traversal order", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-deployment-codec-"));
  const contents: Record<string, string> = {
    "apps/oma/dist/z.js": "z\n",
    "apps/oma/dist/nested/a.js": "a\n",
    "packages/contracts/dist/index.js": "export {};\n",
    "packages/platform-linux/dist/systemd/resident.path.in": "[Path]\n",
    "packages/storage/dist/schema-v4.sql": "schema\n",
    // AV16: the sandbox's `oma` command is pinned with the rest.
    "apps/oma/dist/libexec/oma": "#!/bin/sh\n",
    "package.json": "{}",
    "package-lock.json": "{}",
  };
  const workspaces = DEPLOYMENT_LAYOUT.workspaces;
  for (const {name, root} of workspaces) {
    contents[`${root}/package.json`] = JSON.stringify({ name, version: "0.1.0" });
    contents[`${root}/dist/index.js`] = "export {};\n";
  }
  try {
    for (const [path, bytes] of Object.entries(contents)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), bytes);
    }
    mkdirSync(join(root, "node_modules/@oma"), { recursive: true });
    for (const workspace of workspaces) symlinkSync(`../../${workspace.root}`, join(root, "node_modules", workspace.name));
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
    const clientLink = join(root, "node_modules/@oma/client");
    unlinkSync(clientLink);
    symlinkSync("../../packages/domain", clientLink);
    assert.throws(() => deploymentDigest(root), { code: "UNSUPPORTED_PROFILE" });
    unlinkSync(clientLink);
    symlinkSync("../../packages/client", clientLink);
    assert.equal(deploymentDigest(root), digest);
    for (const lookup of ["packages/native/node_modules", "packages/node_modules", "apps/oma/dist/node_modules"]) {
      const foreign = join(root, lookup, "@oma/domain");
      mkdirSync(foreign, { recursive: true });
      writeFileSync(join(foreign, "package.json"), JSON.stringify({ name: "@oma/domain", version: "0.1.0" }));
      writeFileSync(join(foreign, "index.js"), "export const foreign = true;\n");
      assert.throws(() => deploymentDigest(root), { code: "UNSUPPORTED_PROFILE" }, lookup);
      rmSync(join(root, lookup), { recursive: true });
      assert.equal(deploymentDigest(root), digest);
    }
    rmSync(join(root, "apps/oma/dist/z.js"));
    symlinkSync("nested/a.js", join(root, "apps/oma/dist/z.js"));
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
    copyInstalledProduct(project, root);
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
          join(root, "apps/oma/dist/entry/broker.js"),
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
    const asset = join(root, "packages/mail/dist/facts.js");
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
