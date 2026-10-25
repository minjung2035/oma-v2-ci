import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readContextEntry, assertContextDirectory } from "@oma/storage/context-files";
import { StoreError } from "@oma/domain/errors";
import { prepareContextEffects } from "#oma-test/app/cli/effects/context";

const isCorrupt = (error: unknown): boolean => error instanceof StoreError && error.code === "STORE_CORRUPT";
const hash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

test("context CLI keeps the held source after its pathname is replaced", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-context-held-source-"));
  const source = join(root, "source"), moved = join(root, "moved"), original = fs.fstatSync;
  const expected = Buffer.from("# held source\n");
  mkdirSync(source); writeFileSync(join(source, "GOAL.md"), expected);
  let replaced = false;
  try {
    fs.fstatSync = ((...args: Parameters<typeof fs.fstatSync>) => {
      const stat = original(...args);
      if (!replaced && fs.readlinkSync(`/proc/self/fd/${args[0]}`) === join(source, "GOAL.md")) {
        replaced = true;
        fs.renameSync(source, moved); mkdirSync(source);
        writeFileSync(join(source, "GOAL.md"), "# replacement source\n");
      }
      return stat;
    }) as typeof fs.fstatSync;
    syncBuiltinESMExports();
    const result = prepareContextEffects(source);
    assert.equal(replaced, true);
    assert.deepEqual(result.content, expected);
    assert.deepEqual(result.entries, [{ path: "GOAL.md", bytes: expected.length, sha256: hash(expected) }]);
    assert.equal(fs.readFileSync(join(source, "GOAL.md"), "utf8"), "# replacement source\n");
  } finally { fs.fstatSync = original; syncBuiltinESMExports(); rmSync(root, { recursive: true, force: true }); }
});

test("context effects read and verify the same supported regular file", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-context-file-identity-"));
  try {
    const bytes = Buffer.from("# GOAL\nPreserve these exact bytes.\n");
    const entry = Object.freeze({ path: "GOAL.md", bytes: bytes.length, sha256: hash(bytes) });
    writeFileSync(join(root, entry.path), bytes);
    assert.deepEqual(readContextEntry(root, entry), bytes);
    assert.throws(() => readContextEntry(root, { ...entry, bytes: bytes.length + 1 }), isCorrupt);
    assert.throws(() => readContextEntry(root, { ...entry, sha256: "0".repeat(64) }), isCorrupt);
    assert.throws(() => readContextEntry(root, { ...entry, path: "../GOAL.md" }), isCorrupt);
    writeFileSync(join(root, entry.path), Buffer.from([0]));
    assert.throws(() => readContextEntry(root, { path: "GOAL.md", bytes: 1, sha256: hash(Buffer.from([0])) }), isCorrupt,
      "matching metadata cannot turn binary data into supported context");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("context effects reject leaf hardlinks symlinks directories and linked parents", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-context-file-links-"));
  try {
    const source = join(root, "source");
    const view = join(root, "view");
    mkdirSync(source); mkdirSync(view);
    const bytes = Buffer.from("# GOAL\nOriginal.\n");
    const entry = { path: "GOAL.md", bytes: bytes.length, sha256: hash(bytes) };
    writeFileSync(join(source, entry.path), bytes);
    assert.deepEqual(readContextEntry(source, entry), bytes, "single-link positive control");
    linkSync(join(source, entry.path), join(view, entry.path));
    assert.throws(() => readContextEntry(view, entry), isCorrupt);
    assert.throws(() => readContextEntry(source, entry), isCorrupt);
    rmSync(join(view, entry.path));
    assert.deepEqual(readContextEntry(source, entry), bytes, "removing the extra link restores a valid control");
    symlinkSync(join(source, entry.path), join(view, entry.path));
    assert.throws(() => readContextEntry(view, entry), isCorrupt);
    rmSync(join(view, entry.path));
    mkdirSync(join(view, entry.path));
    assert.throws(() => readContextEntry(view, entry), isCorrupt);
    const linkedRoot = join(root, "linked-root");
    symlinkSync(source, linkedRoot);
    assert.throws(() => assertContextDirectory(linkedRoot), isCorrupt);
    assert.throws(() => readContextEntry(linkedRoot, entry), isCorrupt);
    assert.throws(() => assertContextDirectory(`${source}/../view`), isCorrupt);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
