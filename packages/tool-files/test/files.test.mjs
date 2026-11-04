import test from "node:test";
import assert from "node:assert/strict";
import fs, { appendFileSync, chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FILE_CONTENT_CHANGED_REFUSAL, WorkspaceRefusal, componentsWithin, mkdirWithin, readWithin, readBoundedWithin, readdirWithin, withFileWithin, withSearchSnapshot, writeWithin, writeWithinUnchanged } from "@oma/tool-files";

function workspace(t) {
  const root = mkdtempSync(join(tmpdir(), "oma-tool-files-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

for (const delta of [-1, 0, 1]) test(`019. Contained UTF-8 source at its byte bound ${delta >= 0 ? "+" : ""}${delta}`, t => {
  const root = workspace(t), value = "한😀" + "x".repeat(64 + delta - 7), path = join(root, "source");
  writeFileSync(path, value);
  assert.equal(Buffer.byteLength(value), 64 + delta);
  if (delta <= 0) assert.deepEqual(readBoundedWithin(root, "source", 64), Buffer.from(value));
  else assert.throws(() => readBoundedWithin(root, "source", 64), /SOURCE_UNREADABLE/);
  assert.equal(readFileSync(path, "utf8"), value);
  writeFileSync(join(root, "next"), "healthy");
  assert.equal(readBoundedWithin(root, "next", 64).toString(), "healthy");
});

for (const kind of ["append", "truncate", "same-size rewrite", "new hardlink"]) {
  test(`020. Contained snapshot refuses a ${kind} between its read and final observation`, t => {
    const root = workspace(t), path = join(root, "source");
    writeFileSync(path, "source");
    utimesSync(path, 1, 1); // A same-size rewrite has an independently observable mtime change.
    const original = fs.readSync;
    if (kind === "new hardlink") {
      const stat = fs.fstatSync;
      t.mock.method(fs, "fstatSync", (...args) => {
        const observed = stat(...args);
        // Real hardlink, controlled coarse clock: nlink remains observable
        // even when both metadata reads share one timestamp tick.
        return args[1]?.bigint ? { ...observed, mtimeNs: 0n, ctimeNs: 0n } : observed;
      });
    }
    let changed = false;
    t.mock.method(fs, "readSync", (...args) => {
      const count = original(...args);
      if (count > 0 && !changed) {
        changed = true;
        if (kind === "append") appendFileSync(path, "!");
        else if (kind === "truncate") writeFileSync(path, "");
        else if (kind === "same-size rewrite") writeFileSync(path, "edited");
        else linkSync(path, join(root, "alias"));
      }
      return count;
    });
    syncBuiltinESMExports();
    try {
      assert.throws(() => readBoundedWithin(root, "source", 64), /SOURCE_CHANGED/);
      assert.equal(changed, true);
      assert.equal(readFileSync(path, "utf8"), kind === "append" ? "source!" : kind === "truncate" ? "" : kind === "same-size rewrite" ? "edited" : "source");
    } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  });
}

test("021. A bounded source keeps its opened inode when an ancestor becomes an outside symlink", t => {
  const root = workspace(t), selected = join(root, "selected"), outside = join(root, "outside"), moved = join(root, "moved");
  mkdirSync(selected); mkdirSync(outside);
  writeFileSync(join(selected, "source"), "admitted bytes");
  writeFileSync(join(outside, "source"), "outside bytes");
  const original = fs.readSync;
  let changed = false;
  t.mock.method(fs, "readSync", (...args) => {
    const count = original(...args);
    if (count > 0 && !changed) { changed = true; renameSync(selected, moved); symlinkSync(outside, selected); }
    return count;
  });
  syncBuiltinESMExports();
  try { assert.equal(readBoundedWithin(root, "selected/source", 64).toString(), "admitted bytes"); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.equal(changed, true);
  assert.throws(() => readBoundedWithin(root, "selected/source", 64), WorkspaceRefusal);
  assert.equal(readFileSync(join(outside, "source"), "utf8"), "outside bytes");
});

test("001. File policy refuses escaping and malformed paths before any effect", () => {
  assert.deepEqual(componentsWithin("/workspace", "a/b"), ["a", "b"]);
  for (const path of ["../escape", "/elsewhere", "a\0b"])
    assert.throws(() => componentsWithin("/workspace", path), WorkspaceRefusal);
});

test("002. Real held descriptors survive a root rename; links cannot carry a tool write", async t => {
  const root = workspace(t), selected = join(root, "selected"), outside = join(root, "outside");
  mkdirSync(selected); mkdirSync(outside);
  writeFileSync(join(selected, "note"), "held bytes");
  writeFileSync(join(outside, "note"), "outside bytes");
  await withFileWithin(selected, "note", async held => {
    renameSync(selected, join(root, "moved"));
    symlinkSync(outside, selected);
    assert.equal(readFileSync(held, "utf8"), "held bytes");
  });
  assert.throws(() => writeWithin(selected, "note", "changed"), WorkspaceRefusal);
  assert.equal(readFileSync(join(outside, "note"), "utf8"), "outside bytes");
  const moved = join(root, "moved");
  linkSync(join(outside, "note"), join(moved, "alias"));
  assert.throws(() => writeWithin(moved, "alias", "changed"), WorkspaceRefusal);
  assert.equal(readFileSync(join(outside, "note"), "utf8"), "outside bytes");
});

test("003. The actual snapshot is declared before creation and removed after callback failure", async t => {
  const root = workspace(t), primary = new Error("consumer failure"), declared = [];
  mkdirWithin(root, "nested"); writeWithin(root, "nested/note", "snapshot bytes");
  await assert.rejects(withSearchSnapshot(root, "nested/note", undefined, async (snapshot, target) => {
    assert.equal(readFileSync(target, "utf8"), "snapshot bytes");
    writeWithin(root, "nested/note", "later bytes");
    assert.equal(readFileSync(target, "utf8"), "snapshot bytes");
    throw primary;
  }, undefined, name => {
    const path = join(tmpdir(), name);
    assert.equal(existsSync(path), false);
    declared.push(path);
  }), error => error === primary);
  for (const path of declared) assert.equal(existsSync(path), false);
  assert.equal(readWithin(root, "nested/note").toString(), "later bytes");
});

test("004. Snapshot walking excludes links and cleanup does not follow a planted directory link", async t => {
  const root = workspace(t), outside = workspace(t);
  mkdirWithin(root, "nested"); writeWithin(root, "nested/note", "approved bytes");
  writeFileSync(join(outside, "keep"), "outside bytes");
  symlinkSync(outside, join(root, "link"));
  assert.deepEqual(readdirWithin(root, "nested"), ["note"]);
  let copied;
  await withSearchSnapshot(root, ".", undefined, async snapshot => {
    copied = snapshot;
    assert.equal(existsSync(join(snapshot, "link")), false);
    assert.equal(readFileSync(join(snapshot, "nested", "note"), "utf8"), "approved bytes");
    symlinkSync(outside, join(snapshot, "planted"));
  });
  assert.equal(existsSync(copied), false);
  assert.equal(readFileSync(join(outside, "keep"), "utf8"), "outside bytes");
});

test("005. Scoped snapshots contain only the selected file/subtree and ancestor ignore inputs", async t => {
  const root = workspace(t), outside = workspace(t);
  mkdirWithin(root, "branch/selected/deep");
  mkdirWithin(root, "unrelated");
  writeWithin(root, "root.txt", "root bytes");
  writeWithin(root, "branch/sibling.txt", "sibling bytes");
  writeWithin(root, "branch/selected/note.txt", "selected bytes");
  writeWithin(root, "branch/selected/deep/leaf.txt", "nested bytes");
  writeWithin(root, "unrelated/secret.txt", "unrelated bytes");
  mkdirWithin(root, ".git");
  writeWithin(root, ".git/config", "private repository configuration");
  for (const directory of ["", "branch"])
    for (const ignore of [".gitignore", ".ignore", ".rgignore", ".fdignore"])
      writeWithin(root, join(directory, ignore), `${directory || "root"}-${ignore}\n`);
  writeFileSync(join(outside, "secret.txt"), "outside bytes");
  symlinkSync(outside, join(root, "branch/selected/link"));
  linkSync(join(outside, "secret.txt"), join(root, "branch/selected/alias.txt"));
  chmodSync(join(root, "unrelated"), 0);
  const rootEntries = [".fdignore", ".git", ".gitignore", ".ignore", ".rgignore", "branch"];
  const branchIgnores = [".fdignore", ".gitignore", ".ignore", ".rgignore"];
  try {
    await withSearchSnapshot(root, "branch/selected/note.txt", undefined, async (snapshot, target) => {
      assert.equal(target, join(snapshot, "branch/selected/note.txt"));
      assert.equal(readFileSync(target, "utf8"), "selected bytes");
      assert.deepEqual(readdirSync(snapshot).sort(), rootEntries);
      assert.deepEqual(readdirSync(join(snapshot, "branch")).sort(), [...branchIgnores, "selected"]);
      assert.deepEqual(readdirSync(join(snapshot, "branch/selected")), ["note.txt"]);
      assert.equal(readFileSync(join(snapshot, ".gitignore"), "utf8"), "root-.gitignore\n");
      assert.equal(readFileSync(join(snapshot, "branch/.ignore"), "utf8"), "branch-.ignore\n");
      assert.deepEqual(readdirSync(join(snapshot, ".git")), []);
    });
    await withSearchSnapshot(root, "branch/selected", undefined, async (snapshot, target) => {
      assert.equal(target, join(snapshot, "branch/selected"));
      assert.deepEqual(readdirSync(snapshot).sort(), rootEntries);
      assert.deepEqual(readdirSync(join(snapshot, "branch")).sort(), [...branchIgnores, "selected"]);
      assert.deepEqual(readdirSync(target).sort(), ["deep", "note.txt"]);
      assert.equal(readFileSync(join(target, "deep/leaf.txt"), "utf8"), "nested bytes");
    });
    // Selecting an ignore file itself must not copy it twice.
    await withSearchSnapshot(root, "branch/.ignore", undefined, async (_snapshot, target) => {
      assert.equal(readFileSync(target, "utf8"), "branch-.ignore\n");
    });
  } finally { chmodSync(join(root, "unrelated"), 0o700); }
  await withSearchSnapshot(root, ".", undefined, async (snapshot, target) => {
    assert.equal(target, snapshot);
    assert.equal(readFileSync(join(snapshot, "root.txt"), "utf8"), "root bytes");
    assert.equal(readFileSync(join(snapshot, "branch/sibling.txt"), "utf8"), "sibling bytes");
    assert.equal(readFileSync(join(snapshot, "unrelated/secret.txt"), "utf8"), "unrelated bytes");
    assert.deepEqual(readdirSync(join(snapshot, ".git")), []);
    assert.equal(existsSync(join(snapshot, "branch/selected/alias.txt")), false);
    assert.equal(existsSync(join(snapshot, "branch/selected/link")), false);
  });
});

test("006. Scoped snapshots keep the selected descriptors through an ancestor replacement", async t => {
  const root = workspace(t), outside = workspace(t);
  mkdirWithin(root, "branch");
  writeWithin(root, ".gitignore", "*.ignored\n");
  writeWithin(root, "branch/note.txt", "held selected bytes");
  writeFileSync(join(outside, "note.txt"), "outside bytes");
  let replaced = false;
  await withSearchSnapshot(root, "branch/note.txt", undefined, async (_snapshot, target) => {
    assert.equal(replaced, true);
    assert.equal(readFileSync(target, "utf8"), "held selected bytes");
  }, () => {
    if (replaced) return;
    replaced = true;
    renameSync(join(root, "branch"), join(root, "moved"));
    symlinkSync(outside, join(root, "branch"));
  });
  assert.equal(readFileSync(join(outside, "note.txt"), "utf8"), "outside bytes");
});

test("007. Scoped snapshot refusals and aborts remove declared copies without exposing links or repository internals", async t => {
  const root = workspace(t), outside = workspace(t);
  mkdirWithin(root, "branch");
  writeWithin(root, "branch/note.txt", "selected bytes");
  mkdirWithin(root, ".git");
  writeWithin(root, ".git/config", "private repository configuration");
  writeFileSync(join(outside, "secret.txt"), "outside bytes");
  symlinkSync(outside, join(root, "linked"));
  symlinkSync(join(outside, "secret.txt"), join(root, "leaf-link"));
  linkSync(join(outside, "secret.txt"), join(root, "alias.txt"));
  const declared = [];
  const named = name => { declared.push(join(tmpdir(), name)); };
  for (const path of ["../escape", "linked/secret.txt", "leaf-link", "alias.txt", ".git", ".git/config"])
    await assert.rejects(withSearchSnapshot(root, path, undefined, async () => assert.fail("refused target reached consumer"), undefined, named), WorkspaceRefusal);
  for (const path of ["branch", "branch/note.txt"]) {
    const controller = new AbortController();
    await assert.rejects(withSearchSnapshot(root, path, controller.signal,
      async () => assert.fail("aborted target reached consumer"), () => controller.abort(), named), /search aborted/);
  }
  const alreadyAborted = new AbortController(); alreadyAborted.abort();
  await assert.rejects(withSearchSnapshot(root, ".", alreadyAborted.signal,
    async () => assert.fail("aborted root reached consumer"), undefined, named), /search aborted/);
  for (const path of declared) assert.equal(existsSync(path), false, `snapshot remained at ${path}`);
  assert.equal(readFileSync(join(outside, "secret.txt"), "utf8"), "outside bytes");
});

/** Which path the descriptor names, so an interleaving hook can tell the
 * tool's own reads apart from anything else in the process. */
function descriptorTargets(fd, file) {
  for (const base of ["/proc/self/fd", "/dev/fd"]) {
    try { if (fs.readlinkSync(`${base}/${fd}`) === file) return true; } catch { /* not this one */ }
  }
  return false;
}
/** A same-uid writer outside the shared writer's serialization, landing inside
 * the conditional write's own validation window: the tool's descriptor is
 * about to be read (`before`) or has just been read (`after`). */
function interleaveWithRead(file, when, mutate) {
  const real = fs.readSync;
  let interleaved = false;
  fs.readSync = (fd, ...args) => {
    const ours = !interleaved && descriptorTargets(fd, file);
    if (ours && when === "before") { interleaved = true; mutate(); }
    const count = real(fd, ...args);
    if (ours && when === "after") { interleaved = true; mutate(); }
    return count;
  };
  syncBuiltinESMExports();
  return { interleaved: () => interleaved, restore: () => { fs.readSync = real; syncBuiltinESMExports(); } };
}

for (const when of ["before", "after"]) test(`022. A hardlink added ${when} conditional validation cannot carry the fix outside, even within one timestamp tick`, t => {
  const root = workspace(t), outside = workspace(t), file = join(root, "source"), alias = join(outside, "alias");
  writeFileSync(file, "source");
  const stat = fs.fstatSync;
  t.mock.method(fs, "fstatSync", (...args) => {
    const observed = stat(...args);
    return args[1]?.bigint ? { ...observed, mtimeNs: 0n, ctimeNs: 0n } : observed;
  });
  const interleaving = interleaveWithRead(file, when, () => linkSync(file, alias));
  try {
    assert.throws(() => writeWithinUnchanged(root, "source", "changed", { text: "source" }), error =>
      error instanceof WorkspaceRefusal && error.message === FILE_CONTENT_CHANGED_REFUSAL);
    assert.equal(interleaving.interleaved(), true);
    assert.equal(readFileSync(file, "utf8"), "source");
    assert.equal(readFileSync(alias, "utf8"), "source", "a newly shared inode cannot receive the workspace fix");
  } finally { interleaving.restore(); t.mock.restoreAll(); syncBuiltinESMExports(); }
});

for (const point of ["after admission", "before identity observation"]) test(`023. Inode-conditional writes enforce the last observed link count (${point})`, t => {
  const root = workspace(t), outside = workspace(t), file = join(root, "source"), alias = join(outside, "alias");
  writeFileSync(file, "source");
  const identity = fs.statSync(file), stat = fs.fstatSync;
  let checked = 0, linked = false;
  t.mock.method(fs, "fstatSync", (...args) => {
    const ours = descriptorTargets(args[0], file);
    if (ours) checked++;
    if (ours && checked === 2 && point === "before identity observation") { linkSync(file, alias); linked = true; }
    const observed = stat(...args);
    if (ours && checked === 1 && point === "after admission") { linkSync(file, alias); linked = true; }
    return observed;
  });
  syncBuiltinESMExports();
  try {
    assert.throws(() => writeWithinUnchanged(root, "source", "changed", { dev: identity.dev, ino: identity.ino }), WorkspaceRefusal);
    assert.equal(linked, true);
    assert.equal(checked, 2, "the final descriptor observation must enforce the ownership it actually sees");
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.equal(readFileSync(file, "utf8"), "source");
  assert.equal(readFileSync(alias, "utf8"), "source");
});

for (const expected of ["text", "inode"]) {
  for (const mutation of ["unlink", "replace"]) test(`024. ${expected}-conditional writes refuse a ${mutation} after opening instead of reporting an orphan write`, t => {
    const root = workspace(t), file = join(root, "source");
    writeFileSync(file, "source");
    const identity = fs.statSync(file), stat = fs.fstatSync;
    let changed = false;
    t.mock.method(fs, "fstatSync", (...args) => {
      const observed = stat(...args);
      if (!changed && descriptorTargets(args[0], file)) {
        changed = true; unlinkSync(file);
        if (mutation === "replace") writeFileSync(file, "replacement");
      }
      return observed;
    });
    syncBuiltinESMExports();
    try {
      assert.throws(() => writeWithinUnchanged(root, "source", "changed", expected === "text"
        ? { text: "source" } : { dev: identity.dev, ino: identity.ino }), WorkspaceRefusal);
      assert.equal(changed, true);
    } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
    if (mutation === "unlink") assert.equal(existsSync(file), false);
    else assert.equal(readFileSync(file, "utf8"), "replacement", "the unrelated new inode must remain untouched");
  });
}

test("008. A conditional write applies the computed fix when the input text is unchanged", t => {
  const root = workspace(t), file = join(root, "computed.txt");
  writeFileSync(file, "abc");
  writeWithinUnchanged(root, "computed.txt", "new", { text: "abc" });
  assert.equal(readFileSync(file, "utf8"), "new");
});

test("009. A conditional write refuses text that changed before the call and leaves the file alone", t => {
  const root = workspace(t), file = join(root, "computed.txt");
  writeFileSync(file, "abc!");
  assert.throws(() => writeWithinUnchanged(root, "computed.txt", "new", { text: "abc" }),
    error => error instanceof WorkspaceRefusal && error.message === FILE_CONTENT_CHANGED_REFUSAL);
  assert.equal(readFileSync(file, "utf8"), "abc!");
});

for (const when of ["before", "after"]) test(`010. A concurrent append ${when} the validation read refuses instead of being truncated away`, t => {
  const root = workspace(t), file = join(root, "computed.txt");
  writeFileSync(file, "abc");
  const racer = interleaveWithRead(file, when, () => appendFileSync(file, "!"));
  try {
    assert.throws(() => writeWithinUnchanged(root, "computed.txt", "new", { text: "abc" }),
      error => error instanceof WorkspaceRefusal && error.message === FILE_CONTENT_CHANGED_REFUSAL);
  } finally { racer.restore(); }
  assert.equal(racer.interleaved(), true, "the append never reached the validation window");
  assert.equal(readFileSync(file, "utf8"), "abc!", "the concurrent append was discarded");
});

test("018. Every ordinary contained file entry rejects a real FIFO without blocking its engine", {timeout:15000},async t=>{
 const root=workspace(t),{execFileSync,spawnSync}=await import('node:child_process');execFileSync('mkfifo',[join(root,'pipe')]);
 for(const operation of ['readWithin','withFileWithin','writeWithin','writeWithinUnchanged','readdirWithin','accessWithin']){
  const result=spawnSync(process.execPath,['--input-type=module','-e',`
   import * as files from '@oma/tool-files';
   try{const name=${JSON.stringify(operation)};
    const args=name==='withFileWithin'?[()=>Promise.resolve('bad')]:name==='writeWithin'?['bad']:name==='writeWithinUnchanged'?['bad',{text:'old'}]:name==='accessWithin'?[true]:[];
    await files[name](${JSON.stringify(root)},'pipe',...args);throw Error('FIFO was accepted');
   }catch(error){if(error.message==='FIFO was accepted')throw error;process.stdout.write('refused');}
  `],{encoding:'utf8',timeout:1000,killSignal:'SIGKILL'});
  assert.equal(result.error,undefined,`${operation}: ${result.error}`);assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'refused');
 }
});
