// Isolated crash worker for the product surface. Never imported by production.
//
// It reaches a named boundary around a settings write, tells the parent, and
// waits to be killed there. The parent then inspects the configuration files
// from outside the process, so the evidence is what a next start would see.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HostConfig } from "@oma/contracts";
import { defaultHostConfig } from "@oma/config/defaults";
import { INITIAL_WORKERS, commitField, readSettings } from "#oma-test/app/application/settings";

const [root, point] = process.argv.slice(2);
if (!root || !point) throw new Error("surface crash worker requires its owned root and boundary");

const checkpoint = (name: string): void => {
  if (!process.send) throw new Error("parent IPC observation channel is missing");
  process.send({ reached: name });
  if (name === point) {
    // Hold here until the parent kills this process at exactly this boundary.
    for (;;) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
};

const path = join(root, "config.json");
const seed: HostConfig = defaultHostConfig({
  society: "crash", node: process.execPath, libdir: root,
  deploymentDigest: "c".repeat(64),
});
writeFileSync(path, `${JSON.stringify(seed, null, 2)}\n`);

checkpoint("before-write");
commitField(readSettings(path), INITIAL_WORKERS, 12);
checkpoint("after-write");
process.exit(0);
