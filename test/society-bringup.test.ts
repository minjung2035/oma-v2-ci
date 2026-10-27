/** TUI-002: `oma` brings its own society up.
 *
 * The broker refuses to start against a state tree that is not there, and
 * nothing created one. These tests hold the provisioning step to what the
 * broker actually demands — a ledger directory, a canonical repository, and a
 * pinned `main` — and prove it is safe to run on every start.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, fstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:net";
import { provisionSociety, repairSociety } from "#oma-test/app/runtime/provision";
import { hostSystemLayout } from "@oma/platform-linux/resident-rootfs";
import { brokerListening, superviseBroker } from "#oma-test/app/runtime/broker-supervisor";
import { ProcessLock, SOCIETY_OWNED_EXIT } from "@oma/native/process-lock";
import { SOCIETY_FENCE_ENV, SOCIETY_FENCE_FD } from "@oma/process/async";
import { tryHoldSociety } from "#oma-test/app/runtime/society-lease";

const scratch = (): string => mkdtempSync(join(tmpdir(), "oma-bringup-"));
const git = (gitDir: string, argv: readonly string[]): string =>
  execFileSync("/usr/bin/git", ["--git-dir", gitDir, ...argv],
    { encoding: "utf8", env: { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", PATH: "/usr/bin:/bin" } }).trim();

test("T115 provisioning creates exactly what the broker demands at startup", () => {
  const root = scratch();
  try {
    const report = provisionSociety(join(root, "state"));
    const state = join(root, "state");
    assert.equal(report.seeded, true);
    for (const relative of ["repos", "world", "agents", "mail/objects", "mail/inboxes",
      "mail/archive/new", "mail/archive/cur", "mail/archive/tmp",
      "repos/project.git", "repos/context.git"])
      assert.ok(existsSync(join(state, relative)), `${relative} was not created`);

    // The canonical repository has the pinned `main` the broker reads, and it
    // is healthy: the broker runs fsck over it before it will admit anything.
    const projectGit = join(state, "repos", "project.git");
    const head = git(projectGit, ["rev-parse", "refs/heads/main^{commit}"]);
    assert.match(head, /^[0-9a-f]{40}$/);
    git(projectGit, ["fsck", "--strict", "--no-reflogs"]);
    // With no project directory offered, the seed is an empty root.
    assert.equal(git(projectGit, ["ls-tree", "-r", "refs/heads/main"]), "");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T115 provisioning runs on every start without disturbing what exists", () => {
  const root = scratch();
  try {
    const state = join(root, "state");
    provisionSociety(state);
    const projectGit = join(state, "repos", "project.git");
    const first = git(projectGit, ["rev-parse", "refs/heads/main"]);
    // Something the society accumulated between starts.
    writeFileSync(join(state, "mail", "archive", "cur", "kept.eml"), "kept\n");

    const again = provisionSociety(state);
    assert.deepEqual(again.created, [], "a second start recreated something");
    assert.equal(again.seeded, false, "a second start re-seeded the canonical main");
    assert.equal(git(projectGit, ["rev-parse", "refs/heads/main"]), first, "the pinned main moved");
    assert.ok(existsSync(join(state, "mail", "archive", "cur", "kept.eml")), "existing mail was disturbed");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T115 a broker already listening is left alone rather than started twice", async () => {
  const root = scratch();
  try {
    // A listener standing in for a broker another `oma` owns.
    const server = createServer(socket => { socket.destroy(); });
    await new Promise<void>(resolve => { server.listen(join(root, "admin.sock"), () => { resolve(); }); });
    try {
      assert.equal(await brokerListening(root), true);
      const handle = await superviseBroker({
        node: process.execPath, libdir: root, society: "probe",
        stateRoot: root, runRoot: root, configPath: join(root, "config.json"),
      });
      assert.equal(handle.state.kind, "already-running");
      // Stopping must be a no-op: this handle did not start that broker.
      handle.stop();
      assert.equal(await brokerListening(root), true, "a broker we did not start was stopped");
    } finally {
      await new Promise<void>(resolve => { server.close(() => { resolve(); }); });
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T115 an absent broker is reported as absent, not assumed running", async () => {
  const root = scratch();
  try {
    assert.equal(await brokerListening(root), false);
    // A libdir with no broker entry: the spawn happens and the child ends. The
    // product must hear about that rather than show a silent empty dashboard.
    const events: string[] = [];
    const handle = await superviseBroker({
      node: process.execPath, libdir: join(root, "missing"), society: "probe",
      stateRoot: root, runRoot: root, configPath: join(root, "config.json"),
      onEvent: line => { events.push(line); },
    });
    assert.equal(handle.state.kind, "started", "a spawn attempt is still a started process");
    await new Promise<void>(resolve => { setTimeout(resolve, 1500).unref(); });
    handle.stop();
    assert.ok(events.some(line => /Cannot find module|broker ended/.test(line)),
      `the failure was never reported: ${events.join(" | ")}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("DR27 the society starts from the project worktree snapshot, once", () => {
  const root = scratch();
  try {
    const project = join(root, "project");
    const run = (argv: readonly string[]): string =>
      execFileSync("/usr/bin/git", ["-C", project, "-c", "user.name=t", "-c", "user.email=t@t", ...argv],
        { encoding: "utf8", env: { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", PATH: "/usr/bin:/bin" } }).trim();
    execFileSync("/usr/bin/git", ["init", "-q", "-b", "trunk", project]);
    writeFileSync(join(project, "kept.txt"), "committed\n");
    run(["add", "kept.txt"]);
    run(["commit", "-qm", "first"]);
    const head = run(["rev-parse", "HEAD"]);
    // Work in progress travels without committing it into the user's repository.
    writeFileSync(join(project, "kept.txt"), "edited, not committed\n");
    writeFileSync(join(project, "new.txt"), "untracked\n");

    const state = join(root, "state");
    const report = provisionSociety(state, { projectDir: project });
    assert.equal(report.seedSource, "project");
    const projectGit = join(state, "repos", "project.git");
    const snapshot = git(projectGit, ["rev-parse", "refs/heads/main"]);
    assert.notEqual(snapshot, head);
    assert.equal(git(projectGit, ["rev-parse", "refs/heads/main^"]), head);
    assert.equal(git(projectGit, ["show", "refs/heads/main:kept.txt"]), "edited, not committed");
    assert.equal(git(projectGit, ["ls-tree", "--name-only", "refs/heads/main"]), "kept.txt\nnew.txt");
    assert.equal(run(["rev-parse", "HEAD"]), head);

    // After the first start the canonical history is the society's own; a new
    // commit in the directory does not move it.
    run(["add", "kept.txt", "new.txt"]);
    run(["commit", "-qm", "second"]);
    const again = provisionSociety(state, { projectDir: project });
    assert.equal(again.seeded, false);
    assert.equal(git(projectGit, ["rev-parse", "refs/heads/main"]), snapshot);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("UX-09 a seeded history carrying gitlinks provisions anyway and reports the refusal it will face", () => {
  const root = scratch();
  try {
    const work = join(root, "work");
    const run = (cwd: string, argv: readonly string[]): string =>
      execFileSync("/usr/bin/git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...argv],
        { encoding: "utf8", env: { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", PATH: "/usr/bin:/bin" } }).trim();
    execFileSync("/usr/bin/git", ["init", "-q", "-b", "main", work]);
    writeFileSync(join(work, "a.txt"), "a\n");
    run(work, ["add", "a.txt"]); run(work, ["commit", "-qm", "first"]);
    const head = run(work, ["rev-parse", "HEAD"]);
    run(work, ["update-index", "--add", "--cacheinfo", `160000,${head},dep`]);
    run(work, ["commit", "-qm", "gitlink"]);
    const bare = join(root, "bare.git");
    execFileSync("/usr/bin/git", ["clone", "-q", "--bare", work, bare]);
    const state = join(root, "state");
    // Provisioning stays permissive — the society works for sessions — but the
    // start names every path every later integration will refuse.
    const report = provisionSociety(state, { projectDir: bare });
    assert.equal(report.seedSource, "project");
    const projectGit = join(state, "repos", "project.git");
    assert.match(git(projectGit, ["ls-tree", "-r", "refs/heads/main"]), /^160000 commit [0-9a-f]+\tdep$/m,
      "the gitlink rode the seed into canonical history");
    assert.match(report.gitlinkNote ?? "", /submodule gitlinks \(dep\)/);
    assert.match(report.gitlinkNote ?? "", /integration is refused/);
    // The next start says it again — the notice stands until the links go.
    assert.match(provisionSociety(state, { projectDir: bare }).gitlinkNote ?? "", /\(dep\)/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T115 a directory with no commit starts from an empty root and says why", () => {
  const root = scratch();
  try {
    const plain = join(root, "plain");
    execFileSync("/usr/bin/git", ["init", "-q", plain]);
    const report = provisionSociety(join(root, "state"), { projectDir: plain });
    assert.equal(report.seedSource, "empty");
    assert.match(report.seedNote ?? "", /no committed HEAD/);
    const projectGit = join(root, "state", "repos", "project.git");
    assert.equal(git(projectGit, ["ls-tree", "-r", "refs/heads/main"]), "");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T115 provisioning builds the trusted rootfs Residents are confined to", () => {
  const root = scratch();
  try {
    const state = join(root, "state");
    provisionSociety(state);
    const rootfs = join(state, "rootfs");
    // Every mount target the plan binds over exists, so a read-only root works.
    for (const target of ["usr", "proc", "dev", "tmp", "workspace", "home/agent", "opt/oma", "opt/oma-node/node",
      "run/oma/control.sock", "run/oma/inference.sock", "run/oma-view", "run/oma-sessions",
      "mail/archive", "mail/self", "world", "git/project.git"])
      assert.ok(existsSync(join(rootfs, target)), `${target} is missing from the rootfs`);
    // Identity names only the agent; nothing is copied from the host's /etc.
    const passwd = readFileSync(join(rootfs, "etc", "passwd"), "utf8");
    assert.match(passwd, /^agent:x:\d+:\d+:agent:\/home\/agent:\/bin\/sh\n$/);
    // /etc holds the two identity files plus a mount target for each support
    // bind the host actually has (F34/F35/F36: resolv.conf, ssl/certs, &c).
    const allowed = new Set(["passwd", "group",
      ...hostSystemLayout().binds.filter(path => path.startsWith("/etc/")).map(path => path.split("/")[2]!)]);
    assert.deepEqual(readdirSync(join(rootfs, "etc")).filter(name => !allowed.has(name)), []);
    // Rebuilding is harmless.
    provisionSociety(state);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T115 REC-007: a second provisioning leaves the tree it finds byte for byte, inode for inode", () => {
  const root = scratch();
  try {
    const state = join(root, "state");
    provisionSociety(state);
    const rootfs = join(state, "rootfs");
    // Provisioning runs on every `oma` start, before anything knows which
    // process owns the society. A start that loses that race must leave what it
    // found untouched -- and "the same bytes written again" is not untouched:
    // the inode and the timestamps are what a concurrent owner, and a program
    // reading inside the sandbox, actually observe.
    const watched = ["etc/passwd", "etc/group", "opt/oma-node/node", "run/oma/control.sock", "run/oma/inference.sock"]
      .map(name => join(rootfs, name));
    const before = watched.map(path => statSync(path, { bigint: true }));
    provisionSociety(state);
    watched.forEach((path, index) => {
      const after = statSync(path, { bigint: true });
      assert.equal(after.ino, before[index]!.ino, `${path} was replaced`);
      assert.equal(after.mtimeNs, before[index]!.mtimeNs, `${path} was rewritten`);
      assert.equal(after.ctimeNs, before[index]!.ctimeNs, `${path} was touched`);
    });

    // This test used to assert the opposite of the line above it: that a
    // tampered identity file IS corrected by provisioning. Both cannot be
    // true. "A wrong rootfs is worth fixing" and "a process that does not own
    // the society writes nothing into it" are two policies, and provisioning
    // runs before ownership is decided, so it only gets the second one.
    // Correcting is a separate pass with its own authority (`repairSociety`).
    const passwd = join(rootfs, "etc", "passwd");
    const tampered = "agent:x:0:0:tampered:/:/bin/sh\n";
    writeFileSync(passwd, tampered);
    const stamp = statSync(passwd, { bigint: true });
    const report = provisionSociety(state);
    assert.equal(readFileSync(passwd, "utf8"), tampered, "provisioning overwrote state it does not own");
    const untouched = statSync(passwd, { bigint: true });
    assert.equal(untouched.ino, stamp.ino, "the tampered file was replaced");
    assert.equal(untouched.mtimeNs, stamp.mtimeNs, "the tampered file was rewritten");
    assert.equal(untouched.ctimeNs, stamp.ctimeNs, "the tampered file was touched");
    // Silence would be the real defect: leaving it alone is only acceptable
    // because the owner is told exactly what is still wrong.
    assert.deepEqual([...report.pendingRepairs], [passwd]);

    // And a generated file that cannot be read is not "different" -- it is a
    // rootfs entry provisioning cannot account for, so it refuses rather than
    // treating it as something to report or overwrite. Nor is it known to be
    // corrupt (DR13): the refusal says it cannot be observed now.
    if (process.getuid?.() !== 0) {
      chmodSync(passwd, 0o000);
      assert.throws(() => { provisionSociety(state); }, { code: "BROKER_UNAVAILABLE", message: /cannot be observed now/ });
      assert.throws(() => { repairSociety(state); }, { code: "BROKER_UNAVAILABLE", message: /cannot be observed now/ });
      chmodSync(passwd, 0o644);
      assert.equal(readFileSync(passwd, "utf8"), tampered, "a refused pass wrote nothing");
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T115 REC-007: the owner's repair pass is what puts a wrong rootfs back", () => {
  const root = scratch();
  try {
    const state = join(root, "state");
    provisionSociety(state);
    const rootfs = join(state, "rootfs");
    const passwd = join(rootfs, "etc", "passwd");
    const group = join(rootfs, "etc", "group");
    const inbox = join(rootfs, "inbox.md");

    // Nothing to do on a tree that is already right, and saying so costs no
    // write: a repair pass that rewrites correct files is the same defect
    // provisioning was cured of.
    const before = [passwd, group].map(path => statSync(path, { bigint: true }));
    assert.deepEqual([...repairSociety(state)], []);
    [passwd, group].forEach((path, index) => {
      const after = statSync(path, { bigint: true });
      assert.equal(after.ino, before[index]!.ino, `${path} was replaced by a repair with nothing to repair`);
      assert.equal(after.mtimeNs, before[index]!.mtimeNs, `${path} was rewritten by a repair with nothing to repair`);
    });

    // A file whose content is wrong, and a link pointing somewhere else: both
    // are corrected, and both are named.
    writeFileSync(passwd, "agent:x:0:0:tampered:/:/bin/sh\n");
    rmSync(inbox, { force: true });
    symlinkSync("/etc/shadow", inbox);
    const corrected = [...repairSociety(state)].sort();
    assert.deepEqual(corrected, [inbox, passwd].sort());
    assert.match(readFileSync(passwd, "utf8"), /^agent:x:\d+:\d+:agent:/);
    assert.equal(readlinkSync(inbox), "/run/oma-view/inbox.md");
    // And the society is clean afterwards: the next provisioning has nothing
    // left to defer.
    assert.deepEqual([...provisionSociety(state).pendingRepairs], []);
    assert.deepEqual([...repairSociety(state)], []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T115 REC-007: two first starts racing on one state root both survive it", async () => {
  // The rule "the loser adopts what the winner made" was applied to the
  // canonical ref and not to the repository itself: both processes saw no
  // `project.git`, both ran `git init --bare` into that exact path, and the
  // loser got `File exists` or a config-lock collision, which provisioning
  // reported as a corrupt store. Creating a repository is now a build
  // somewhere else followed by a rename, which either wins or finds the
  // winner's repository already in place.
  //
  // This runs two real processes, because the defect only exists between
  // processes: the previous cycle's evidence said in as many words that it had
  // never been observed, and a single-process test cannot observe it.
  const root = scratch();
  try {
    const state = join(root, "state");
    const gate = join(root, "go");
    const script = join(root, "race.mjs");
    const entry = pathToFileURL(join(process.cwd(), "apps/oma/dist/runtime/provision.js")).href;
    writeFileSync(script, `
      import { existsSync } from "node:fs";
      import { provisionSociety } from ${JSON.stringify(entry)};
      // Both processes are released by one file appearing, so they are inside
      // the same few milliseconds rather than merely both started.
      while (!existsSync(${JSON.stringify(gate)})) {}
      try {
        const report = provisionSociety(${JSON.stringify(state)});
        process.stdout.write(JSON.stringify({ ok: true, seeded: report.seeded }));
      } catch (error) {
        process.stdout.write(JSON.stringify({ ok: false, message: String(error && error.message) }));
      }
    `);
    const settled = [0, 1].map(() => {
      const child = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "inherit"] });
      let text = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", chunk => { text += chunk as string; });
      return new Promise<{ code: number; text: string }>(resolve => {
        child.once("exit", code => { resolve({ code: code ?? -1, text }); });
      });
    });
    writeFileSync(gate, "");
    const results = await Promise.all(settled);
    for (const result of results)
      assert.equal(result.code, 0, `a racing start crashed (${result.code}): ${result.text}`);
    const reports = results.map(result => JSON.parse(result.text || "{}") as { ok: boolean; seeded?: boolean; message?: string });
    for (const report of reports)
      assert.equal(report.ok, true, `a racing start failed: ${report.message}`);
    // Exactly one of them seeded the canonical history; the other adopted it.
    assert.equal(reports.filter(report => report.seeded === true).length, 1,
      `the canonical main was seeded by ${reports.filter(r => r.seeded === true).length} of 2: ${JSON.stringify(reports)}`);
    // One repository, healthy, with one `main` -- and nothing half-built left
    // in the society's state tree.
    const projectGit = join(state, "repos", "project.git");
    git(projectGit, ["fsck", "--strict", "--no-reflogs"]);
    assert.match(git(projectGit, ["rev-parse", "refs/heads/main^{commit}"]), /^[0-9a-f]{40}$/);
    assert.deepEqual(readdirSync(join(state, "repos")).filter(name => name.includes(".staging.")), [],
      "a half-built repository was left in the society's state tree");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

/** Writes a stand-in broker at `<root>/lib/apps/oma/dist/entry/broker.js`. It speaks
 * the real supervision channel on descriptor 3 through the real codec, and its
 * behaviour is chosen by `script`, which runs with `channel` (a Socket),
 * `send(message)`, `reader(onMessage)` and `runs` (how many times this broker
 * has been started, counted in a file) in scope. */
