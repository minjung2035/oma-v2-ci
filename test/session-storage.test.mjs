import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { Store } from "@oma/storage";
import { makeValidAgent } from "../dist/test/fixtures/spec.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStorage } from "#oma-test/app/runtime/session-storage";
import { managedResticPath } from "@oma/storage/restic-tool";
import { tryHoldSociety } from "#oma-test/app/runtime/society-lease";
import { digestCacheTrees } from "@oma/storage/cache-trees";

const tool = process.env.OMA_RESTIC_COMMAND ?? managedResticPath();
function fixture() {
  assert.ok(tool && existsSync(tool), "Install the pinned host dependency: npm run setup:storage");
  const root = mkdtempSync(join(tmpdir(), "oma-session-storage-")), project = join(root, "project");
  mkdirSync(project); chmodSync(root, 0o700);
  const git = (path, ...args) => execFileSync("git", ["-C", path, ...args], { env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }, stdio: "pipe" }).toString();
  git(project, "init", "-b", "main"); git(project, "config", "user.name", "Test"); git(project, "config", "user.email", "test@example.invalid");
  writeFileSync(join(project, "code"), "committed\n"); git(project, "add", "."); git(project, "commit", "-m", "initial");
  const leases = [], events = [];
  function society(name) {
    const stateRoot = join(root, name); mkdirSync(stateRoot, { mode: 0o700 });
    writeFileSync(join(stateRoot, "project-binding.json"), JSON.stringify({ kind: "oma-project-binding-v1", society: name, canonicalProjectPath: project }), { mode: 0o600 });
    writeFileSync(join(stateRoot, "runtime.sqlite"), "closed runtime database\n", { mode: 0o600 });
    mkdirSync(join(stateRoot, "repos")); git(stateRoot, "clone", "--bare", project, "repos/project.git");
    mkdirSync(join(stateRoot, "agents/worker"), { recursive: true }); git(stateRoot, "clone", "--no-hardlinks", project, "agents/worker/workspace");
    const workspace = join(stateRoot, "agents/worker/workspace");
    git(workspace, "branch", "local-branch");
    writeFileSync(join(workspace, "code"), "staged\n"); git(workspace, "add", "code"); writeFileSync(join(workspace, "code"), "staged plus unstaged\n");
    writeFileSync(join(workspace, ".gitignore"), "ignored/\n"); mkdirSync(join(workspace, "ignored"));
    writeFileSync(join(workspace, "ignored/secret"), "ignored private bytes\n", { mode: 0o600 });
    writeFileSync(join(workspace, "run"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    writeFileSync(join(workspace, "한글\tnew\nline"), "odd name\n");
    linkSync(join(workspace, "run"), join(workspace, "run-hardlink"));
    const outside = join(root, "outside"); writeFileSync(outside, "outside must remain\n"); symlinkSync(outside, join(workspace, "outside-link"));
    mkdirSync(join(stateRoot, "agents/worker/home")); writeFileSync(join(stateRoot, "agents/worker/home/settings"), "home\n");
    mkdirSync(join(stateRoot, "agents/worker/runner/sessions"), { recursive: true }); writeFileSync(join(stateRoot, "agents/worker/runner/sessions/history"), "history\n");
    mkdirSync(join(stateRoot, "staging")); writeFileSync(join(stateRoot, "staging/accepted"), "accepted artifact\n");
    const lease = tryHoldSociety(stateRoot); assert.ok(lease); leases.push(lease);
    let death = true, calls = 0;
    const storage = SessionStorage.forSociety({ stateRoot, society: name, fence: lease.fence, env: { ...process.env, OMA_RESTIC_COMMAND: tool },
      log: line => events.push(line), quiesce: actors => { calls++; assert.deepEqual(actors, [{ name: "worker", incarnation: 2 }]); if (!death) throw Error("native death unknown"); } });
    assert.ok(storage);
    return { stateRoot, workspace, storage, setDeath: value => { death = value; }, calls: () => calls,
      roots: ["repos", "staging", "agents/worker/workspace", "agents/worker/home"], residents: [{ name: "worker", incarnation: 2 }] };
  }
  return { root, project, society, git, events, close: () => { for (const lease of leases) lease.release(); rmSync(root, { recursive: true, force: true }); } };
}
const selection = f => JSON.parse(readFileSync(join(f.stateRoot, "session-storage.json"), "utf8"));

test("session storage restores Git index, local refs, dirty/ignored files, modes, links and runner history", async () => {
  const f = fixture();
  try {
    const a = f.society("first");
    const status = f.git(a.workspace, "status", "--porcelain=v1", "--untracked-files=all");
    const before = await digestCacheTrees(a.stateRoot, a.roots);
    await a.storage.archive(a.residents);
    assert.ok(selection(a).checkpoint.snapshot); assert.equal(existsSync(a.workspace), false); assert.equal(existsSync(join(a.stateRoot, "repos")), false);
    assert.equal(readFileSync(join(a.stateRoot, "agents/worker/runner/sessions/history"), "utf8"), "history\n");
    await a.storage.restore();
    assert.equal((await digestCacheTrees(a.stateRoot, a.roots)).digest, before.digest);
    assert.equal(f.git(a.workspace, "status", "--porcelain=v1", "--untracked-files=all"), status);
    assert.match(f.git(a.workspace, "branch", "--list"), /local-branch/);
    assert.equal(lstatSync(join(a.workspace, "run")).ino, lstatSync(join(a.workspace, "run-hardlink")).ino);
    assert.equal(readlinkSync(join(a.workspace, "outside-link")), join(f.root, "outside"));
    assert.equal(readFileSync(join(f.root, "outside"), "utf8"), "outside must remain\n");
    assert.equal(selection(a).checkpoint, null); assert.ok(a.calls() >= 4);
    assert.equal(readdirSync(a.stateRoot).some(name => name.startsWith(".session-storage-stage-")), false);
  } finally { f.close(); }
});

test("session storage shares one repository across sessions and preserves independently restored changes", async t => {
  const f = fixture();
  try {
    const a = f.society("first"), b = f.society("second");
    const shared = randomBytes(4 * 1024 * 1024);
    for (const owner of [a, b]) writeFileSync(join(owner.workspace, "ignored/common.bin"), shared);
    assert.equal(a.storage.projectRoot, b.storage.projectRoot);
    await Promise.all([a.storage.archive(a.residents), b.storage.archive(b.residents)]);
    assert.notEqual(selection(a).checkpoint.snapshot, selection(b).checkpoint.snapshot);
    const stats = JSON.parse(execFileSync(tool, ["--repo", join(a.storage.projectRoot, "repository"), "--password-file", join(a.storage.projectRoot, "password"), "--json", "stats", "--mode", "raw-data"], { encoding: "utf8" }));
    assert.ok(stats.total_size < shared.length * 1.5, `duplicate data was stored twice: ${stats.total_size}`);
    t.diagnostic(JSON.stringify({ sharedSourceBytes: shared.length * 2, storedUniqueBytes: stats.total_size }));
    await a.storage.restore(); writeFileSync(join(a.workspace, "code"), "first only\n");
    await b.storage.restore(); assert.equal(readFileSync(join(b.workspace, "code"), "utf8"), "staged plus unstaged\n");
    assert.equal(readFileSync(join(a.workspace, "code"), "utf8"), "first only\n");
  } finally { f.close(); }
});

test("unknown native death retains original workspaces and prevents cold restoration", async () => {
  const f = fixture();
  try {
    const a = f.society("first"), before = await digestCacheTrees(a.stateRoot, a.roots);
    a.setDeath(false); await assert.rejects(a.storage.archive(a.residents), /native death unknown/);
    assert.equal((await digestCacheTrees(a.stateRoot, a.roots)).digest, before.digest);
    a.setDeath(true); await a.storage.archive(a.residents); a.setDeath(false);
    await assert.rejects(a.storage.restore(), /native death unknown/); assert.equal(existsSync(a.workspace), false);
  } finally { f.close(); }
});

test("changed ledger or lost checkpoint fails closed without provisioning new repositories", async () => {
  const f = fixture();
  try {
    const a = f.society("first"); await a.storage.archive(a.residents);
    const database = join(a.stateRoot, "runtime.sqlite"), original = readFileSync(database);
    writeFileSync(database, "different database"); await assert.rejects(a.storage.restore(), /database differs/);
    writeFileSync(database, original);
    writeFileSync(database + "-wal", "nonempty WAL is still bound");
    await assert.rejects(a.storage.restore(), /database differs/); rmSync(database + "-wal");
    const record = join(a.stateRoot, "session-storage.json"), state = readFileSync(record);
    rmSync(record); await assert.rejects(a.storage.restore(), /selection is missing/);
    writeFileSync(record, state, { mode: 0o600 });
    const checkpoint = selection(a).checkpoint;
    rmSync(join(a.stateRoot, "session-checkpoints", `${checkpoint.snapshot}.json`));
    await assert.rejects(a.storage.restore(), /immutable.*missing or differs/);
    assert.equal(existsSync(join(a.stateRoot, "repos")), false);
  } finally { f.close(); }
});

test("missing tool leaves a hot workspace intact and refuses an archived session", async () => {
  const f = fixture();
  try {
    const a = f.society("first");
    const noTool = SessionStorage.forSociety({ stateRoot: a.stateRoot, society: "first", fence: 999,
      env: { OMA_RESTIC_COMMAND: join(f.root, "absent-restic") }, log: line => f.events.push(line), quiesce: () => {} });
    await noTool.archive(a.residents); assert.ok(existsSync(a.workspace)); assert.match(f.events.at(-1), /retained/);
    await a.storage.archive(a.residents); await assert.rejects(noTool.restore(), /archived/);
    assert.equal(existsSync(a.workspace), false);
  } finally { f.close(); }
});

test("corrupted backup data never replaces a partial cold cache", async () => {
  const f = fixture();
  try {
    const a = f.society("first"); await a.storage.archive(a.residents);
    mkdirSync(join(a.stateRoot, "repos")); writeFileSync(join(a.stateRoot, "repos/recovery-witness"), "keep on failure");
    const data = join(a.storage.projectRoot, "repository/data");
    const bucket = readdirSync(data).find(name => readdirSync(join(data, name)).length);
    const pack = join(data, bucket, readdirSync(join(data, bucket))[0]);
    chmodSync(pack, 0o600); writeFileSync(pack, "corrupt pack");
    await assert.rejects(a.storage.restore());
    assert.equal(readFileSync(join(a.stateRoot, "repos/recovery-witness"), "utf8"), "keep on failure");
    assert.ok(selection(a).checkpoint); assert.equal(existsSync(a.workspace), false);
  } finally { f.close(); }
});

test("failure after cold commit and partial reclamation recovers the exact checkpoint", async () => {
  const f = fixture(), original = fs.fsyncSync;
  try {
    const a = f.society("first"), before = await digestCacheTrees(a.stateRoot, a.roots);
    let injected = false;
    fs.fsyncSync = fd => {
      const path = fs.readlinkSync(`/proc/self/fd/${fd}`);
      if (path === join(a.stateRoot, "repos") && !injected && readdirSync(path).length === 0) {
        injected = true; throw Object.assign(Error("injected reclaim failure"), { code: "EIO" });
      }
      original(fd);
    };
    syncBuiltinESMExports();
    await assert.rejects(a.storage.archive(a.residents), /injected reclaim failure/);
    assert.equal(injected, true); assert.ok(selection(a).checkpoint);
    assert.deepEqual(readdirSync(join(a.stateRoot, "repos")), []);
    fs.fsyncSync = original; syncBuiltinESMExports();
    await a.storage.restore();
    assert.equal((await digestCacheTrees(a.stateRoot, a.roots)).digest, before.digest);
    assert.equal(selection(a).checkpoint, null);
  } finally { fs.fsyncSync = original; syncBuiltinESMExports(); f.close(); }
});

test("interrupted publication keeps cold selection and recovers without replaying partial cache", async () => {
  const f = fixture(), original = fs.fsyncSync;
  try {
    const a = f.society("first"), before = await digestCacheTrees(a.stateRoot, a.roots);
    await a.storage.archive(a.residents);
    let injected = false;
    fs.fsyncSync = function(fd) {
      // renameat now publishes through held parents. Fail the source-parent
      // flush after staging is visible, while cold selection still owns retry.
      const parent = readlinkSync(`/proc/self/fd/${fd}`);
      if (parent.startsWith(`${a.stateRoot}/.session-storage-stage-`) && parent.endsWith("/restored") &&
          existsSync(join(a.stateRoot, "staging")) && !injected) {
        injected = true; throw Object.assign(Error("injected restore publication failure"), { code: "EIO" });
      }
      return original(fd);
    };
    syncBuiltinESMExports();
    await assert.rejects(a.storage.restore(), /injected restore publication failure/);
    assert.equal(injected, true); assert.ok(selection(a).checkpoint);
    fs.fsyncSync = original; syncBuiltinESMExports();
    await a.storage.restore();
    assert.equal((await digestCacheTrees(a.stateRoot, a.roots)).digest, before.digest);
    assert.equal(readdirSync(a.stateRoot).some(name => name.startsWith(".session-storage-stage-")), false);
  } finally { fs.fsyncSync = original; syncBuiltinESMExports(); f.close(); }
});

test("unreadable files and extended attributes retain the complete original workspace", async () => {
  const f = fixture();
  try {
    const a = f.society("first"), file = join(a.workspace, "ignored/secret");
    chmodSync(file, 0); await assert.rejects(a.storage.archive(a.residents));
    assert.equal(lstatSync(file).mode & 0o777, 0); chmodSync(file, 0o600);
    execFileSync("python3", ["-c", "import os,sys; os.setxattr(sys.argv[1], 'user.oma-test', b'preserve')", file]);
    await assert.rejects(a.storage.archive(a.residents), /unpreserved metadata/);
    assert.equal(readFileSync(file, "utf8"), "ignored private bytes\n");
    assert.equal(existsSync(join(a.stateRoot, "session-storage.json")), false);
  } finally { f.close(); }
});

test("repository initialization retries an interrupted credential publication using the same key", async () => {
  const f = fixture();
  try {
    const a = f.society("first"), key = "1".repeat(64) + "\n";
    mkdirSync(a.storage.projectRoot, { recursive: true, mode: 0o700 });
    writeFileSync(join(a.storage.projectRoot, "password"), key, { mode: 0o600 });
    await a.storage.archive(a.residents);
    assert.equal(readFileSync(join(a.storage.projectRoot, "password"), "utf8"), key);
    assert.ok(existsSync(join(a.storage.projectRoot, "repository-ready")));
    await a.storage.restore(); assert.ok(existsSync(a.workspace));
  } finally { f.close(); }
});

test("a lost cold repository credential is never replaced with a new key", async () => {
  const f = fixture();
  try {
    const a = f.society("first"); await a.storage.archive(a.residents);
    const key = join(a.storage.projectRoot, "password"); rmSync(key);
    await assert.rejects(a.storage.restore(), /credential is missing/);
    assert.equal(existsSync(key), false); assert.equal(existsSync(a.workspace), false); assert.ok(selection(a).checkpoint);
  } finally { f.close(); }
});

test("read-only inspection of a cold SQLite DB may create an empty WAL without stranding its workspace", async () => {
  const f = fixture();
  try {
    const a = f.society("first"), database = join(a.stateRoot, "runtime.sqlite"); rmSync(database);
    const store = new Store(database, undefined, { society: "first" });
    store.transaction(() => store.insertAgent(makeValidAgent("worker", { incarnation: 2 })));
    const residents = store.listAgents().map(({ name, incarnation }) => ({ name, incarnation })); store.close();
    const before = readFileSync(database);
    await a.storage.archive(residents);
    const readonly = new DatabaseSync(database, { readOnly: true });
    try { assert.equal(readonly.prepare("SELECT incarnation FROM agents WHERE name = 'worker'").get().incarnation, 2); }
    finally { readonly.close(); }
    assert.deepEqual(readFileSync(database), before);
    assert.equal(lstatSync(database + "-wal").size, 0);
    await a.storage.restore();
    assert.deepEqual(readFileSync(database), before); assert.ok(existsSync(a.workspace));
    const reopened = new Store(database, undefined, { society: "first" });
    try { assert.equal(reopened.getAgent("worker").incarnation, 2); } finally { reopened.close(); }
  } finally { f.close(); }
});
