import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sha256Hex } from "@oma/domain/canonical-json";
import { StoreError } from "@oma/domain/errors";
import { replaceDerivedFile, fsyncTree, ensureDurableDirectory, publishNoReplace, type DurabilityObserver } from "@oma/storage/durable-fs";
import { publishImmutableFile } from "@oma/storage/immutable-file";
import { publishImmutableFile as mailPublish } from "@oma/storage/immutable-file";
import { replaceDerivedFile as writeAtomic } from "@oma/storage/durable-fs";

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
    assert.throws(() => replaceDerivedFile(target, "new", 0o600, fault => {
      if (fault.point === "derived-rename" && fault.phase === "after-visible") throw eio();
    }), isEio);
    assert.equal(fs.readFileSync(target, "utf8"), "new");
    assert.deepEqual(fs.readdirSync(root).sort(), ["source.eml", "target.eml"]);
    replaceDerivedFile(target, "new");
    assert.equal(fs.readFileSync(target, "utf8"), "new", "retry preserves the already visible bytes");
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

test("P0V-59: a no-replace publication that fails while writing leaves no file under the name, and never replaces one", { concurrency: false }, t => {
  fixture((root, _source, target) => {
    scoped(t, () => { t.mock.method(fs, "writeFileSync", () => { throw eio(); }); },
      () => assert.throws(() => publishNoReplace(target, "partial unit"), isEio));
    assert.equal(fs.existsSync(target), false, "a failed write left a file under the name");
    assert.deepEqual(fs.readdirSync(root).filter(name => name.endsWith(".tmp")), [], "the temporary was left behind");
    assert.equal(publishNoReplace(target, "first"), "created");
    assert.equal(publishNoReplace(target, "second"), "existing");
    assert.equal(fs.readFileSync(target, "utf8"), "first");
  });
});

/** The fault-observer seam at `file-fsync`/`after-visible`, whose path is the
 * publication's own temporary: unlinking it there is what a concurrent
 * dead-temporary collection does to a temporary whose lock is momentarily
 * free (P0V-96). Counts how many attempts were started (file-create/before). */
function stealTemporaryOnce(): { observer: DurabilityObserver; attempts: () => number } {
  let stolen = false, started = 0;
  const observer: DurabilityObserver = fault => {
    if (fault.point === "file-create" && fault.phase === "before") started++;
    if (!stolen && fault.point === "file-fsync" && fault.phase === "after-visible") { stolen = true; fs.unlinkSync(fault.path); }
  };
  return { observer, attempts: () => started };
}

test("FJ-8: a no-replace publication whose temporary was taken restarts once and lands its bytes", () => {
  fixture((root, _source, target) => {
    const { observer, attempts } = stealTemporaryOnce();
    assert.equal(publishNoReplace(target, "second attempt's bytes", 0o600, observer), "created");
    assert.equal(attempts(), 2, "the stolen temporary restarted the publication exactly once");
    assert.equal(fs.readFileSync(target, "utf8"), "second attempt's bytes");
    assert.deepEqual(fs.readdirSync(root).filter(name => name.endsWith(".tmp")), [], "no temporary residue");
  });
});

test("FJ-8: a no-replace publication that keeps losing its temporary refuses after three attempts", () => {
  fixture((root, _source, target) => {
    let started = 0;
    const observer: DurabilityObserver = fault => {
      if (fault.point === "file-create" && fault.phase === "before") started++;
      if (fault.point === "file-fsync" && fault.phase === "after-visible") fs.unlinkSync(fault.path);
    };
    assert.throws(() => publishNoReplace(target, "never lands", 0o600, observer),
      (error: unknown) => error instanceof StoreError && error.code === "INTERNAL_ERROR");
    assert.equal(started, 3, "exactly three attempts, not an unbounded retry");
    assert.equal(fs.existsSync(target), false);
    assert.deepEqual(fs.readdirSync(root).filter(name => name.endsWith(".tmp")), [], "no temporary residue");
  });
});

test("FJ-8: a derived replacement whose temporary was taken restarts once and lands its bytes", () => {
  fixture((root, _source, target) => {
    fs.writeFileSync(target, "old");
    const { observer, attempts } = stealTemporaryOnce();
    replaceDerivedFile(target, "new", 0o600, observer);
    assert.equal(attempts(), 2, "the stolen temporary restarted the replacement exactly once");
    assert.equal(fs.readFileSync(target, "utf8"), "new");
    assert.deepEqual(fs.readdirSync(root).filter(name => name.endsWith(".tmp")), [], "no temporary residue");
  });
});

test("FJ-8: a derived replacement that keeps losing its temporary refuses after three attempts", () => {
  fixture((root, _source, target) => {
    fs.writeFileSync(target, "old");
    let started = 0;
    const observer: DurabilityObserver = fault => {
      if (fault.point === "file-create" && fault.phase === "before") started++;
      if (fault.point === "file-fsync" && fault.phase === "after-visible") fs.unlinkSync(fault.path);
    };
    assert.throws(() => replaceDerivedFile(target, "new", 0o600, observer),
      (error: unknown) => error instanceof StoreError && error.code === "INTERNAL_ERROR");
    assert.equal(started, 3, "exactly three attempts, not an unbounded retry");
    assert.equal(fs.readFileSync(target, "utf8"), "old", "a refused replacement keeps the old bytes");
    assert.deepEqual(fs.readdirSync(root).filter(name => name.endsWith(".tmp")), [], "no temporary residue");
  });
});
