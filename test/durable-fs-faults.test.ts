import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sha256Hex } from "../src/domain/canonical-json.js";
import { StoreError } from "../src/domain/errors.js";
import { replaceDerivedFile, fsyncTree, ensureDurableDirectory } from "../src/storage/durable-fs.js";
import { publishImmutableFile } from "../src/storage/immutable-file.js";
import { publishImmutableFile as mailPublish, writeAtomic } from "../src/mail.js";

// Node's built-in module namespace has live exports. Update them only inside a
// synchronous, serialized test scope and restore before leaving that scope.
// No production dependency injection or host backend is selected by these tests.
const fs = createRequire(import.meta.url)("node:fs") as typeof import("node:fs");
const native = { fsync: fs.fsyncSync, rename: fs.renameSync, link: fs.linkSync, write: fs.writeFileSync };
const eio = () => Object.assign(new Error("injected filesystem failure"), { code: "EIO" });
const isEio = (error: unknown) => (error as NodeJS.ErrnoException).code === "EIO";
const isCorrupt = (error: unknown) => error instanceof StoreError && error.code === "STORE_CORRUPT";
function scoped(t: TestContext, patch: () => void, action: () => void): void {
  patch(); syncBuiltinESMExports();
  try { action(); } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
}
function fixture(run: (root: string, source: string, target: string, bytes: Buffer) => void): void {
  const root = fs.mkdtempSync(join(tmpdir(), "oma-durable-fs-fault-"));
  try {
    const source = join(root, "source.eml"); const target = join(root, "target.eml");
    const bytes = Buffer.from("From: alice@demo.oma.invalid\r\n\r\nFrozen message bytes.\r\n");
    fs.writeFileSync(source, bytes);
    run(root, source, target, bytes);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test("immutable and derived callers use different shared owners", () => {
  assert.equal(mailPublish, publishImmutableFile);
  assert.equal(writeAtomic, replaceDerivedFile);
  fixture((root, source, target, bytes) => {
    publishImmutableFile(source, target, sha256Hex(bytes));
    assert.deepEqual(fs.readFileSync(target), bytes);
    assert.equal(fs.lstatSync(target).ino, fs.lstatSync(source).ino, "same-filesystem immutable names may hardlink");
    assert.equal(fs.lstatSync(target).mode & 0o777, 0o444);
    publishImmutableFile(source, target, sha256Hex(bytes));
    const other = join(root, "other.eml"); fs.writeFileSync(other, "different");
    assert.throws(() => publishImmutableFile(other, target), isCorrupt);
    assert.deepEqual(fs.readFileSync(target), bytes);
    const dangling = join(root, "dangling"); fs.symlinkSync(join(root, "absent"), dangling);
    assert.throws(() => publishImmutableFile(source, dangling), isCorrupt);
    assert.equal(fs.lstatSync(dangling).isSymbolicLink(), true);
    const derived = join(root, "derived.json");
    replaceDerivedFile(derived, "old"); replaceDerivedFile(derived, "new");
    assert.equal(fs.readFileSync(derived, "utf8"), "new");
    assert.deepEqual(fs.readFileSync(target), bytes, "derived replacement must not change authoritative mail");
  });
});

test("a derived write failure before rename preserves the old file and removes only its temporary", { concurrency: false }, t => {
  fixture((root, _source, target) => {
    fs.writeFileSync(target, "old");
    scoped(t, () => {
      t.mock.method(fs, "fsyncSync", (...[fd]: Parameters<typeof native.fsync>) => { if (fs.fstatSync(fd).isFile()) throw eio(); native.fsync(fd); });
    }, () => assert.throws(() => replaceDerivedFile(target, "new"), isEio));
    assert.equal(fs.readFileSync(target, "utf8"), "old");
    assert.deepEqual(fs.readdirSync(root).sort(), ["source.eml", "target.eml"]);
  });
});

test("an uncertain rename can leave the new derived file visible and is never reported as no effect", { concurrency: false }, t => {
  fixture((root, _source, target) => {
    fs.writeFileSync(target, "old");
    scoped(t, () => {
      t.mock.method(fs, "renameSync", (...[from, to]: Parameters<typeof native.rename>) => { native.rename(from, to); throw eio(); });
    }, () => assert.throws(() => replaceDerivedFile(target, "new"), isEio));
    assert.equal(fs.readFileSync(target, "utf8"), "new");
    assert.deepEqual(fs.readdirSync(root).sort(), ["source.eml", "target.eml"]);
  });
});

test("post-link fsync failure leaves immutable evidence for an idempotent retry", { concurrency: false }, t => {
  fixture((_root, source, target, bytes) => {
    scoped(t, () => {
      t.mock.method(fs, "fsyncSync", (...[fd]: Parameters<typeof native.fsync>) => { if (fs.fstatSync(fd).isFile()) throw eio(); native.fsync(fd); });
    }, () => assert.throws(() => publishImmutableFile(source, target, sha256Hex(bytes)), isEio));
    assert.deepEqual(fs.readFileSync(source), bytes);
    assert.deepEqual(fs.readFileSync(target), bytes);
    publishImmutableFile(source, target, sha256Hex(bytes));
    assert.deepEqual(fs.readFileSync(target), bytes);
  });
});

test("EXDEV partial destination-side copy never exposes partial canonical bytes", { concurrency: false }, t => {
  fixture((root, source, target, bytes) => {
    scoped(t, () => {
      t.mock.method(fs, "writeFileSync", (...[file, data, options]: Parameters<typeof native.write>) => {
        if (typeof file === "number") { native.write(file, Buffer.from("partial")); throw eio(); }
        native.write(file, data, options);
      });
    }, () => assert.throws(() => publishImmutableFile(source, target, sha256Hex(bytes), fault => {
      if (fault.point === "publication-link" && fault.phase === "before") throw Object.assign(new Error("cross filesystem"), { code: "EXDEV" });
    }), isEio));
    assert.equal(fs.existsSync(target), false);
    assert.deepEqual(fs.readFileSync(source), bytes);
    assert.deepEqual(fs.readdirSync(root), ["source.eml"]);
  });
});

test("recursive fsync rejects a linked subtree rather than traversing its target", () => {
  fixture((root, _source, _target) => {
    const tree = join(root, "tree"); const outside = join(root, "outside");
    fs.mkdirSync(tree); fs.mkdirSync(outside); fs.writeFileSync(join(outside, "evidence"), "retained");
    fs.symlinkSync(outside, join(tree, "linked"));
    assert.throws(() => fsyncTree(tree), isCorrupt);
    assert.equal(fs.readFileSync(join(outside, "evidence"), "utf8"), "retained");
  });
});

test("P0V-71 / F4, P0-3: a durable directory's whole path is flushed, also on the retry of a call whose flush failed", { concurrency: false }, () => {
  const root = fs.mkdtempSync(join(tmpdir(), "oma-durable-path-"));
  try {
    const leaf = join(root, "a", "b", "c");
    // The first call creates a, b and c, and its first flush fails.
    let first = true;
    assert.throws(() => ensureDurableDirectory(leaf, 0o700, fault => {
      if (first && fault.point === "directory-fsync") { first = false; throw new Error("EIO: injected flush failure"); }
    }), /EIO/);
    // The retry creates nothing; every name on the path must still be flushed.
    const flushed: string[] = [];
    ensureDurableDirectory(leaf, 0o700, fault => { if (fault.point === "directory-fsync" && fault.phase === "after-visible") flushed.push(fault.path); });
    for (const path of [leaf, join(root, "a", "b"), join(root, "a"), root])
      assert.ok(flushed.includes(path), `${path} was not flushed on the retry: ${JSON.stringify(flushed)}`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