function standInBroker(root: string, script: string): string {
  const libdir = join(root, "lib");
  const entry = join(libdir, "apps", "oma", "dist", "entry");
  mkdirSync(entry, { recursive: true });
  const codec = pathToFileURL(join(process.cwd(), "packages/protocol/dist/host-channel.js")).href;
  writeFileSync(join(entry, "broker.js"), `
    import { Socket } from "node:net";
    import { appendFileSync, readFileSync } from "node:fs";
    import { HostChannelReader, encodeHostMessage } from ${JSON.stringify(codec)};
    const counter = ${JSON.stringify(join(root, "runs"))};
    appendFileSync(counter, "x");
    const runs = readFileSync(counter, "utf8").length;
    const channel = new Socket({ fd: 3, readable: true, writable: true });
    const send = message => channel.write(encodeHostMessage(message));
    const reader = onMessage => { const r = new HostChannelReader(onMessage, () => process.exit(9)); channel.on("data", chunk => r.push(chunk)); };
    channel.on("close", () => process.exit(0));
    ${script}
  `);
  return libdir;
}

function supervise(root: string, libdir: string, extra: Record<string, unknown> = {}) {
  const events: string[] = [];
  return {
    events,
    handle: superviseBroker({
      node: process.execPath, libdir, society: "probe", stateRoot: root, runRoot: root,
      configPath: join(root, "config.json"), onEvent: line => { events.push(line); }, ...extra,
    }),
  };
}

