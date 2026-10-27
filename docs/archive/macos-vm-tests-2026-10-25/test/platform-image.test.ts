/** MAC-601, MAC-611 (MV-26): a guest image boots only when this app's
 * publisher signed it, every file is the one the manifest names, its protocol
 * is one this host speaks, and it can read the state already on the disk. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PlatformError } from "@oma/protocol/host-errors";
import { bootableWith, verifyImage } from "@oma/platform-mac/image";

const signer = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "scripts", "platform", "sign-image.mjs");
const release = generateKeyPairSync("ed25519");
const stranger = generateKeyPairSync("ed25519");
const HOST = { min: 1, max: 1 };

function image(t: import("node:test").TestContext, overrides: Record<string, unknown> = {}, key = release.privateKey): string {
  const dir = mkdtempSync(join(tmpdir(), "oma-image-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const files: Record<string, unknown> = {};
  for (const [role, name] of [["kernel", "Image"], ["initrd", "initrd.img"], ["system", "system.erofs"], ["verity", "system.verity"]]) {
    const bytes = Buffer.from(`${role} bytes`);
    writeFileSync(join(dir, name!), bytes);
    files[role!] = { name, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  }
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ kind: "oma-guest-image-v1", version: "2026.09.1", protocol: 1,
    stateSchema: { written: 3, readable: [2, 3] }, verityRoot: "a".repeat(64), files, ...overrides }));
  const keyPath = join(dir, "..", `${dir.split("/").pop()}.pem`);
  writeFileSync(keyPath, key.export({ type: "pkcs8", format: "pem" }));
  t.after(() => rmSync(keyPath, { force: true }));
  assert.equal(spawnSync(process.execPath, [signer, dir, keyPath]).status, 0, "the release tool signs");
  return dir;
}
const refused = (code: string, pattern: RegExp) => (error: unknown) =>
  error instanceof PlatformError && error.failure.code === code && pattern.test(error.failure.message);

test("MAC-601: a signed, complete image is verified and its parts are named", async t => {
  const verified = await verifyImage(image(t), release.publicKey, HOST);
  assert.equal(verified.version, "2026.09.1");
  assert.deepEqual(verified.stateSchema, { written: 3, readable: [2, 3] });
  assert.match(verified.paths.kernel, /Image$/);
});

test("MAC-601/MV-26: another key, a changed manifest, a changed file or a missing file is not booted", async t => {
  await assert.rejects(verifyImage(image(t, {}, stranger.privateKey), release.publicKey, HOST), refused("ENGINE_UNAVAILABLE", /not signed/));
  const edited = image(t);
  appendFileSync(join(edited, "manifest.json"), " ");
  await assert.rejects(verifyImage(edited, release.publicKey, HOST), refused("ENGINE_UNAVAILABLE", /not signed/));
  const tampered = image(t);
  writeFileSync(join(tampered, "system.erofs"), "system bytez");
  await assert.rejects(verifyImage(tampered, release.publicKey, HOST), refused("ENGINE_UNAVAILABLE", /damaged/));
  const missing = image(t);
  rmSync(join(missing, "initrd.img"));
  await assert.rejects(verifyImage(missing, release.publicKey, HOST), refused("ENGINE_UNAVAILABLE", /incomplete/));
  await assert.rejects(verifyImage(image(t, { files: { kernel: { name: "../x", bytes: 1, sha256: "0".repeat(64) } } }), release.publicKey, HOST),
    refused("ENGINE_UNAVAILABLE", /damaged/), "a name that leaves the image directory");
});

test("MAC-250/601: an image of a protocol this host does not speak is a version skew, not damage", async t => {
  await assert.rejects(verifyImage(image(t, { protocol: 2 }), release.publicKey, HOST), refused("ENGINE_VERSION_SKEW", /another version/));
});

test("MAC-611: an image that cannot read the disk's newest schema is not booted", async t => {
  const verified = await verifyImage(image(t), release.publicKey, HOST);
  bootableWith(verified, null);
  bootableWith(verified, 2);
  assert.throws(() => bootableWith(verified, 4), refused("STATE_NEWER_THAN_APP", /newer OMA/));
});
