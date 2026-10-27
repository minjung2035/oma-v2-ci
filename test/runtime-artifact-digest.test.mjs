/** Actual disposable filesystem mutations; no OS identity or kernel stub. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workspaceOutputs } from "../scripts/workspace-build-cache.mjs";
import { runtimeArtifactDigest } from "../scripts/runtime-artifact-digest.mjs";

function fixture(body) {
  const root = mkdtempSync(join(tmpdir(), "oma-runtime-binding-"));
  try {
    const workspace = join(root, "packages/example"); mkdirSync(join(workspace, "dist/helper"), { recursive: true });
    mkdirSync(join(root, ".scratch"));
    writeFileSync(join(workspace, "package.json"), JSON.stringify({ name: "@oma/example" }));
    writeFileSync(join(workspace, "dist/index.js"), "export const value = 1;\n");
    writeFileSync(join(workspace, "dist/helper/launcher"), "fixture launcher bytes"); chmodSync(join(workspace, "dist/helper/launcher"), 0o755);
    writeFileSync(join(workspace, ".tsbuildinfo"), "actual incremental state");
    const record = { schema: 1, workspaces: { "@oma/example": { outputs: workspaceOutputs(workspace) } } };
    const recordPath = join(root, ".scratch/workspace-build-cache.json"); writeFileSync(recordPath, JSON.stringify(record));
    body({ root, workspace, record, recordPath });
  } finally { rmSync(root, { recursive: true, force: true }); }
}
test("NATIVE-ARTIFACT: runtime binding identifies actual JS, native assets, modes and incremental state", () => fixture(({ root }) => {
  const before = runtimeArtifactDigest(root); assert.deepEqual(before, runtimeArtifactDigest(root));
  assert.match(before.digest, /^[a-f0-9]{64}$/); assert.equal(before.files, 3); assert.equal(before.workspaces, 1);
}));
for (const [name, mutate] of [
  ["changed JS", ({ workspace }) => writeFileSync(join(workspace, "dist/index.js"), "export const value = 2;\n")],
  ["changed native helper", ({ workspace }) => writeFileSync(join(workspace, "dist/helper/launcher"), "different launcher bytes")],
  ["changed executable mode", ({ workspace }) => chmodSync(join(workspace, "dist/helper/launcher"), 0o644)],
  ["changed directory mode", ({ workspace }) => chmodSync(join(workspace, "dist/helper"), 0o700)],
  ["changed incremental state", ({ workspace }) => writeFileSync(join(workspace, ".tsbuildinfo"), "different incremental state")],
  ["missing helper", ({ workspace }) => rmSync(join(workspace, "dist/helper/launcher"))],
  ["undeclared extra output", ({ workspace }) => writeFileSync(join(workspace, "dist/additional.js"), "extra")],
  ["linked output", ({ workspace }) => { rmSync(join(workspace, "dist/index.js")); symlinkSync("helper/launcher", join(workspace, "dist/index.js")); }],
  ["missing record", ({ recordPath }) => rmSync(recordPath)],
  ["unrecognized record", ({ record, recordPath }) => { record.schema = 2; writeFileSync(recordPath, JSON.stringify(record)); }],
  ["missing workspace row", ({ record, recordPath }) => { delete record.workspaces["@oma/example"]; writeFileSync(recordPath, JSON.stringify(record)); }],
  ["removed workspace", ({ workspace }) => rmSync(workspace, { recursive: true })],
  ["extra recorded workspace", ({ record, recordPath }) => { record.workspaces["@oma/extra"] = {}; writeFileSync(recordPath, JSON.stringify(record)); }],
  ["new workspace", ({ root }) => { const directory = join(root, "packages/additional"); mkdirSync(directory); writeFileSync(join(directory, "package.json"), '{"name":"@oma/additional"}'); }],
]) test(`NATIVE-ARTIFACT: runtime binding refuses ${name}`, () => fixture(context => {
  assert.doesNotThrow(() => runtimeArtifactDigest(context.root)); mutate(context);
  assert.throws(() => runtimeArtifactDigest(context.root));
}));
