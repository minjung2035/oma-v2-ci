import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import childProcess, { spawnSync } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { withProjectSnapshot } from "@oma/git/project-snapshot";
import { StoreError } from "@oma/domain/errors";
import { SnapshotReader, copySnapshotFile } from "@oma/native/snapshot-reader";
import { GIT_ENV } from "@oma/process/policies";
import { prepareProjectDirectory } from "@oma/git/linux-project-preparation";
import { prepareHostProjectDirectory } from "@oma/platform-mac/files";
import { MacGit } from "@oma/git/host-project";

function fixture(t: import("node:test").TestContext, format: "sha1" | "sha256" = "sha1") {
  const root = mkdtempSync(join(tmpdir(), "oma-snapshot-"));
  t.after(() => { chmodSync(join(root, "project"), 0o700); rmSync(root, { recursive: true, force: true }); });
  const project = join(root, "project"); mkdirSync(project);
  const run = (...argv: string[]) => {
    const result = spawnSync("/usr/bin/git", ["-C", project, "-c", "user.name=t", "-c", "user.email=t@t", ...argv], { env: GIT_ENV, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trimEnd();
  };
  run("init", "-q", "-b", "main", `--object-format=${format}`);
  writeFileSync(join(project, "tracked"), "initial\n");
  writeFileSync(join(project, "removed"), "remove me\n");
  writeFileSync(join(project, "now-ignored"), "tracked but ignored\n");
  run("add", "."); run("commit", "-qm", "initial");
  const parent = run("rev-parse", "HEAD");
  const options = { source: project, parent, format, sourceIsGit: true, temporaryParent: root, executable: "/usr/bin/git" } as const;
  return { root, project, run, parent, options };
}

test("startup: snapshot Git processes do not grow with file or directory count", t => {
  const f = fixture(t);
  for (let i = 0; i < 80; i++) {
    const dir = join(f.project, `dir-${i}`); mkdirSync(dir);
    writeFileSync(join(dir, "file"), `bytes-${i}\r\n`);
  }
  const native = childProcess.spawnSync;
  const calls: string[][] = [];
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  t.mock.method(childProcess, "spawnSync", ((executable: string, argv: string[], options: Parameters<typeof native>[2]) => {
    calls.push([...argv]);
    return native(executable, argv, options);
  }) as typeof native);
  syncBuiltinESMExports();
  withProjectSnapshot(f.options, snapshot => {
    assert.equal(snapshot.git(["show", `${snapshot.head}:dir-79/file`]), "bytes-79");
    assert.equal(snapshot.git(["ls-tree", "-rz", "--name-only", snapshot.head]).split("\0").length - 1, 83);
  });
  assert.equal(calls.filter(argv => argv.includes("fast-import")).length, 1, "one stream imports all raw blobs");
  assert.ok(calls.filter(argv => argv.includes("mktree") || argv.includes("write-tree")).length <= 1,
    "Git builds the whole tree in one process");
});

test("startup: nested snapshot reads resolve current parents and reject a replacement link", t => {
  const f = fixture(t), relative = "deep/nested/file";
  mkdirSync(join(f.project, "deep/nested"), { recursive: true });
  writeFileSync(join(f.project, relative), "first");
  const reader = new SnapshotReader(f.project); t.after(() => reader.close());
  const read = () => {
    const entry = reader.entry(relative)!;
    try { return readFileSync(entry.descriptor, "utf8"); }
    finally { closeSync(entry.descriptor); }
  };
  assert.equal(read(), "first");
  renameSync(join(f.project, "deep"), join(f.root, "moved"));
  symlinkSync(join(f.root, "moved"), join(f.project, "deep"));
  assert.throws(read, process.platform === "linux" ? { code: "STORE_CORRUPT" } : /ENOTDIR|ELOOP/);
  unlinkSync(join(f.project, "deep"));
  mkdirSync(join(f.project, "deep/nested"), { recursive: true });
  writeFileSync(join(f.project, relative), "second");
  assert.equal(read(), "second");
});

test("startup: one private stream preserves binary command-like bytes and unusual filenames", t => {
  const f = fixture(t), bytes = Buffer.alloc(200000, 0x80), name = "odd\n\ttail";
  Buffer.from("\ndone\nblob\nmark :999\ndata 0\n\0").copy(bytes, 65530);
  writeFileSync(join(f.project, name), bytes);
  let writes = 0, reads = 0;
  withProjectSnapshot({ ...f.options, prepare(path) {
    const prepared = prepareProjectDirectory(path);
    return { ...prepared,
      openContent(index) { writes++; return prepared.openContent(index); },
      readContent(index) { reads++; return prepared.readContent(index); },
    };
  } }, snapshot => {
    const result = spawnSync("/usr/bin/git", ["--git-dir", snapshot.repository, "show", `${snapshot.head}:${name}`]);
    assert.equal(result.status, 0); assert.deepEqual(result.stdout, bytes);
  });
  assert.equal(writes, 1); assert.equal(reads, 1);
});

for (const damage of ["missing", "duplicate", "invalid"]) test(`snapshot refuses ${damage} import marks before publication`, t => {
  const f = fixture(t), native = childProcess.spawnSync;
  const mock = t.mock.method(childProcess, "spawnSync", ((executable: string, argv: string[], options: Parameters<typeof native>[2]) => {
    const result = native(executable, argv, options);
    const marks = argv.find(arg => arg.startsWith("--export-marks="))?.slice("--export-marks=".length);
    if (marks !== undefined && result.status === 0) {
      const lines = readFileSync(marks, "utf8").trimEnd().split("\n");
      writeFileSync(marks, damage === "missing" ? lines.slice(1).join("\n") : damage === "duplicate"
        ? [...lines, lines[0]].join("\n") : ":1 invalid-object-id\n");
    }
    return result;
  }) as typeof native);
  syncBuiltinESMExports();
  try { assert.throws(() => withProjectSnapshot(f.options, () => assert.fail("invalid import was published")), { code: "REF_STATE_UNKNOWN" }); }
  finally { mock.mock.restore(); syncBuiltinESMExports(); }
  assert.deepEqual(readdirSync(f.root).filter(name => name.startsWith(".snapshot")), []);
});
for (const format of ["sha1", "sha256"] as const) test(`DR27: ${format} snapshot captures raw worktree bytes without touching the source`, t => {
  const f = fixture(t, format);
  const marker = join(f.root, "ran");
  const hook = join(f.root, "hook"); writeFileSync(hook, `#!/bin/sh\necho ran >> '${marker}'\ncat\n`); chmodSync(hook, 0o755);
  f.run("config", "core.fsmonitor", hook); f.run("config", "filter.bad.clean", hook);
  f.run("config", "core.autocrlf", "true");
  writeFileSync(join(f.project, ".gitattributes"), "* filter=bad\n*.txt text\n");
  writeFileSync(join(f.project, ".gitignore"), "ignored\nnow-ignored\n");
  writeFileSync(join(f.project, "tracked"), "working\n");
  unlinkSync(join(f.project, "removed"));
  writeFileSync(join(f.project, "new.txt"), "raw\r\n");
  writeFileSync(join(f.project, "ignored"), "must not travel\n");
  writeFileSync(join(f.project, "now-ignored"), "still tracked\n");
  writeFileSync(join(f.project, "binary"), Buffer.from([0, 255, 1, 128]));
  writeFileSync(join(f.project, "exec"), "#!/bin/sh\n"); chmodSync(join(f.project, "exec"), 0o755);
  writeFileSync(join(f.project, "odd\n\tname"), "odd\n");
  symlinkSync("/outside/not-read", join(f.project, "link"));
  const index = readFileSync(join(f.project, ".git", "index"));
  const refs = readFileSync(join(f.project, ".git", "refs", "heads", "main"));
  withProjectSnapshot(f.options, snapshot => {
    assert.equal(snapshot.git(["rev-parse", `${snapshot.head}^`]), f.parent);
    assert.equal(snapshot.git(["show", `${snapshot.head}:tracked`]), "working");
    assert.equal(snapshot.git(["show", `${snapshot.head}:now-ignored`]), "still tracked");
    assert.equal(snapshot.git(["show", `${snapshot.head}:link`]), "/outside/not-read");
    const raw = spawnSync("git", ["--git-dir", snapshot.repository, "show", `${snapshot.head}:new.txt`]);
    assert.deepEqual(raw.stdout, Buffer.from("raw\r\n"));
    assert.deepEqual(spawnSync("git", ["--git-dir", snapshot.repository, "show", `${snapshot.head}:binary`]).stdout, Buffer.from([0, 255, 1, 128]));
    const entries = snapshot.git(["ls-tree", "-rz", snapshot.head]);
    assert.match(entries, /100755 blob [a-f0-9]+\texec\0/);
    assert.match(entries, /120000 blob [a-f0-9]+\tlink\0/);
    assert.ok(entries.includes("\todd\n\tname\0"));
    assert.ok(!entries.includes("\tremoved\0") && !entries.includes("\tignored\0"));
  });
  assert.deepEqual(readFileSync(join(f.project, ".git", "index")), index);
  assert.deepEqual(readFileSync(join(f.project, ".git", "refs", "heads", "main")), refs);
  assert.equal(existsSync(marker), false, "source fsmonitor/clean filter was executed");
  assert.deepEqual(readdirSync(f.root).filter(name => name.startsWith(".snapshot")), []);
});
test("DR27: a clean project reuses HEAD, while unborn and plain projects keep their files", t => {
  const f = fixture(t);
  withProjectSnapshot(f.options, snapshot => assert.equal(snapshot.head, f.parent));
  rmSync(join(f.project, ".git"), { recursive: true });
  writeFileSync(join(f.project, ".gitignore"), "ignored\n"); writeFileSync(join(f.project, "ignored"), "skip");
  for (const sourceIsGit of [false, true]) {
    if (sourceIsGit) f.run("init", "-q", "-b", "main");
    withProjectSnapshot({ ...f.options, parent: null, sourceIsGit }, snapshot => {
      assert.equal(snapshot.git(["show", `${snapshot.head}:tracked`]), "initial");
      assert.ok(!snapshot.git(["ls-tree", "-rz", snapshot.head]).includes("\tignored\0"));
    });
  }
});
test("UX-09/DR27: a checked-out submodule refuses the snapshot, naming its path", t => {
  const f = fixture(t);
  mkdirSync(join(f.project, "dep"));
  f.run("update-index", "--add", "--cacheinfo", `160000,${f.parent},dep`);
  f.run("commit", "-qm", "gitlink");
  const head = f.run("rev-parse", "HEAD");
  assert.throws(() => withProjectSnapshot({ ...f.options, parent: head }, () => assert.fail("snapshot over a submodule")),
    (error: unknown) => error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE" &&
      error.message === "snapshot contains a submodule: dep");
});
test("DR27: unreadable content and raced parent symlinks refuse a snapshot rather than omit or follow", t => {
  const f = fixture(t); const reader = new SnapshotReader(f.project); t.after(() => reader.close());
  chmodSync(join(f.project, "tracked"), 0);
  try { assert.throws(() => withProjectSnapshot(f.options, () => assert.fail("published unreadable snapshot")), /EACCES/); }
  finally { chmodSync(join(f.project, "tracked"), 0o600); }
  symlinkSync(f.root, join(f.project, "escape"));
  assert.throws(() => reader.entry("escape/hook"), process.platform === "linux" ? { code: "STORE_CORRUPT" } : /ENOTDIR|ELOOP/);
  const entry = reader.entry("tracked")!;
  try {
    writeFileSync(join(f.project, "tracked"), "changed content\n");
    assert.throws(() => copySnapshotFile(entry, "tracked", () => {}), /changed during the snapshot/);
  } finally { closeSync(entry.descriptor); }
});
test("DR27: the Mac's initial bundle carries the same dirty snapshot without a source commit", async t => {
  const f = fixture(t); writeFileSync(join(f.project, "tracked"), "Mac work in progress\n");
  const index = readFileSync(join(f.project, ".git", "index"));
  const out = join(f.root, "snapshot.bundle");
  const result = await new MacGit("/usr/bin/git", prepareHostProjectDirectory).bundle(f.project, "main", null, out);
  assert.notEqual(result.head, f.parent);
  assert.equal(f.run("rev-parse", "HEAD"), f.parent);
  assert.deepEqual(readFileSync(join(f.project, ".git", "index")), index);
  const clone = join(f.root, "clone");
  const fetched = spawnSync("git", ["clone", "--quiet", "--branch", "main", out, clone], { env: GIT_ENV });
  assert.equal(fetched.status, 0, fetched.stderr.toString());
  assert.equal(readFileSync(join(clone, "tracked"), "utf8"), "Mac work in progress\n");
});

for (const host of [false, true]) {
  test(`DR27: ${host ? "host" : "society"} snapshot survives async consumption and is collected after settlement`, async t => {
    const f = fixture(t);
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    let repository = "";
    const pending = withProjectSnapshot({ ...f.options, ...(host ? { prepare: prepareHostProjectDirectory } : {}) }, async snapshot => {
      repository = snapshot.repository;
      await ready;
      assert.equal(snapshot.git(["show", `${snapshot.head}:tracked`]), "initial");
      return snapshot.head;
    });
    assert.equal(existsSync(repository), true);
    assert.equal(readdirSync(f.root).filter(name => name.startsWith(".snapshot")).length, 2);
    release();
    assert.equal(await pending, f.parent);
    assert.equal(existsSync(repository), false);
    assert.deepEqual(readdirSync(f.root).filter(name => name.startsWith(".snapshot")), []);
  });
  for (const asynchronous of [false, true]) {
    test(`DR27: ${host ? "host" : "society"} snapshot cleans up after ${asynchronous ? "async" : "sync"} consumer failure`, async t => {
      const f = fixture(t); const failure = new Error("consumer failed");
      const consume = () => withProjectSnapshot({ ...f.options, ...(host ? { prepare: prepareHostProjectDirectory } : {}) }, () => {
        if (asynchronous) return Promise.reject(failure);
        throw failure;
      });
      if (asynchronous) await assert.rejects(consume, error => error === failure);
      else assert.throws(consume, error => error === failure);
      assert.deepEqual(readdirSync(f.root).filter(name => name.startsWith(".snapshot")), []);
    });
  }
}

test("DR27/P0-4: cleanup attempts every owner and retains the consumer failure first", async t => {
  const f = fixture(t);
  const consumer = new Error("consumer failed"), close = new Error("reader close failed"), dispose = new Error("dispose failed");
  const realClose = SnapshotReader.prototype.close;
  t.mock.method(SnapshotReader.prototype, "close", function(this: SnapshotReader) { realClose.call(this); throw close; });
  let disposed = 0;
  const prepare = (path: string) => {
    const owner = prepareProjectDirectory(path);
    return { ...owner, dispose() { disposed++; owner.dispose(); throw dispose; } };
  };
  await assert.rejects(withProjectSnapshot({ ...f.options, prepare }, async () => { throw consumer; }), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [consumer, close, dispose]);
    return true;
  });
  assert.equal(disposed, 1);
  assert.deepEqual(readdirSync(f.root).filter(name => name.startsWith(".snapshot")), []);
});

