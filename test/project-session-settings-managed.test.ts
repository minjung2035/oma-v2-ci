import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectSessionSettings } from "#oma-test/app/application/project-session-settings";
import { ensureProjectSettings } from "#oma-test/app/application/project-settings";
import { projectSettingsPath, readSettings, commitManagedEdit } from "#oma-test/app/application/settings";
import { deploymentDigest } from "#oma-test/app/runtime/deployment-manifest";

test("001. A managed project committed during session derivation remains pending and is followed", () => {
  const dataRoot = mkdtempSync(join(tmpdir(), "oma-settings-follow-"));
  const libdir = process.cwd(), project = "fixture-project", society = "fixture-session";
  const configPath = join(dataRoot, society, "config.json");
  mkdirSync(join(dataRoot, society));
  try {
    const initial = ensureProjectSettings(dataRoot, project, libdir, undefined, deploymentDigest(libdir));
    let injected = false;
    const view = new ProjectSessionSettings({ dataRoot, project, libdir, configPath,
      packageStore: join(dataRoot, ".packages"), externalConfig: false,
      owns: () => true, assertWritable() {}, notice() {},
      own(digest) {
        if (!injected) {
          injected = true;
          const current = readSettings(projectSettingsPath(dataRoot, project));
          assert.equal(commitManagedEdit(current.snapshot!, { ...current.config, maxWorkers: current.config.maxWorkers + 1 },
            {}, undefined, undefined, dataRoot).kind, "committed");
        }
        return { society, node: process.execPath, libdir, deploymentDigest: digest, packages: join(dataRoot, ".packages") };
      },
    });
    assert.equal(view.settings.config.maxWorkers, initial.config.maxWorkers);
    assert.equal(view.changed(), true, "the newer project is not marked already derived");
    assert.equal(view.rederive(), true);
    assert.equal(view.settings.config.maxWorkers, initial.config.maxWorkers + 1);
    assert.equal(readSettings(configPath).config.maxWorkers, initial.config.maxWorkers + 1);
    assert.equal(view.changed(), false);
  } finally {
    // Managed generations are intentionally read-only; this fixture owns them.
    execFileSync("chmod", ["-R", "u+rwX", dataRoot]);
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
