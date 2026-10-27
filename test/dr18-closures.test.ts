import { generateOperationId } from "@oma/native/identity";
import { lifecycleLedger } from "#oma-test/app/broker/lifecycle-ledger";
/** DR18: the decisions that closed the open questions and spikes, each held
 * by a test of what the product now does. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "@oma/storage";
import { StoreError } from "@oma/domain/errors";
import { RegistryOperations } from "@oma/lifecycle/registry-operations";
import { makeValidAgent } from "./fixtures/spec.js";
import { NON_LOCAL_FILESYSTEMS, assertStateRoot } from "#oma-test/app/runtime/assets";
import { spawnSandboxed } from "@oma/platform-linux/worker-spawn";

const peer = { pid: 1, uid: 1000, gid: 1000 };

test("DR18 / MAIL-001/002: a topic is followed by Residents; the Principal's follow is refused and records nothing", t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-dr18-route-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new Store(join(dir, "runtime.sqlite"));
  t.after(() => store.close());
  store.transaction(tx => { tx.insertAgent(makeValidAgent("principal")); tx.insertAgent(makeValidAgent("worker-a")); });
  const registry = new RegistryOperations(lifecycleLedger(store), { nextOperationId: generateOperationId });
  const principal = { actor: "principal", incarnation: store.getAgent("principal")!.incarnation, role: "principal" as const,
    channel: "host" as const, capabilities: new Set(["route.follow" as const]), peer };
  assert.throws(() => registry.follow(principal, "release", true, "p-follow"),
    (error: unknown) => error instanceof StoreError && error.code === "CAPABILITY_DENIED" && /Residents/.test(error.message));
  assert.equal(store.getOperation("principal", "p-follow"), null, "a refused follow was recorded");
  assert.deepEqual(store.subscribers("release"), []);
  const resident = { actor: "worker-a", incarnation: store.getAgent("worker-a")!.incarnation, role: "resident" as const,
    channel: "actor" as const, capabilities: new Set(["route.follow" as const]), peer };
  assert.equal(registry.follow(resident, "release", true, "r-follow").state, "succeeded");
  assert.deepEqual(store.subscribers("release"), ["worker-a"]);
});

test("DR18 / S-01-CANDIDATE: checks without resource profiles are refused, and the root protects every change", async () => {
  const { protectedPathMatches } = await import("@oma/domain/git-facts");
  const { assertSupportedIntegration, snapshotIntegrationPolicy } = await import("@oma/domain/integration-policy");
  for (const path of ["README.md", "apps/oma/src/a.ts", "deep/er/file", ".github/workflows/ci.yml"])
    assert.equal(protectedPathMatches(path, "/"), true, path);
  assert.equal(protectedPathMatches("apps/oma/src/a.ts", "docs/"), false);
  assert.equal(protectedPathMatches("docs/a.md", "docs/"), true);
  assert.doesNotThrow(() => assertSupportedIntegration(snapshotIntegrationPolicy({ policyRevision: "p", protectedPaths: [],
    checks: [{ id: "test", argv: ["/usr/bin/true"], env: {} }] })));
});

test("DR18 / D-9, DR24: `oma login` hands the terminal to the engine's own login over the Human's one engine home, needing no session", async t => {
  const { chmodSync, existsSync, mkdirSync: mkdir, readdirSync, writeFileSync } = await import("node:fs");
  const { spawnSync } = await import("node:child_process");
  const { tryHoldSociety } = await import("#oma-test/app/runtime/society-lease");
  const { ENGINE_HOME } = await import("@oma/engine/pi-runtime");
  const root = mkdtempSync(join(tmpdir(), "oma-login-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(new URL(".", import.meta.url).pathname, "..", "..");
  const project = join(root, "project");
  mkdir(project);
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: root, XDG_DATA_HOME: join(root, "data"), XDG_RUNTIME_DIR: join(root, "run") };
  const home = join(root, "data", "oma", ENGINE_HOME);
  // The engine the login runs: it reports what it was given and signs the directory.
  const engine = join(root, "fake-pi.sh");
  writeFileSync(engine, "#!/bin/sh\nprintf 'dir=%s\\n' \"$PI_CODING_AGENT_DIR\"\n[ -e /proc/self/fd/4 ] && echo fence-held\nprintf ok > \"$PI_CODING_AGENT_DIR/logged-in\"\nexit 0\n");
  chmodSync(engine, 0o755);
  const login = () => spawnSync(process.execPath, [join(repo, "apps/oma/dist/entry/oma.js"), "login"],
    { cwd: project, env: { ...env, OMA_PI_COMMAND: engine }, encoding: "utf8", timeout: 60_000 });

  const done = login();
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, new RegExp(`dir=${home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "the engine was not given the engine home");
  assert.match(done.stdout, /fence-held/, "the engine did not hold the engine home's lease");
  assert.equal(existsSync(join(home, "logged-in")), true);
  // A login makes no session: no society is left behind by it.
  assert.deepEqual(readdirSync(join(root, "data", "oma")).filter(name => !name.startsWith(".")), []);

  // Two logins do not run at once.
  const held = tryHoldSociety(home);
  assert.ok(held !== null);
  const busy = login();
  assert.notEqual(busy.status, 0);
  assert.match(busy.stderr, /Another oma login is running/);
  held.release();
});

test("DR18 / D-8: every start brings the project's committed branch history into the society's mirror, and nothing else of the project", async t => {
  const { spawnSync } = await import("node:child_process");
  const { mkdirSync: mkdir, writeFileSync } = await import("node:fs");
  const { provisionSociety } = await import("#oma-test/app/runtime/provision");
  const { projectMirrorPathAt } = await import("@oma/domain/paths");
  const root = mkdtempSync(join(tmpdir(), "oma-mirror-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, "project");
  mkdir(project);
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: root, GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "h", GIT_AUTHOR_EMAIL: "h@example.invalid", GIT_COMMITTER_NAME: "h", GIT_COMMITTER_EMAIL: "h@example.invalid" };
  const git = (cwd: string, ...argv: string[]) => {
    const result = spawnSync("git", argv, { cwd, env, encoding: "utf8" });
    assert.equal(result.status, 0, `${argv.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
  git(project, "init", "-q", "-b", "main");
  writeFileSync(join(project, "a.txt"), "a\n"); git(project, "add", "a.txt"); git(project, "commit", "-q", "-m", "first");
  git(project, "checkout", "-q", "-b", "feature");
  writeFileSync(join(project, "b.txt"), "b\n"); git(project, "add", "b.txt"); git(project, "commit", "-q", "-m", "feature work");
  git(project, "checkout", "-q", "main");
  // Uncommitted work of every kind: a stash, and a staged file.
  writeFileSync(join(project, "a.txt"), "stashed\n"); git(project, "stash", "-q");
  const stashed = git(project, "rev-parse", "refs/stash:a.txt");
  writeFileSync(join(project, "staged.txt"), "private staged bytes\n"); git(project, "add", "staged.txt");
  const staged = git(project, "hash-object", "staged.txt");
  // Private objects inside a pack must not leak either. Removing only loose
  // unreachable objects after a local copy would not satisfy this contract.
  git(project, "gc", "--quiet");
  const stateRoot = join(root, "state");
  const report = provisionSociety(stateRoot, { projectDir: project });
  assert.equal(report.mirrorNote, null);
  const mirror = projectMirrorPathAt(stateRoot);
  const refs = git(mirror, "for-each-ref", "--format=%(refname) %(objectname)").split("\n").sort();
  assert.deepEqual(refs, [`refs/heads/feature ${git(project, "rev-parse", "feature")}`, `refs/heads/main ${git(project, "rev-parse", "main")}`]);
  assert.notEqual(spawnSync("git", ["--git-dir", mirror, "cat-file", "-e", staged], { env }).status, 0, "a staged, uncommitted file reached the mirror");
  assert.notEqual(spawnSync("git", ["--git-dir", mirror, "cat-file", "-e", stashed], { env }).status, 0, "private packed stash bytes reached the mirror");
  // A later commit reaches it at the next start; the canonical main does not move.
  const canonical = git(join(stateRoot, "repos", "project.git"), "rev-parse", "refs/heads/main");
  git(project, "commit", "-q", "-m", "later");
  assert.equal(provisionSociety(stateRoot, { projectDir: project }).mirrorNote, null);
  assert.equal(git(mirror, "rev-parse", "refs/heads/main"), git(project, "rev-parse", "main"));
  assert.equal(git(join(stateRoot, "repos", "project.git"), "rev-parse", "refs/heads/main"), canonical, "the canonical main moved (MAC-411)");
  // A project that is not a repository now is a note, not a failed start.
  const elsewhere = join(root, "not-a-repo");
  mkdir(elsewhere);
  assert.match(provisionSociety(stateRoot, { projectDir: elsewhere }).mirrorNote ?? "", /not a Git repository/);
});

test("DR18 / S-06: a state root on a network or user-space file system is refused; a local one is accepted", () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-dr18-fs-"));
  try {
    const root = join(dir, "state", "oma", "a");
    const seen: string[] = [];
    const on = (type: number) => (path: string): { type: number } => { seen.push(path); return { type }; };
    // Named here, not read from the table, so a row dropped from it is caught.
    const refused: [number, string][] = [[0x6969, "NFS"], [0x517b, "SMB"], [0xff534d42, "CIFS"], [0xfe534d42, "SMB2"],
      [0x65735546, "FUSE"], [0x01021997, "9P"], [0x00c36400, "Ceph"]];
    assert.deepEqual(refused.filter(([magic, name]) => NON_LOCAL_FILESYSTEMS[magic] !== name), []);
    for (const [magic, name] of Object.entries(NON_LOCAL_FILESYSTEMS))
      assert.throws(() => assertStateRoot(root, on(Number(magic))),
        (error: unknown) => error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE" && error.message.includes(name), name);
    // ext4, xfs, btrfs, tmpfs: local kernel file systems.
    for (const magic of [0xef53, 0x58465342, 0x9123683e, 0x01021994]) assertStateRoot(root, on(magic));
    // The part of the path that exists is the one read: startup makes the rest.
    assert.ok(seen.every(path => path === dir), `read at ${[...new Set(seen)].join(", ")}`);
    // The real file system under the test's directory is a local one.
    assertStateRoot(root);
    // The layout is still judged first: a symlinked ancestor is refused before any file system is read.
    symlinkSync(dir, join(dir, "link"));
    seen.length = 0;
    assert.throws(() => assertStateRoot(join(dir, "link", "a"), on(0xef53)), /symlink/);
    assert.deepEqual(seen, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("DR18 / D-5: a sandbox is started with its filter exactly when its argv loads one", () => {
  const env = { PATH: "/usr/bin:/bin" };
  // A filter named but not given, or given but not named: refused before anything runs.
  assert.throws(() => spawnSandboxed(["bwrap", "--seccomp", "3", "--", "/bin/true"], env),
    (error: unknown) => error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE");
  assert.throws(() => spawnSandboxed(["bwrap", "--", "/bin/true"], env, new Uint8Array(8)),
    (error: unknown) => error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE");
});