for (const host of [false, true]) test(`DR27/FS-005: ${host ? "host" : "society"} preparation never adopts an existing tree`, t => {
  const f = fixture(t); const path = join(f.root, "existing"); mkdirSync(path);
  const bytes = join(path, "keep"); writeFileSync(bytes, "not ours");
  assert.throws(() => (host ? prepareHostProjectDirectory : prepareProjectDirectory)(path), { code: "EEXIST" });
  assert.equal(readFileSync(bytes, "utf8"), "not ours");
  assert.equal(existsSync(`${path}.lease`), false);
});

test("DR27: file/directory/symlink replacements use worktree types without traversing old descendants", t => {
  const f = fixture(t);
  mkdirSync(join(f.project, "was-directory")); writeFileSync(join(f.project, "was-directory", "child"), "old");
  mkdirSync(join(f.project, "now-link")); writeFileSync(join(f.project, "now-link", "child"), "old");
  f.run("add", "."); f.run("commit", "-qm", "directories");
  const parent = f.run("rev-parse", "HEAD");
  rmSync(join(f.project, "was-directory"), { recursive: true }); writeFileSync(join(f.project, "was-directory"), "file now");
  rmSync(join(f.project, "now-link"), { recursive: true }); symlinkSync("/outside/not-read", join(f.project, "now-link"));
  unlinkSync(join(f.project, "tracked")); mkdirSync(join(f.project, "tracked")); writeFileSync(join(f.project, "tracked", "new"), "new child");
  unlinkSync(join(f.project, "removed")); mkdirSync(join(f.project, "removed"));
  withProjectSnapshot({ ...f.options, parent }, snapshot => {
    assert.equal(snapshot.git(["show", `${snapshot.head}:was-directory`]), "file now");
    assert.equal(snapshot.git(["show", `${snapshot.head}:now-link`]), "/outside/not-read");
    assert.equal(snapshot.git(["show", `${snapshot.head}:tracked/new`]), "new child");
    const files = snapshot.git(["ls-tree", "-rz", "--name-only", snapshot.head]);
    assert.equal(files.includes("was-directory/child"), false);
    assert.equal(files.includes("now-link/child"), false);
    assert.equal(files.includes("removed"), false);
  });
});

test("DR27: invoking inside a repository snapshots the whole parent tree without moving or deleting siblings", t => {
  const f = fixture(t); mkdirSync(join(f.project, "sub")); writeFileSync(join(f.project, "sub", "file"), "committed");
  f.run("add", "."); f.run("commit", "-qm", "subdirectory");
  writeFileSync(join(f.project, "sub", "file"), "dirty"); writeFileSync(join(f.project, "tracked"), "dirty sibling");
  withProjectSnapshot({ ...f.options, source: join(f.project, "sub"), parent: f.run("rev-parse", "HEAD") }, snapshot => {
    assert.equal(snapshot.git(["show", `${snapshot.head}:sub/file`]), "dirty");
    assert.equal(snapshot.git(["show", `${snapshot.head}:tracked`]), "dirty sibling");
    assert.equal(snapshot.git(["ls-tree", "-rz", "--name-only", snapshot.head]).includes("\0file\0"), false);
  });
});

test("DR27/P0-4: a retained Git closure cannot reuse a released preparation descriptor", t => {
  const f = fixture(t);
  const git = withProjectSnapshot(f.options, snapshot => snapshot.git);
  assert.throws(() => git(["rev-parse", "HEAD"]), /ownership has ended/);
});
