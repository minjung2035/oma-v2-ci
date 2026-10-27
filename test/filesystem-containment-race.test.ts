import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { Worker } from "node:worker_threads";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  renameSync,
  symlinkSync,
  fstatSync,
  lstatSync,
  closeSync,
  fchmodSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256Hex } from "@oma/domain/canonical-json";
import {
  openDirectory,
  openRegularBeneath,
} from "@oma/native/files";
import { publishImmutableFile } from "@oma/storage/immutable-file";
import { readContextEntry } from "@oma/storage/context-files";
import { withFrozenBundle } from "@oma/storage/submit-spool";
import { runProcess } from "@oma/process/async";
import { writeExclusiveFsyncedFile } from "@oma/storage/durable-fs";

const good = Buffer.from("checked bytes\n");
const hash = sha256Hex(good);

test("FS containment: syscall ABI remains valid across fresh foreign stacks", () => {
  const module = new URL(import.meta.resolve("@oma/native/files"), import.meta.url).href;
  const script = `import { openDirectory } from ${JSON.stringify(module)};
    import { closeSync, fstatSync } from 'node:fs';
    for (let i = 0; i < 20; i++) {
      const fd = openDirectory('/tmp');
      if (!fstatSync(fd).isDirectory()) throw Error('not a directory');
      closeSync(fd);
    }`;
  // Separate processes vary foreign-stack placement; the old four-argument
  // syscall binding intermittently read an unallocated trailing argument slot.
  for (let i = 0; i < 32; i++) {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 5000 });
    assert.equal(result.signal, null, `child ${i}: ${result.signal} ${result.stderr}`);
    assert.equal(result.status, 0, result.stderr);
  }
});

test("FS containment: real same-UID rename/symlink racer cannot escape a pinned root", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-fs-race-"));
  const inside = join(root, "inside");
  const outside = join(root, "outside");
  mkdirSync(inside);
  mkdirSync(outside);
  mkdirSync(join(inside, "slot"));
  writeFileSync(join(inside, "slot/file"), good);
  writeFileSync(join(outside, "file"), good);
  const expected = lstatSync(join(inside, "slot/file"));
  const directory = openDirectory(inside);
  const shared = new SharedArrayBuffer(8);
  const state = new Int32Array(shared);
  const worker = new Worker(
    `
    const fs = require("node:fs"); const { workerData, parentPort } = require("node:worker_threads");
    const { inside, outside, shared } = workerData; const state = new Int32Array(shared);
    parentPort.postMessage("ready");
    while (!Atomics.load(state, 0)) {
      fs.renameSync(inside + "/slot", inside + "/held");
      fs.symlinkSync(outside, inside + "/slot");
      fs.unlinkSync(inside + "/slot");
      fs.renameSync(inside + "/held", inside + "/slot");
      Atomics.add(state, 1, 1);
    }
  `,
    { eval: true, workerData: { inside, outside, shared } },
  );
  const exited = once(worker, "exit");
  try {
    await once(worker, "message");
    for (let i = 0; i < 2000; i++) {
      let fd: number;
      try {
        fd = openRegularBeneath(directory, "slot/file");
      } catch (error) {
        assert.ok(
          ["STORE_CORRUPT", "ENOENT", "EAGAIN"].includes(
            (error as { code: string }).code,
          ),
        );
        continue;
      }
      try {
        const actual = fstatSync(fd);
        assert.equal(actual.dev, expected.dev);
        assert.equal(actual.ino, expected.ino);
        assert.deepEqual(readFileSync(fd), good);
      } finally {
        closeSync(fd);
      }
    }
    assert.ok(Atomics.load(state, 1) > 0, "the attacker actually raced");
  } finally {
    Atomics.store(state, 0, 1);
    await exited;
    closeSync(directory);
    rmSync(root, { recursive: true, force: true });
  }
});

test("FS containment: immutable link handoff retains the checked source inode across replacement", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-fs-link-"));
  try {
    const outside = join(root, "outside");
    writeFileSync(outside, "hostile", { mode: 0o600 });
    for (let i = 0; i < 50; i++) {
      const source = join(root, `source-${i}`);
      const target = join(root, `target-${i}`);
      writeFileSync(source, good);
      const inode = lstatSync(source).ino;
      publishImmutableFile(source, target, hash, (fault) => {
        if (fault.point === "publication-link" && fault.phase === "before") {
          renameSync(source, source + ".held");
          symlinkSync(outside, source);
        }
      });
      assert.equal(lstatSync(target).ino, inode);
      assert.deepEqual(readFileSync(target), good);
      assert.equal(readFileSync(outside, "utf8"), "hostile");
      assert.equal(lstatSync(outside).mode & 0o777, 0o600);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("FS containment: context metadata handoff uses the checked fd, not a replaced leaf", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-fs-context-"));
  try {
    const file = join(root, "GOAL.md");
    const outside = join(root, "outside");
    writeFileSync(file, good);
    writeFileSync(outside, "hostile", { mode: 0o600 });
    const bytes = readContextEntry(
      root,
      { path: "GOAL.md", bytes: good.length, sha256: hash },
      (fd) => {
        renameSync(file, file + ".held");
        symlinkSync(outside, file);
        fchmodSync(fd, 0o444);
      },
    );
    assert.deepEqual(bytes, good);
    assert.equal(lstatSync(outside).mode & 0o777, 0o600);
    assert.throws(() =>
      readContextEntry(root, {
        path: "GOAL.md",
        bytes: good.length,
        sha256: hash,
      }),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("FS containment: exclusive writer stays in its pinned parent during a parent swap", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-fs-create-"));
  try {
    const parent = join(root, "stage");
    const outside = join(root, "outside");
    mkdirSync(parent);
    mkdirSync(outside);
    writeExclusiveFsyncedFile(join(parent, "file"), good, 0o600, (fault) => {
      if (fault.point === "file-create" && fault.phase === "before") {
        renameSync(parent, parent + ".held");
        symlinkSync(outside, parent);
      }
    });
    assert.deepEqual(readFileSync(join(parent + ".held", "file")), good);
    assert.throws(() => readFileSync(join(outside, "file")), {
      code: "ENOENT",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("FS containment: bundle handoff inherits the checked fd into a real child", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-fs-bundle-"));
  const path = join(root, "upload.bundle");
  try {
    writeFileSync(path, good);
    await withFrozenBundle(
      { path, bytes: good.length, sha256: hash },
      async (fd) => {
        renameSync(path, path + ".held");
        writeFileSync(path, "hostile");
        const result = await runProcess(
          {
            executable: process.execPath,
            argv: [
              "-e",
              'process.stdout.write(require("node:fs").readFileSync("/proc/self/fd/3"))',
            ],
            env: {},
            timeoutMs: 5000,
            stdoutBytes: 1024,
            stderrBytes: 1024,
          },
          { inheritedFds: [fd] },
        );
        assert.equal(result.kind, "exited");
        assert.equal(result.exitCode, 0);
        assert.deepEqual(result.stdout, good);
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
