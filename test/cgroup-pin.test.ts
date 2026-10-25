// V07B kernel (WP07.01): the previous run's death is proven through its pinned
// cgroup directory, never inferred from the unit's current cgroup.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinCgroup } from "@oma/native/cgroup";
import { parseCgroupPopulation } from "@oma/domain/cgroup-population";
import { cleanupOwnedSystemdUnits, requireSystemdTestManager } from "./fixtures/systemd.js";

requireSystemdTestManager();

const systemctl = (...args: string[]) => spawnSync("systemctl", ["--user", ...args], { encoding: "utf8", timeout: 10000 });
const cgroupOf = (unit: string): string => systemctl("show", unit, "--property=ControlGroup", "--value").stdout.trim();

test("V07B kernel: a stopped run's pinned cgroup is removed, and a restart in the same unit does not revive it", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-pin-"));
  const society = `pn${Date.now().toString(36)}`;
  const unit = `oma-${society}-a.service`;
  try {
    const file = join(root, unit);
    writeFileSync(file, "[Service]\nType=exec\nExecStart=/bin/sleep 300\n");
    assert.equal(systemctl("link", file).status, 0);
    systemctl("daemon-reload");
    assert.equal(systemctl("start", unit).status, 0);
    const path = cgroupOf(unit);
    const pin = pinCgroup(path);
    try {
      assert.equal(pin.population(), "populated");
      assert.equal(systemctl("stop", unit).status, 0);
      assert.equal(pin.population(), "removed", "the stopped run's cgroup is proven removed through its pin");
      assert.equal(systemctl("start", unit).status, 0);
      const current = cgroupOf(unit);
      assert.equal(current, path, "systemd reuses the same cgroup path for the next invocation");
      // The control: the path now names a populated cgroup of the NEW run.
      assert.equal(parseCgroupPopulation(readFileSync(join("/sys/fs/cgroup", current, "cgroup.events"), "utf8")), "populated");
      assert.notEqual(statSync(join("/sys/fs/cgroup", current)).ino, Number(pin.identity.ino));
      // The pin still answers for the old run only.
      assert.equal(pin.population(), "removed");
      assert.equal(pin.matches(current), false, "the old pin must not authenticate the new invocation");
    } finally { pin.close(); }
  } finally {
    cleanupOwnedSystemdUnits(root, society);
    rmSync(root, { recursive: true, force: true });
  }
});
