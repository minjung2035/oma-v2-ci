import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, linkSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BlobDescriptor } from "@oma/contracts";
import { generateOperationId } from "@oma/native/identity";
import { StoreError } from "@oma/domain/errors";
import { submitBundlePathAt } from "@oma/domain/paths";
import { prepareSubmitSpool, observeFrozenBundle, requireFrozenBundle, type PreparedSubmitSpool } from "@oma/storage/submit-spool";

// File/ownership boundary tests only. These do not claim that a namespace,
// cgroup, systemd unit or Git candidate check was executed successfully.
const content = Buffer.from("a frozen bundle transport fixture\n", "utf8");
function descriptor(bytes: Uint8Array = content): BlobDescriptor {
  return { bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex"), mediaType: "application/x-git-bundle" };
}
async function* chunks(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes.subarray(0, 3); yield bytes.subarray(3);
}
const code = (expected: string) => (error: unknown): boolean => error instanceof StoreError && error.code === expected;
function temporary(): string { return mkdtempSync(join(tmpdir(), "oma-r20-spool-")); }
function bundleOf(spool: PreparedSubmitSpool) {
  const bundle = spool.bundle;
  assert.ok(bundle, "normal bundle preparation must produce a descriptor");
  return bundle;
}

test("R20: verified bytes are synced and retained at the identity-derived workflow name", async () => {
  const root = temporary();
  try {
    const id = generateOperationId();
    const spool = await prepareSubmitSpool(root, id, descriptor(), chunks(content));
    const bundle = bundleOf(spool);
    assert.equal(bundle.path, submitBundlePathAt(root, id));
    assert.equal(bundle.bytes, content.length);
    assert.equal(bundle.sha256, descriptor().sha256);
    assert.deepEqual(readFileSync(bundle.path), content);
    assert.equal(statSync(bundle.path).mode & 0o777, 0o444);
    assert.equal(Object.isFrozen(bundle), true);
    assert.deepEqual(observeFrozenBundle(bundle), { kind: "present" });
    assert.doesNotThrow(() => requireFrozenBundle(bundle));
    spool.retainForOperation();
    spool.discardUnaccepted();
    spool.retainForOperation();
    assert.deepEqual(readFileSync(bundle.path), content, "accepted evidence never belongs to transport cleanup");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("R20: only provably unaccepted exclusively owned files can be discarded", async () => {
  const root = temporary();
  try {
    const id = generateOperationId();
    const spool = await prepareSubmitSpool(root, id, descriptor(), chunks(content));
    const bundle = bundleOf(spool);
    const sibling = join(root, "unrelated-evidence");
    writeFileSync(sibling, "keep");
    spool.discardUnaccepted();
    spool.discardUnaccepted();
    assert.equal(existsSync(bundle.path), false);
    assert.equal(readFileSync(sibling, "utf8"), "keep");
    assert.throws(() => spool.retainForOperation(), code("INTERNAL_ERROR"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("R20: exclusive-create failure cannot delete a previously prepared operation file", async () => {
  const root = temporary();
  try {
    const id = generateOperationId();
    const original = await prepareSubmitSpool(root, id, descriptor(), chunks(content));
    const bundle = bundleOf(original);
    original.retainForOperation();
    await assert.rejects(prepareSubmitSpool(root, id, descriptor(), chunks(content)), { code: "EEXIST" });
    assert.deepEqual(readFileSync(bundle.path), content);
    assert.deepEqual(observeFrozenBundle(bundle), { kind: "present" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const violation of ["short", "long", "digest"] as const) {
  test(`R20: ${violation} stream fails before acceptance and leaves no partial canonical bundle`, async () => {
    const root = temporary();
    try {
      const control = await prepareSubmitSpool(root, generateOperationId(), descriptor(), chunks(content));
      assert.deepEqual(observeFrozenBundle(bundleOf(control)), { kind: "present" });
      const id = generateOperationId();
      const bytes = violation === "short" ? content.subarray(0, -1)
        : violation === "long" ? Buffer.concat([content, Buffer.from("x")])
        : Buffer.alloc(content.length, 88);
      await assert.rejects(prepareSubmitSpool(root, id, descriptor(), chunks(bytes)), code("STREAM_INVALID"));
      assert.equal(existsSync(submitBundlePathAt(root, id)), false);
      assert.deepEqual(readFileSync(bundleOf(control).path), content, "a failed preparation cannot remove another operation's evidence");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test("R20: the descriptor is copied before asynchronous receipt of raw bytes", async () => {
  const root = temporary();
  try {
    const declared = descriptor();
    async function* changing(): AsyncIterable<Uint8Array> {
      declared.bytes = 1;
      declared.sha256 = "0".repeat(64);
      yield content;
    }
    const spool = await prepareSubmitSpool(root, generateOperationId(), declared, changing());
    assert.equal(bundleOf(spool).bytes, content.length);
    assert.equal(bundleOf(spool).sha256, descriptor().sha256);
    assert.deepEqual(observeFrozenBundle(bundleOf(spool)), { kind: "present" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("R20: a descriptor-free submit accepts no raw body, not an invented empty bundle", async () => {
  const root = temporary();
  try {
    const id = generateOperationId();
    const empty = await prepareSubmitSpool(root, id, undefined, chunks(Buffer.alloc(0)));
    assert.equal(empty.bundle, null);
    assert.equal(existsSync(submitBundlePathAt(root, id)), false);
    empty.retainForOperation(); empty.discardUnaccepted();
    await assert.rejects(prepareSubmitSpool(root, generateOperationId(), undefined, chunks(content)), code("STREAM_INVALID"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const corruption of ["missing", "digest", "hardlink", "symlink", "directory"] as const) {
  test(`R20: accepted bundle ${corruption} remains an explicit failed observation`, async () => {
    const root = temporary();
    try {
      const spool = await prepareSubmitSpool(root, generateOperationId(), descriptor(), chunks(content));
      const bundle = bundleOf(spool);
      spool.retainForOperation();
      assert.deepEqual(observeFrozenBundle(bundle), { kind: "present" });
      if (corruption === "missing") unlinkSync(bundle.path);
      if (corruption === "digest") {
        chmodSync(bundle.path, 0o600);
        writeFileSync(bundle.path, Buffer.alloc(content.length, 88));
      }
      if (corruption === "hardlink") linkSync(bundle.path, join(root, "second-name"));
      if (corruption === "symlink") {
        const original = join(root, "original");
        renameSync(bundle.path, original); symlinkSync(original, bundle.path);
      }
      if (corruption === "directory") {
        const parent = join(root, "directory-target");
        renameSync(bundle.path, parent); symlinkSync(root, bundle.path);
      }
      const result = observeFrozenBundle(bundle);
      assert.equal(result.kind, corruption === "missing" ? "absent" : "corrupt");
      assert.throws(() => requireFrozenBundle(bundle), code("STORE_CORRUPT"));
      spool.discardUnaccepted();
      if (corruption === "digest") assert.deepEqual(readFileSync(bundle.path), Buffer.alloc(content.length, 88), "corruption must remain available for diagnosis");
      if (corruption === "symlink") assert.deepEqual(readFileSync(join(root, "original")), content);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