const readyOnce = (handle: { onReady(listener: () => void): void }): Promise<number> =>
  new Promise(resolve => { const started = Date.now(); handle.onReady(() => resolve(Date.now() - started)); });

test("T115 readiness is the broker saying its endpoints listen, not a pid appearing", async () => {
  const root = scratch();
  try {
    // The real broker recovers and bootstraps before it listens; a host that
    // treated the spawn as readiness would register an engine with nothing.
    const libdir = standInBroker(root, "setTimeout(() => send({ kind: 'ready' }), 300); setInterval(() => {}, 1000);");
    const { handle } = supervise(root, libdir);
    const broker = await handle;
    try {
      assert.equal(broker.state.kind, "started");
      // Before it says so, a registration has nobody to ask.
      assert.equal(await broker.register("a".repeat(32), process.pid), null);
      const waited = await readyOnce(broker);
      assert.ok(waited >= 200, `readiness was reported after ${waited}ms, before the broker said so`);
    } finally { broker.stop(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T115 a registration returns the credential the broker minted for that engine", async () => {
  const root = scratch();
  try {
    const libdir = standInBroker(root, `
      send({ kind: "ready" });
      reader(message => {
        if (message.kind !== "session") process.exit(8);
        send({ kind: "credential", credential: "c".repeat(64), sessionHandle: message.sessionHandle });
      });
      setInterval(() => {}, 1000);`);
    const broker = await supervise(root, libdir).handle;
    try {
      await readyOnce(broker);
      assert.equal(await broker.register("d".repeat(32), 4242), "c".repeat(64));
    } finally { broker.stop(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T115 a refused registration is answered at once, not left to time out", async () => {
  const root = scratch();
  try {
    const libdir = standInBroker(root, `
      send({ kind: "ready" });
      reader(message => send({ kind: "refused", sessionHandle: message.sessionHandle }));
      setInterval(() => {}, 1000);`);
    const { handle, events } = supervise(root, libdir, { registerTimeoutMs: 20_000 });
    const broker = await handle;
    try {
      await readyOnce(broker);
      const started = Date.now();
      assert.equal(await broker.register("d".repeat(32), 4242), null);
      assert.ok(Date.now() - started < 5000, "a refusal waited for the timeout");
      assert.ok(events.some(line => /refused/.test(line)));
    } finally { broker.stop(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T115 an answer that names another session does not settle the registration waiting", async () => {
  const root = scratch();
  try {
    // A broker that answers with a handle nobody asked about. This is what a
    // late answer looks like: the engine it was minted for is gone, another
    // has registered, and the reply arrives afterwards. Taken as the answer to
    // whatever happens to be pending, it hands one engine's session to
    // another.
    const libdir = standInBroker(root, `
      send({ kind: "ready" });
      reader(() => send({ kind: "credential", credential: "c".repeat(64), sessionHandle: "f".repeat(32) }));
      setInterval(() => {}, 1000);`);
    const { handle, events } = supervise(root, libdir, { registerTimeoutMs: 700 });
    const broker = await handle;
    try {
      await readyOnce(broker);
      // Removing the correlation in `Generation.pending` makes this return the
      // credential meant for a session this process never registered.
      assert.equal(await broker.register("d".repeat(32), 4242), null,
        "a credential minted for another session was taken as this one's");
      assert.ok(events.some(line => /not waiting for/.test(line)), events.join(" | "));
    } finally { broker.stop(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T115 a refusal that names another session does not refuse the registration waiting", async () => {
  const root = scratch();
  try {
    const libdir = standInBroker(root, `
      send({ kind: "ready" });
      reader(message => {
        // The refusal of an earlier session arrives first, then the answer to
        // this one. Only the second may settle it.
        send({ kind: "refused", sessionHandle: "f".repeat(32) });
        setTimeout(() => send({ kind: "credential", credential: "e".repeat(64), sessionHandle: message.sessionHandle }), 100);
      });
      setInterval(() => {}, 1000);`);
    const { handle, events } = supervise(root, libdir, { registerTimeoutMs: 5000 });
    const broker = await handle;
    try {
      await readyOnce(broker);
      assert.equal(await broker.register("d".repeat(32), 4242), "e".repeat(64),
        "a refusal for another session was applied to this registration");
      assert.ok(events.some(line => /not waiting for/.test(line)), events.join(" | "));
    } finally { broker.stop(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T115 a broker that says the society already has an owner disowns the host, and is not restarted", async () => {
  const root = scratch();
  try {
    // Exactly what `apps/oma/src/entry/broker.ts` does when it loses the race for the
    // society lock. A restart would only lose it again, and in the meantime
    // this process must not behave as an owner.
    const libdir = standInBroker(root, `process.exit(${SOCIETY_OWNED_EXIT});`);
    const { handle, events } = supervise(root, libdir);
    const broker = await handle;
    try {
      // The spawn still reports a pid: what it does not report is ownership.
      assert.equal(broker.state.kind, "started");
      const reason = await new Promise<string>(resolve => { broker.onDisowned(resolve); });
      assert.match(reason, /took this society/);
      let ready = false;
      broker.onReady(() => { ready = true; });
      // A listener added after the fact still hears it: ownership is not an
      // event a late listener can miss.
      const late = await new Promise<string>(resolve => { broker.onDisowned(resolve); });
      assert.equal(late, reason);
      await new Promise(resolve => setTimeout(resolve, 1500));
      assert.equal(readFileSync(join(root, "runs"), "utf8").length, 1, "a disowned broker was restarted");
      assert.equal(ready, false, "a disowned broker was reported ready");
      assert.equal(await broker.register("d".repeat(32), 4242), null);
      assert.ok(!events.some(line => /restarted/.test(line)), events.join(" | "));
    } finally { broker.stop(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T115 a broker that only fails to start is restarted, not disowned", async () => {
  const root = scratch();
  try {
    // The negative control for the status above: any other ending is a broker
    // that fell over, which is restartable. Reading the two as the same thing
    // in either direction is the defect.
    const libdir = standInBroker(root, "process.exit(1);");
    const { handle } = supervise(root, libdir, { maxRestarts: 1, restartWindowMs: 60_000 });
    const broker = await handle;
    try {
      let disowned: string | null = null;
      broker.onDisowned(reason => { disowned = reason; });
      // Counted from the file the stand-in appends to; it does not exist until
      // the first child has run.
      const runs = (): number => existsSync(join(root, "runs")) ? readFileSync(join(root, "runs"), "utf8").length : 0;
      const deadline = Date.now() + 5000;
      while (runs() < 2 && Date.now() < deadline)
        await new Promise(resolve => setTimeout(resolve, 50));
      assert.ok(runs() >= 2, "a broker that fell over was not restarted");
      // It is disowned only once the restarts run out, and for that reason.
      while (disowned === null && Date.now() < deadline)
        await new Promise(resolve => setTimeout(resolve, 50));
      assert.match(String(disowned), /could not stay running/);
    } finally { broker.stop(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T119/REC-007 the broker the product starts is handed the society lease and told which descriptor it is on", async () => {
  // Without the telling, the broker cannot know its host owns the society, so
  // it would ask for the lease itself -- and be refused by the very host that
  // started it. The descriptor and the declaration are one fact, and this is
  // the product's own supervisor handing both to a real child.
  const root = scratch();
  const stateRoot = join(root, "state");
  const lease = tryHoldSociety(stateRoot);
  assert.ok(lease, "the test could not take the society lease it needs to hold");
  const held = statSync(root) && fstatSync(lease.fence, { bigint: true });
  try {
    const entry = join(root, "lib", "apps", "oma", "dist", "entry");
    mkdirSync(entry, { recursive: true });
    const report = join(root, "broker-env.json");
    // A stand-in only for the broker's body; the descriptor it is handed and
    // the environment it is handed are the product's, not the test's.
    writeFileSync(join(entry, "broker.js"), [
      'const { fstatSync, writeFileSync, renameSync } = require("node:fs");',
      'let fence = "none";',
      `try { const s = fstatSync(${SOCIETY_FENCE_FD}, { bigint: true }); fence = s.dev + ":" + s.ino; }`,
      ' catch (error) { fence = "none:" + error.code; }',
      `const body = JSON.stringify({ declared: process.env.${SOCIETY_FENCE_ENV} ?? null, fence, argv: process.argv.slice(2) });`,
      `writeFileSync(${JSON.stringify(report)} + ".tmp", body);`,
      `renameSync(${JSON.stringify(report)} + ".tmp", ${JSON.stringify(report)});`,
    ].join("\n"));
    const handle = await superviseBroker({
      node: process.execPath, libdir: join(root, "lib"), society: "probe",
      stateRoot: root, runRoot: root, configPath: join(root, "config.json"), fence: lease.fence,
    });
    try {
      const deadline = Date.now() + 20_000;
      while (!existsSync(report)) {
        if (Date.now() >= deadline) throw new Error("the broker the supervisor started never reported");
        await new Promise<void>(resolve => { setTimeout(resolve, 20).unref(); });
      }
      const answer = JSON.parse(readFileSync(report, "utf8")) as { declared: string | null; fence: string; argv: string[] };
      // D03: the broker is handed the host's whole launch location, so it and
      // every unit it renders use exactly these, not ones re-derived from env.
      assert.deepEqual(answer.argv, ["--society", "probe", "--config", join(root, "config.json"),
        "--state-root", root, "--run-root", root]);
      assert.equal(answer.declared, String(SOCIETY_FENCE_FD),
        "the broker was handed the lease without being told which descriptor it is on");
      assert.equal(answer.fence, `${held.dev}:${held.ino}`,
        `descriptor ${SOCIETY_FENCE_FD} in the broker was not this society's lease`);
    } finally { handle.stop(); }
  } finally {
    lease.release();
    rmSync(root, { recursive: true, force: true });
  }
});

test("T119/REC-007 a broker started outside the product answers to the society lease, and one started by it does not take it twice", () => {
  // The other half of the audit's third finding. The host now asks whether a
  // broker is already listening before it writes anything, but that question
  // and the writes that follow it are two steps: a broker started between them
  // would still come up underneath an `oma` that was already provisioning. So
  // the broker answers the same question from its own side.
  //
  // The production entry, on the production path, with a real lease held by
  // this test standing in for the `oma` that holds it.
  const root = scratch();
  const society = `lease${Date.now().toString(36)}`;
  const stateRoot = join(root, "data", "oma", society);
  const lease = tryHoldSociety(stateRoot);
  assert.ok(lease, "the test could not take the society lease it needs to hold");
  const run = (fenced: boolean): { status: number | null; stderr: string } => {
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      XDG_RUNTIME_DIR: join(root, "run"), XDG_DATA_HOME: join(root, "data"), NOTIFY_SOCKET: "",
    };
    if (fenced) env[SOCIETY_FENCE_ENV] = String(SOCIETY_FENCE_FD);
    const stdio: ("ignore" | "pipe" | number)[] = ["ignore", "pipe", "pipe"];
    if (fenced) { stdio.push("ignore"); stdio.push(lease.fence); }
    const result = spawnSync(process.execPath,
      [join(process.cwd(), "apps", "oma", "dist", "entry", "broker.js"), "--society", society],
      { env, stdio, encoding: "utf8", timeout: 20_000 });
    return { status: result.status, stderr: result.stderr ?? "" };
  };
  try {
    // A broker nobody handed the lease to takes it, and cannot.
    const outside = run(false);
    assert.equal(outside.status, SOCIETY_OWNED_EXIT, outside.stderr);
    assert.match(outside.stderr, /already owns this society/);
    // It got no further than ownership: the society an `oma` owns is untouched.
    assert.equal(existsSync(join(stateRoot, "runtime.sqlite")), false);
    assert.doesNotMatch(outside.stderr, /startup failed/);

    // The lease is still this test's -- refusing did not take it, and did not
    // release it either.
    assert.equal(tryHoldSociety(stateRoot), null, "the refused broker disturbed the society lease");

    // The product's own broker is handed that same lease and must not ask for
    // it again: the name is already held, by the very description it holds.
    // Getting past ownership to its own startup failure is what proves it.
    const ours = run(true);
    assert.notEqual(ours.status, SOCIETY_OWNED_EXIT,
      `a broker holding its host's lease reported the society as owned: ${ours.stderr}`);
    assert.match(ours.stderr, /startup failed/);

    // The control: with no lease held at all, the unfenced entry gets past
    // ownership too. Without this, the refusal above would pass for a build
    // that refuses every broker.
    lease.release();
    const free = run(false);
    assert.notEqual(free.status, SOCIETY_OWNED_EXIT,
      `a broker refused a society nobody owned: ${free.stderr}`);
    assert.match(free.stderr, /startup failed/);
  } finally {
    lease.release();
    rmSync(root, { recursive: true, force: true });
  }
});

test("T115 the real broker entry refuses to be the second owner of a society, and says which it is", async () => {
  // Not a stand-in: the production entry, on the production path. The lock is
  // taken here first, exactly as a broker another `oma` started would hold it.
  const root = scratch();
  const society = `own${Date.now().toString(36)}`;
  const runRoot = join(root, "run", "oma", society);
  mkdirSync(runRoot, { recursive: true });
  const held = ProcessLock.tryAcquire(join(runRoot, "broker.lock"));
  assert.ok(held, "the test could not take the society lock it needs to hold");
  const run = (): { status: number | null; stderr: string } => {
    const result = spawnSync(process.execPath,
      [join(process.cwd(), "apps", "oma", "dist", "entry", "broker.js"), "--society", society],
      { env: { ...process.env, XDG_RUNTIME_DIR: join(root, "run"), XDG_DATA_HOME: join(root, "data"), NOTIFY_SOCKET: "" },
        encoding: "utf8", timeout: 20_000 });
    return { status: result.status, stderr: result.stderr ?? "" };
  };
  try {
    const second = run();
    assert.equal(second.status, SOCIETY_OWNED_EXIT, second.stderr);
    assert.match(second.stderr, /already owns this society/);
    // It got no further: ownership is decided before configuration, SQLite or
    // recovery, so a second `oma` cannot touch the first's state at all.
    assert.equal(existsSync(join(root, "data", "oma", society, "runtime.sqlite")), false);
    assert.doesNotMatch(second.stderr, /startup failed/);
    // The lock is still this test's.
    held.assertHeld(join(runRoot, "broker.lock"));

    // The control: with the lock free, the same entry gets past it and fails
    // for its own reasons with its own status. "Someone else owns this" and "I
    // could not start" must not be the same answer.
    held.close();
    const alone = run();
    assert.notEqual(alone.status, SOCIETY_OWNED_EXIT,
      "a broker that could take the lock still reported the society as owned");
    assert.match(alone.stderr, /startup failed/);
  } finally {
    held.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("T115 a broker that never answers a registration yields an absence within the bound", async () => {
  const root = scratch();
  try {
    const libdir = standInBroker(root, "send({ kind: 'ready' }); setInterval(() => {}, 1000);");
    const broker = await supervise(root, libdir, { registerTimeoutMs: 300 }).handle;
    try {
      await readyOnce(broker);
      assert.equal(await broker.register("d".repeat(32), 4242), null);
    } finally { broker.stop(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T115 a broker this host did not start gives it no readiness and no credential", async () => {
  const root = scratch();
  try {
    const server = createServer(socket => { socket.destroy(); });
    await new Promise<void>(resolve => { server.listen(join(root, "admin.sock"), () => { resolve(); }); });
    try {
      const broker = await supervise(root, root).handle;
      assert.equal(broker.state.kind, "already-running");
      let ready = false;
      broker.onReady(() => { ready = true; });
      assert.equal(await broker.register("d".repeat(32), 4242), null);
      assert.equal(ready, false);
    } finally {
      await new Promise<void>(resolve => { server.close(() => { resolve(); }); });
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T115 a broker that ends unexpectedly is restarted, and the engine is registered with the new one", async () => {
  const root = scratch();
  try {
    // The first broker dies a moment after it is ready; the second one stays.
    // Each mints its own credential, so the host can tell them apart.
    const libdir = standInBroker(root, `
      send({ kind: "ready" });
      reader(message => send({ kind: "credential", credential: String(runs).repeat(64).slice(0, 64), sessionHandle: message.sessionHandle }));
      if (runs === 1) setTimeout(() => process.exit(1), 200);
      setInterval(() => {}, 1000);`);
    const { handle, events } = supervise(root, libdir);
    const broker = await handle;
    try {
      const credentials: (string | null)[] = [];
      const second = new Promise<void>(resolve => {
        let seen = 0;
        broker.onReady(() => {
          seen += 1;
          void broker.register("d".repeat(32), 4242).then(credential => {
            credentials.push(credential);
            if (seen === 2) resolve();
          });
        });
      });
      await second;
      assert.deepEqual(credentials, ["1".repeat(64), "2".repeat(64)]);
      assert.ok(events.some(line => /restarted/.test(line)), events.join(" | "));
    } finally { broker.stop(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T115 a broker that cannot stay up is reported and not restarted forever", async () => {
  const root = scratch();
  try {
    const libdir = standInBroker(root, "process.exit(1);");
    const { handle, events } = supervise(root, libdir, { maxRestarts: 2, restartWindowMs: 60_000 });
    const broker = await handle;
    try {
      const deadline = Date.now() + 10_000;
      while (!events.some(line => /not restarting/.test(line)) && Date.now() < deadline)
        await new Promise(resolve => setTimeout(resolve, 50));
      assert.ok(events.some(line => /not restarting/.test(line)), events.join(" | "));
      const runs = readFileSync(join(root, "runs"), "utf8").length;
      await new Promise(resolve => setTimeout(resolve, 1500));
      // The first start and two restarts, and then nothing more.
      assert.equal(runs, 3);
      assert.equal(readFileSync(join(root, "runs"), "utf8").length, 3);
    } finally { broker.stop(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T115 stopping the supervisor stops its broker and does not restart it", async () => {
  const root = scratch();
  try {
    const libdir = standInBroker(root, "send({ kind: 'ready' }); process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);");
    const { handle, events } = supervise(root, libdir);
    const broker = await handle;
    await readyOnce(broker);
    broker.stop();
    await new Promise(resolve => setTimeout(resolve, 1500));
    assert.equal(readFileSync(join(root, "runs"), "utf8").length, 1);
    assert.ok(!events.some(line => /restarted/.test(line)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T115 the audit's orphan -- a host killed outright takes its broker with it", async () => {
  const root = scratch();
  // The broker side runs only the real supervision channel -- no other handle on
  // descriptor 3 that could end the process for a different reason and make
  // this pass without proving anything. Its exit reason is recorded, so the
  // test can tell "the host went away" from any other ending.
  const libdir = join(root, "lib");
  const entry = join(libdir, "apps", "oma", "dist", "entry");
  mkdirSync(entry, { recursive: true });
  const supervision = pathToFileURL(join(process.cwd(), "apps/oma/dist/runtime/supervision-channel.js")).href;
  const reasonFile = join(root, "exit-reason");
  writeFileSync(join(entry, "broker.js"), `
    import { writeFileSync } from "node:fs";
    const { openSupervisionChannel } = await import(${JSON.stringify(supervision)});
    const host = openSupervisionChannel({ fd: 3, onHostGone: reason => {
      writeFileSync(${JSON.stringify(reasonFile)}, reason);
      process.exit(0);
    } });
    if (!host) { writeFileSync(${JSON.stringify(reasonFile)}, "no channel"); process.exit(7); }
    host.ready();
    setInterval(() => {}, 1000);
  `);
  // The host is a real separate process running the real supervisor, so it can
  // be killed with SIGKILL -- no handler, no cleanup, exactly the case a crash
  // handler cannot cover.
  const supervisor = pathToFileURL(join(process.cwd(), "apps/oma/dist/runtime/broker-supervisor.js")).href;
  const host = spawn(process.execPath, ["--input-type=module", "-e", `
    const { superviseBroker } = await import(${JSON.stringify(supervisor)});
    const broker = await superviseBroker({ node: process.execPath, libdir: ${JSON.stringify(libdir)}, society: "probe",
      stateRoot: ${JSON.stringify(root)}, runRoot: ${JSON.stringify(root)}, configPath: ${JSON.stringify(join(root, "config.json"))}, maxRestarts: 0 });
    broker.onReady(() => process.stdout.write(String(broker.state.pid) + "\\n"));
    setInterval(() => {}, 1000);
  `], { stdio: ["ignore", "pipe", "inherit"] });
  const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
  let brokerPid = 0;
  try {
    brokerPid = await new Promise<number>((resolve, reject) => {
      let out = "";
      const timer = setTimeout(() => reject(new Error("the broker never became ready")), 10_000);
      host.stdout!.on("data", chunk => {
        out += String(chunk);
        if (out.includes("\n")) { clearTimeout(timer); resolve(Number(out.trim())); }
      });
      host.once("exit", () => { clearTimeout(timer); reject(new Error("the host ended before its broker was ready")); });
    });
    // Alive, and still alive a moment later: the broker is not ending on its own.
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.ok(alive(brokerPid), "the broker ended before its host did");
    assert.equal(existsSync(reasonFile), false, "the broker recorded an ending before its host died");

    host.kill("SIGKILL");
    const deadline = Date.now() + 5000;
    while (alive(brokerPid) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(alive(brokerPid), false, "the broker outlived the host that was killed");
    // And it ended because the host went away, not for some other reason.
    assert.match(readFileSync(reasonFile, "utf8"), /host/);
  } finally {
    if (host.exitCode === null && host.signalCode === null) host.kill("SIGKILL");
    if (brokerPid > 0 && alive(brokerPid)) process.kill(brokerPid, "SIGKILL");
    rmSync(root, { recursive: true, force: true });
  }
});
