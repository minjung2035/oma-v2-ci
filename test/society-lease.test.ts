/** TUI-004/REC-007: which `oma` owns a society, and for exactly how long.
 *
 * Ownership used to be read off the broker: the child took the society lock,
 * said it was ready, and the host treated that as owning the society. That
 * answer is only true while the child is alive, and the child is restarted --
 * so every back-off window, and the whole period after restarts run out, was a
 * gap in ownership with the engine started for it still running. These tests
 * hold the replacement to the properties the gap violated: one holder at a
 * time, held across anything the broker does, and released exactly when the
 * process that took it is finished with it.
 *
 * "Finished with it" is the hard half, and it is not a call order. A host can
 * be SIGKILLed, in which case it runs no teardown at all; the kernel drops its
 * lock at once while the engine it started keeps running. The lease is
 * therefore inherited by everything the host starts, so the lock -- which
 * belongs to the open file description, not to a process -- is released only
 * when the last of them closes. The tests at the end of this file are about
 * that property and nothing else, because it is the only one that holds on the
 * paths where none of this code runs.
 *
 * The name the lock is taken under is the other half, and it used to be a
 * pathname. A flock names its lock by an inode; a caller names the inode by a
 * path; and any process of the same user can unlink that path and put a new
 * file there, after which the old holder still holds the old inode and a new
 * `oma` takes the new one -- two owners of one society, neither able to see
 * the other. Re-checking the path after acquiring only narrows the window,
 * because the check and the use remain two steps. So the lease is taken in the
 * abstract AF_UNIX namespace, where there is no directory entry to replace,
 * and the tests below assert the consequence directly: no file anywhere is the
 * lease, and removing every file this society has does not free it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, fstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Readable } from "node:stream";
import { CHANNEL_FD, SOCIETY_FENCE_ENV, SOCIETY_FENCE_FD, spawnOwnedRpc, spawnSupervisedService } from "@oma/process/async";
import { societyLeaseName, tryHoldSociety } from "#oma-test/app/runtime/society-lease";
import { runCliProcess, type CliResult } from "./fixtures/cli-child.js";

const scratch = (): string => mkdtempSync(join(tmpdir(), "oma-lease-"));

/** A second real process that takes the lease, says so, and then waits to be
 * told to let go. Ownership between processes is the only thing the lease is
 * for, so nothing here stands in for the other process. */
function otherProcess(stateRoot: string, scriptRoot: string): {
  /** True when it took the society, false when it was told someone else has
   * it. Both are answers: the whole point of the lease is that the second
   * process is refused rather than failing, so a harness that can only hear
   * "yes" cannot tell a refusal from a hang. */
  readonly took: Promise<boolean>;
  readonly release: () => Promise<void>;
  readonly kill: () => void;
} {
  const script = join(scriptRoot, "holder.mjs");
  const entry = pathToFileURL(join(process.cwd(), "apps/oma/dist/runtime/society-lease.js")).href;
  writeFileSync(script, [
    `import { tryHoldSociety } from ${JSON.stringify(entry)};`,
    `const lease = tryHoldSociety(${JSON.stringify(stateRoot)});`,
    'process.stdout.write(lease === null ? "no\\n" : "yes\\n");',
    "if (lease === null) process.exit(0);",
    // Holds it until told: a lease released by exiting and a lease released on
    // purpose are different events, and both are tested.
    'process.stdin.on("data", () => { lease.release(); process.stdout.write("released\\n"); });',
    "setInterval(() => {}, 60000);",
  ].join("\n"));
  const child = spawn(process.execPath, [script], { stdio: ["pipe", "pipe", "inherit"] });
  child.stdout.setEncoding("utf8");
  let buffered = "";
  const waiters: { match: string; resolve: () => void }[] = [];
  child.stdout.on("data", (chunk: string) => {
    buffered += chunk;
    for (const waiter of [...waiters])
      if (buffered.includes(waiter.match)) { waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(); }
  });
  const until = (match: string): Promise<void> => new Promise((resolve, reject) => {
    if (buffered.includes(match)) { resolve(); return; }
    const timer = setTimeout(() => { reject(new Error(`the other process said neither yes nor no: ${JSON.stringify(buffered)}`)); }, 20000);
    timer.unref();
    waiters.push({ match, resolve: () => { clearTimeout(timer); resolve(); } });
  });
  return {
    took: Promise.race([until("yes\n").then(() => true), until("no\n").then(() => false)]),
    release: async () => { child.stdin.write("go\n"); await until("released\n"); },
    kill: () => { child.kill("SIGKILL"); },
  };
}

test("T119 the lease is one process's at a time", async () => {
  const root = scratch();
  try {
    const stateRoot = join(root, "state");
    const other = otherProcess(stateRoot, root);
    try {
      assert.equal(await other.took, true, "the first process could not take a free society");
      // The second answer is null, not an exception: "someone else owns this"
      // is an ordinary outcome the product shows a Control Panel for.
      assert.equal(tryHoldSociety(stateRoot), null, "two processes held one society at once");
      await other.release();
      const mine = tryHoldSociety(stateRoot);
      assert.ok(mine, "a released society could not be taken");
      assert.equal(mine.name, societyLeaseName(stateRoot));
      // And it is exclusive again from here.
      const third = otherProcess(stateRoot, root);
      try { assert.equal(await third.took, false, "a held society was taken a second time"); }
      finally { third.kill(); }
      mine.release();
    } finally { other.kill(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T119 a process that dies gives the society back", async () => {
  // The product's own failure mode: an `oma` killed outright, or a machine
  // that lost power. Nothing runs to release anything, so the kernel must be
  // what releases it -- which is why this is a lock on an open descriptor and
  // not a pid written into a file.
  const root = scratch();
  try {
    const stateRoot = join(root, "state");
    const other = otherProcess(stateRoot, root);
    assert.equal(await other.took, true);
    assert.equal(tryHoldSociety(stateRoot), null);
    other.kill();
    // The descriptor closes when the process is reaped, which is not instant.
    const deadline = Date.now() + 20000;
    let mine = tryHoldSociety(stateRoot);
    while (mine === null && Date.now() < deadline) {
      await new Promise<void>(resolve => { setTimeout(resolve, 20).unref(); });
      mine = tryHoldSociety(stateRoot);
    }
    assert.ok(mine, "a society whose owner was killed stayed locked");
    mine.release();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T119 releasing is idempotent, and releasing twice does not give away someone else's society", async () => {
  const root = scratch();
  try {
    const stateRoot = join(root, "state");
    const mine = tryHoldSociety(stateRoot);
    assert.ok(mine);
    mine.release();
    // A second release must not close a descriptor this lease no longer owns:
    // by now the number could be any file this process has opened since --
    // including, as here, another society's lease.
    const second = join(root, "other-state");
    const theirs = tryHoldSociety(second);
    assert.ok(theirs);
    mine.release();
    mine.release();
    assert.equal(tryHoldSociety(second), null, "releasing a released lease gave away another society");
    theirs.release();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T119 a state root that cannot be trusted is refused before the society is taken, not reported as someone else's", () => {
  // The distinction the whole design rests on: a null answer means another
  // process owns the society and this one shows a Control Panel. A state root
  // that cannot be trusted is not that answer, and returning null for it would
  // make this process quietly give up a society nobody owns.
  //
  // It is also why the check is here rather than in the entrypoint. The lease
  // name is derived from this path, so an `oma` pointed at a tampered one
  // would take a name nobody else takes and hold it as proof of owning a
  // society it is not writing (VAL-002, FS-005).
  const root = scratch();
  try {
    const real = join(root, "real");
    mkdirSync(real, { recursive: true });
    symlinkSync(real, join(root, "link"));
    assert.throws(() => tryHoldSociety(join(root, "link", "society")), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(String(error.message), /symlink|directory/);
      return true;
    }, "a state root under a symlinked ancestor was read as an ordinary society");

    const blocked = join(root, "file");
    writeFileSync(blocked, "");
    assert.throws(() => tryHoldSociety(join(blocked, "society")),
      "a state root under a plain file was read as an ordinary society");
    assert.throws(() => tryHoldSociety("relative/society"),
      "a relative state root was accepted");
    assert.throws(() => tryHoldSociety(`${root}/society/../society`),
      "a denormalized state root was accepted");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T119/FS-005 taking the society writes nothing, and nothing on the filesystem is the lease", () => {
  // Two claims, and the second is the one the previous design could not make.
  //
  // A lease named by a pathname is only as exclusive as that pathname. Any
  // process of this user can unlink it and create a new file in its place: the
  // holder keeps the old inode's lock and the newcomer takes the new inode's,
  // and one society has two owners that cannot see each other. There is no
  // file to do that to here, so the test is allowed to be brutal -- delete
  // everything this society has, and ask whether the society came free.
  //
  // The first claim matters for a different reason: an `oma` that does not own
  // the society must not have written anything to find that out, and taking
  // the lease used to create the directory it was taken in before ownership
  // existed at all.
  const root = scratch();
  try {
    const stateRoot = join(root, "state", "oma", "demo");
    const mine = tryHoldSociety(stateRoot);
    assert.ok(mine);
    assert.equal(existsSync(stateRoot), false, "taking the society created a directory");
    assert.deepEqual(readdirSync(root), [], "taking the society wrote something");
    assert.match(mine.name, /^\0oma\.society\.[0-9a-f]{64}$/);

    mkdirSync(stateRoot, { recursive: true });
    writeFileSync(join(stateRoot, "config.json"), "{}");
    rmSync(join(root, "state"), { recursive: true, force: true });
    assert.equal(tryHoldSociety(stateRoot), null,
      "deleting the society's files handed the society to a second owner");
    mine.release();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T119/REC-007 the lease is the state tree's, so one state tree is one society however it is reached", () => {
  // The lease used to be named after the run root, which meant one
  // XDG_DATA_HOME reached from two XDG_RUNTIME_DIRs -- two terminals, a
  // systemd session and a login shell -- was two leases over one private
  // workspace and one session history. The state tree is the thing that must
  // not have two writers, so it is the thing the lease is named after.
  const root = scratch();
  try {
    const stateRoot = join(root, "state", "oma", "demo");
    const other = join(root, "state", "oma", "elsewhere");
    assert.equal(societyLeaseName(stateRoot), societyLeaseName(stateRoot));
    assert.notEqual(societyLeaseName(stateRoot), societyLeaseName(other));
    const mine = tryHoldSociety(stateRoot);
    assert.ok(mine);
    assert.equal(tryHoldSociety(stateRoot), null, "one state tree was leased twice");
    const elsewhere = tryHoldSociety(other);
    assert.ok(elsewhere, "a different society could not be taken alongside this one");
    elsewhere.release();
    mine.release();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

/** A host that takes the society, starts one child, and then waits to be
 * killed. `fenced` decides the one thing under test: whether the child is
 * handed the lease's descriptor.
 *
 * Nothing here stands in for a process. The claim is about what the kernel
 * does with an open file description across a process that dies without
 * running any code, and only real processes can be held to it. */
function killableHost(stateRoot: string, scriptRoot: string, fenced: boolean): {
  readonly childPid: Promise<number>;
  readonly kill: () => Promise<void>;
} {
  const script = join(scriptRoot, `host-${fenced ? "fenced" : "bare"}.mjs`);
  const entry = pathToFileURL(join(process.cwd(), "apps/oma/dist/runtime/society-lease.js")).href;
  writeFileSync(script, [
    `import { spawn } from "node:child_process";`,
    `import { tryHoldSociety } from ${JSON.stringify(entry)};`,
    `const lease = tryHoldSociety(${JSON.stringify(stateRoot)});`,
    'if (lease === null) { process.stdout.write("no" + String.fromCharCode(10)); process.exit(0); }',
    // The engine, as far as this test is concerned: a process that outlives
    // its host and could still write to the society.
    'const stdio = ["ignore", "pipe", "inherit"];',
    fenced ? "stdio.push(lease.fence);" : "// deliberately started without the lease",
    'const child = spawn(process.execPath, ["-e", "process.stdout.write(process.pid + String.fromCharCode(10)); setInterval(() => {}, 60000);"], { stdio });',
    'child.stdout.setEncoding("utf8");',
    'child.stdout.on("data", chunk => { process.stdout.write("child " + chunk); });',
    "setInterval(() => {}, 60000);",
  ].join("\n"));
  const host = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "inherit"] });
  host.stdout.setEncoding("utf8");
  let buffered = "";
  let announce: ((pid: number) => void) | null = null;
  let failed: ((error: Error) => void) | null = null;
  const childPid = new Promise<number>((resolve, reject) => { announce = resolve; failed = reject; });
  const timer = setTimeout(() => { failed?.(new Error(`the host never started a child: ${JSON.stringify(buffered)}`)); }, 20000);
  timer.unref();
  host.stdout.on("data", (chunk: string) => {
    buffered += chunk;
    const match = /child (\d+)\n/.exec(buffered);
    if (match) { clearTimeout(timer); announce?.(Number(match[1])); }
  });
  return {
    childPid,
    // SIGKILL, not a polite stop: the question is what is true when the host
    // runs no teardown whatsoever.
    kill: () => new Promise<void>(resolve => {
      host.once("exit", () => { resolve(); });
      host.kill("SIGKILL");
    }),
  };
}

const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

const freeWithin = async (stateRoot: string, ms: number): Promise<boolean> => {
  const deadline = Date.now() + ms;
  for (;;) {
    const taken = tryHoldSociety(stateRoot);
    if (taken !== null) { taken.release(); return true; }
    if (Date.now() >= deadline) return false;
    await new Promise<void>(resolve => { setTimeout(resolve, 20).unref(); });
  }
};

test("T119/REC-007 a killed host does not hand the society on while its engine is still running", async () => {
  // The property the previous design could not have. `close()` on a child is a
  // signal, not a death, and a host that is killed outright sends nothing at
  // all -- so ordering statements in a teardown could never make this true.
  // Here the engine holds the lease itself, and the kernel is what refuses.
  const root = scratch();
  try {
    const stateRoot = join(root, "state");
    const host = killableHost(stateRoot, root, true);
    const engine = await host.childPid;
    assert.equal(tryHoldSociety(stateRoot), null, "the society was free while its host held it");
    await host.kill();
    assert.ok(alive(engine), "the engine died with its host, so this proves nothing");

    // A full second of trying, which is far longer than the gap any real
    // second `oma` would need to start its own engine.
    assert.equal(await freeWithin(stateRoot, 1000), false,
      "the society was handed on while the engine of its dead host was still running");
    assert.ok(alive(engine));

    process.kill(engine, "SIGKILL");
    assert.equal(await freeWithin(stateRoot, 20000), true,
      "the society stayed locked after everything holding it was gone");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T119/REC-007 negative control: a host whose engine did not inherit the lease hands the society on at once", async () => {
  // The same host, the same kill, the same engine -- with only the inherited
  // descriptor taken away. If this ever stops passing, the test above has
  // stopped being evidence of anything: it would be proving that the engine
  // happened to die, not that it held the society.
  const root = scratch();
  try {
    const stateRoot = join(root, "state");
    const host = killableHost(stateRoot, root, false);
    const engine = await host.childPid;
    await host.kill();
    assert.ok(alive(engine), "the engine died with its host, so this control proves nothing");
    assert.equal(await freeWithin(stateRoot, 20000), true,
      "the control did not reproduce the defect: an unfenced engine kept the society");
    process.kill(engine, "SIGKILL");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T119/REC-007 a descendant the engine started keeps the society too", async () => {
  // The audit's wording is "the engine and its descendants", and it is the
  // right wording: an engine that spawns a tool and dies has not finished
  // writing to the society. An inherited descriptor refers to the same open
  // file description however many generations down it is passed, so this is
  // the same property, checked one level further out rather than assumed.
  const root = scratch();
  const script = join(root, "grandparent.mjs");
  const entry = pathToFileURL(join(process.cwd(), "apps/oma/dist/runtime/society-lease.js")).href;
  const stateRoot = join(root, "state");
  writeFileSync(script, [
    `import { spawn } from "node:child_process";`,
    `import { tryHoldSociety } from ${JSON.stringify(entry)};`,
    `const lease = tryHoldSociety(${JSON.stringify(stateRoot)});`,
    'if (lease === null) { process.stdout.write("no" + String.fromCharCode(10)); process.exit(0); }',
    // The engine gets the fence as fd 3 and hands that same fd on, exactly as
    // anything it starts under confinement would.
    'const engine = spawn(process.execPath, ["-e", "const { spawn } = require(\'node:child_process\'); const g = spawn(process.execPath, [\'-e\', \'process.stdout.write(process.pid + String.fromCharCode(10)); setInterval(() => {}, 60000);\'], { stdio: [\'ignore\', \'pipe\', \'inherit\', 3] }); g.stdout.pipe(process.stdout); setInterval(() => {}, 60000);"], { stdio: ["ignore", "pipe", "inherit", lease.fence] });',
    'engine.stdout.setEncoding("utf8");',
    'process.stdout.write("engine " + engine.pid + String.fromCharCode(10));',
    'engine.stdout.on("data", chunk => { process.stdout.write("grandchild " + chunk); });',
    "setInterval(() => {}, 60000);",
  ].join("\n"));
  const host = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "inherit"] });
  host.stdout.setEncoding("utf8");
  let seen = "";
  const both = new Promise<{ engine: number; grandchild: number }>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error(`no grandchild appeared: ${JSON.stringify(seen)}`)); }, 20000);
    timer.unref();
    host.stdout.on("data", (chunk: string) => {
      seen += chunk;
      const engine = /engine (\d+)\n/.exec(seen);
      const grandchild = /grandchild (\d+)\n/.exec(seen);
      if (engine && grandchild) { clearTimeout(timer); resolve({ engine: Number(engine[1]), grandchild: Number(grandchild[1]) }); }
    });
  });
  try {
    const { engine, grandchild } = await both;
    await new Promise<void>(resolve => { host.once("exit", () => { resolve(); }); host.kill("SIGKILL"); });
    process.kill(engine, "SIGKILL");
    // Both the host and the engine are gone; only what the engine started is
    // left, and it is enough to keep the society from changing hands.
    await new Promise<void>(resolve => { setTimeout(resolve, 200).unref(); });
    assert.ok(alive(grandchild), "the grandchild died too, so this proves nothing");
    assert.equal(await freeWithin(stateRoot, 500), false,
      "the society was handed on while a process the dead engine started was still running");
    process.kill(grandchild, "SIGKILL");
    assert.equal(await freeWithin(stateRoot, 20000), true);
  } finally {
    host.kill("SIGKILL");
    rmSync(root, { recursive: true, force: true });
  }
});

/** Everything above is about what the kernel does with a lease a child
 * inherited. None of it is about whether the product hands one over, and that
 * is a separate claim with its own way of failing: every owned child in this
 * codebase is started through `spawnOwnedRpc` or `spawnSupervisedService`, so
 * a helper that quietly dropped the fence would leave every test above passing
 * while the product ran with nothing fenced at all. These start real children
 * through the real helpers and ask the child which file is on the descriptor.
 */
const REPORT = (fds: readonly number[], to: 1 | 2): string =>
  'const fs = require("node:fs");' +
  `const out = ${JSON.stringify([...fds])}.map(fd => {` +
  ' try { const s = fs.fstatSync(fd, { bigint: true }); return s.dev + ":" + s.ino; }' +
  ' catch (error) { return "none:" + error.code; } });' +
  `fs.writeSync(${to}, out.join(" ") + String.fromCharCode(10));` +
  "setInterval(() => {}, 60000);";

/** Which object the parent means, named the way the child can name it.
 *
 * A descriptor that is merely open proves nothing -- the helper could push any
 * number -- so the two sides are compared by the inode behind the descriptor.
 * It is asked of the descriptor rather than of a path because the lease has no
 * path: that is the whole point of taking it in the abstract namespace. */
const identity = (fd: number): string => {
  const stat = fstatSync(fd, { bigint: true });
  return `${stat.dev}:${stat.ino}`;
};

const firstLine = (stream: Readable | null, what: string): Promise<string> => new Promise((resolve, reject) => {
  if (stream === null) { reject(new Error(`${what} was started with no stream to report on`)); return; }
  let buffered = "";
  const timer = setTimeout(() => { reject(new Error(`${what} never reported: ${JSON.stringify(buffered)}`)); }, 20000);
  timer.unref();
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buffered += chunk;
    const end = buffered.indexOf("\n");
    if (end >= 0) { clearTimeout(timer); resolve(buffered.slice(0, end)); }
  });
});

const childEnv = { PATH: process.env.PATH ?? "/usr/bin" };

/** The society is still nobody else's once this process has let go entirely,
 * and becomes theirs once the child is gone. Both halves are asserted every
 * time: without the second, a lease file that had become permanently
 * unlockable for some unrelated reason would read as a passing fence. */
async function heldByTheChildAlone(stateRoot: string, lease: { release: () => void }, child: ChildProcess, what: string): Promise<void> {
  lease.release();
  assert.equal(await freeWithin(stateRoot, 500), false,
    `the society was free while ${what} the lease was handed to was still running`);
  await new Promise<void>(resolve => { child.once("exit", () => { resolve(); }); child.kill("SIGKILL"); });
  assert.equal(await freeWithin(stateRoot, 20000), true,
    `the society stayed locked after ${what} was gone`);
}

test("T119/REC-007 an owned RPC child is started holding the society lease, at the descriptor the product declares", async () => {
  // Not "the lease is somewhere in the child": a child that has to work out
  // which descriptor its lease is cannot pass it on, and passing it on is the
  // whole requirement -- the engine starts the model-facing CLI, which writes
  // this society's private state. So the slot is fixed and asserted, and it is
  // asserted for a child with no channel too, where the slot below it is
  // deliberately held open rather than letting the lease slide down into the
  // number the credential is read from.
  const root = scratch();
  try {
    const stateRoot = join(root, "state");
    const lease = tryHoldSociety(stateRoot);
    assert.ok(lease);
    const child = spawnOwnedRpc(process.execPath, ["-e", REPORT([SOCIETY_FENCE_FD - 1, SOCIETY_FENCE_FD], 1)], "/", childEnv, false, lease.fence);
    try {
      const [below, fence] = (await firstLine(child.stdout, "the owned child")).split(" ");
      assert.equal(fence, identity(lease.fence), `descriptor ${SOCIETY_FENCE_FD} was not the society lease`);
      assert.notEqual(below, identity(lease.fence),
        "the lease moved down into the channel's descriptor when no channel was asked for");
      await heldByTheChildAlone(stateRoot, lease, child, "an owned child");
    } finally { child.kill("SIGKILL"); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T119/REC-007 negative control: an owned RPC child started without the fence does not keep the society", async () => {
  // The same helper, the same child, the same release -- with only the fence
  // argument left off. If this ever fails, the test above has stopped being
  // evidence: it would mean the society stays locked for reasons that have
  // nothing to do with what was handed to the child.
  const root = scratch();
  try {
    const stateRoot = join(root, "state");
    const lease = tryHoldSociety(stateRoot);
    assert.ok(lease);
    const child = spawnOwnedRpc(process.execPath, ["-e", REPORT([3, SOCIETY_FENCE_FD], 1)], "/", childEnv);
    try {
      // Not "nothing is open there": a Node process has descriptors of its own
      // at those numbers. The claim is only that the society lease is not one
      // of them, which is exactly what the fence argument decides.
      const reported = (await firstLine(child.stdout, "the unfenced child")).split(" ");
      for (const seen of reported)
        assert.notEqual(seen, identity(lease.fence),
          "a child started without a fence was handed the society lease anyway");
      lease.release();
      assert.equal(await freeWithin(stateRoot, 20000), true,
        "the control did not reproduce the defect: an unfenced child kept the society");
    } finally { child.kill("SIGKILL"); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T119/REC-007 the fence and the channel keep their own descriptors, so neither displaces the other", async () => {
  // The engine reads its credential off `CHANNEL_FD` and must never read the
  // lease there; the lease must be present all the same. Asserting only "the
  // lease is somewhere" would pass a helper that overwrote the channel with
  // it, which would break the credential handover instead of the fence.
  const root = scratch();
  try {
    const stateRoot = join(root, "state");
    const lease = tryHoldSociety(stateRoot);
    assert.ok(lease);
    const child = spawnOwnedRpc(process.execPath, ["-e", REPORT([CHANNEL_FD, SOCIETY_FENCE_FD], 1)], "/", childEnv, true, lease.fence);
    try {
      const [channel, fence] = (await firstLine(child.stdout, "the owned child with a channel")).split(" ");
      assert.equal(fence, identity(lease.fence), `descriptor ${SOCIETY_FENCE_FD} was not the society lease`);
      assert.notEqual(channel, identity(lease.fence), "the lease displaced the channel the engine reads its credential from");
      await heldByTheChildAlone(stateRoot, lease, child, "an owned child with a channel");
    } finally { child.kill("SIGKILL"); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T119/REC-007 a supervised service is started holding the society lease itself", async () => {
  // The broker's own case. A broker that outlives its host can still write to
  // the society's database, so it has to be as fenced as the engine is -- and
  // it is started by a different helper, which is why this is asserted and not
  // inferred from the test above.
  const root = scratch();
  try {
    const stateRoot = join(root, "state");
    const lease = tryHoldSociety(stateRoot);
    assert.ok(lease);
    const child = spawnSupervisedService(process.execPath, ["-e", REPORT([SOCIETY_FENCE_FD], 2)], childEnv, false, lease.fence);
    try {
      assert.equal(await firstLine(child.stderr, "the supervised service"), identity(lease.fence),
        `descriptor ${SOCIETY_FENCE_FD} was not the society lease`);
      await heldByTheChildAlone(stateRoot, lease, child, "a supervised service");
    } finally { child.kill("SIGKILL"); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T119/REC-007 a supervised service keeps its supervision channel and its fence apart", async () => {
  const root = scratch();
  try {
    const stateRoot = join(root, "state");
    const lease = tryHoldSociety(stateRoot);
    assert.ok(lease);
    const child = spawnSupervisedService(process.execPath, ["-e", REPORT([CHANNEL_FD, SOCIETY_FENCE_FD], 2)], childEnv, true, lease.fence);
    try {
      const [channel, fence] = (await firstLine(child.stderr, "the supervised service with a channel")).split(" ");
      assert.equal(fence, identity(lease.fence), `descriptor ${SOCIETY_FENCE_FD} was not the society lease`);
      assert.notEqual(channel, identity(lease.fence), "the lease displaced the supervision channel");
      await heldByTheChildAlone(stateRoot, lease, child, "a supervised service with a channel");
    } finally { child.kill("SIGKILL"); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

/** The link the fence was missing, and the one that matters most.
 *
 * Everything above starts a child of this process. The model-facing CLI is not
 * one: it is started by the trusted extension inside the Pi engine, two
 * processes down, and it is a writer of this society's private state -- its
 * agent home is `<stateRoot>/principal/private` and its request cache is
 * written underneath. It also outlives signals sent to the engine, because a
 * signal to a process is not a signal to its children, and it may run for its
 * remaining preparation/transport work after both the host and the engine are gone.
 *
 * So the exact sequence the audit described is run here: host takes the
 * society, engine inherits the lease, engine starts the CLI, host and engine
 * are killed outright, and the question is whether another `oma` can take the
 * society while that CLI is still writing. Nothing is stood in for -- these
 * are three real processes and the product's own `runCliProcess`.
 */
function engineStartingACli(scriptRoot: string, fence: number, declare: boolean): {
  readonly engine: ChildProcess;
  readonly report: Promise<{ pid: number; fence: string; declared: string | null }>;
} {
  const cliScript = join(scriptRoot, "cli.mjs");
  const engineScript = join(scriptRoot, "engine.mjs");
  const reportPath = join(scriptRoot, "cli.json");
  const module = pathToFileURL(join(process.cwd(), "packages/process/dist/run.js")).href;
  // The CLI answers with the inode behind its own descriptor, its pid, and
  // what its environment told it -- then stays alive, which is the state the
  // attack depends on.
  writeFileSync(cliScript, [
    'import { fstatSync, renameSync, writeFileSync } from "node:fs";',
    "const out = process.argv[2];",
    'let fence = "none";',
    `try { const s = fstatSync(${SOCIETY_FENCE_FD}, { bigint: true }); fence = s.dev + ":" + s.ino; }`,
    ' catch (error) { fence = "none:" + error.code; }',
    "const body = JSON.stringify({ pid: process.pid, fence, declared: process.env." + SOCIETY_FENCE_ENV + " ?? null });",
    // Written and renamed, so the reader never sees half a report.
    'writeFileSync(out + ".tmp", body);',
    'renameSync(out + ".tmp", out);',
    "setInterval(() => {}, 60000);",
  ].join("\n"));
  writeFileSync(engineScript, [
    `import { runProcessSync } from ${JSON.stringify(module)};`,
    'process.stdout.write("engine " + process.pid + String.fromCharCode(10));',
    "const result = runProcessSync({ executable: process.execPath, argv: [process.argv[2], process.argv[3]],",
    '  cwd: "/", env: { PATH: process.env.PATH ?? "/usr/bin" }, timeoutMs: 60000, stdoutBytes: 1024, stderrBytes: 1024 });',
    'process.stdout.write("effect-exit " + result.exitCode + String.fromCharCode(10));',
    "setInterval(() => {}, 60000);",
  ].join("\n"));
  // Exactly how the host starts the engine: the lease on the declared
  // descriptor, and the environment saying which descriptor that is.
  const env = declare ? { ...childEnv, [SOCIETY_FENCE_ENV]: String(SOCIETY_FENCE_FD) } : { ...childEnv };
  const engine = spawnOwnedRpc(process.execPath, [engineScript, cliScript, reportPath], "/", env, false, fence);
  const report = (async () => {
    const deadline = Date.now() + 20000;
    for (;;) {
      if (existsSync(reportPath)) {
        const parsed: unknown = JSON.parse(readFileSync(reportPath, "utf8"));
        return parsed as { pid: number; fence: string; declared: string | null };
      }
      if (Date.now() >= deadline) throw new Error("the CLI the engine started never reported");
      await new Promise<void>(resolve => { setTimeout(resolve, 20).unref(); });
    }
  })();
  return { engine, report };
}

test("T119/REC-007 the model-facing CLI the engine starts holds the society, and keeps it after the host and the engine are killed", async () => {
  const root = scratch();
  try {
    const stateRoot = join(root, "state");
    const lease = tryHoldSociety(stateRoot);
    assert.ok(lease);
    const { engine, report } = engineStartingACli(root, lease.fence, true);
    let cli = 0;
    try {
      const answer = await report;
      cli = answer.pid;
      assert.equal(answer.fence, identity(lease.fence),
        `the CLI's descriptor ${SOCIETY_FENCE_FD} was not the society lease`);
      // And it can pass it on in turn, which is only true if it was told where
      // its own lease is rather than having to infer it.
      assert.equal(answer.declared, String(SOCIETY_FENCE_FD),
        "the CLI was handed the lease without being told which descriptor it is on");

      // The attack: both the processes that know about the lease are killed
      // outright, and the writer that neither of them can signal is left.
      await new Promise<void>(resolve => { engine.once("exit", () => { resolve(); }); engine.kill("SIGKILL"); });
      lease.release();
      assert.ok(alive(cli), "the CLI died with the engine, so this proves nothing");
      assert.equal(await freeWithin(stateRoot, 500), false,
        "another oma could take the society while the dead engine's CLI was still writing to it");
      process.kill(cli, "SIGKILL");
      assert.equal(await freeWithin(stateRoot, 20000), true,
        "the society stayed locked after the CLI was gone");
      cli = 0;
    } finally {
      engine.kill("SIGKILL");
      if (cli !== 0) { try { process.kill(cli, "SIGKILL"); } catch { /* already gone */ } }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T119/REC-007 negative control: an engine that does not declare its fence starts a CLI that outlives the society", async () => {
  // This is the product as the audit found it: the engine held the lease, and
  // `runCliProcess` passed descriptors 0-2 and nothing else. Every other test
  // in this file passed in that build. The only difference here is the one
  // environment variable, and it changes the answer -- which is what makes the
  // test above evidence rather than a description.
  const root = scratch();
  try {
    const stateRoot = join(root, "state");
    const lease = tryHoldSociety(stateRoot);
    assert.ok(lease);
    const { engine, report } = engineStartingACli(root, lease.fence, false);
    let cli = 0;
    try {
      const answer = await report;
      cli = answer.pid;
      assert.equal(answer.declared, null);
      assert.notEqual(answer.fence, identity(lease.fence),
        "the control did not reproduce the defect: an undeclared fence reached the CLI anyway");
      await new Promise<void>(resolve => { engine.once("exit", () => { resolve(); }); engine.kill("SIGKILL"); });
      lease.release();
      assert.ok(alive(cli), "the CLI died with the engine, so this control proves nothing");
      assert.equal(await freeWithin(stateRoot, 20000), true,
        "the control did not reproduce the defect: an unfenced CLI kept the society");
    } finally {
      engine.kill("SIGKILL");
      if (cli !== 0) { try { process.kill(cli, "SIGKILL"); } catch { /* already gone */ } }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T119/REC-007 a declared fence that is not there stops the CLI from starting, rather than starting it unfenced", async () => {
  // A process told to pass the lease on and unable to find it cannot give a
  // child the fence it was told to give. Starting the child anyway would start
  // exactly the unfenced writer the declaration existed to prevent, so this is
  // an error the tool call reports -- not a shrug, and not a silent fallback
  // to the behaviour the control above reproduces.
  const root = scratch();
  try {
    const stateRoot = join(root, "state");
    const lease = tryHoldSociety(stateRoot);
    assert.ok(lease);
    const plainFile = join(root, "not-a-socket");
    writeFileSync(plainFile, "");
    const notASocket = openSync(plainFile, "r");
    const start = (declared: string): CliResult | Promise<CliResult> => {
      process.env[SOCIETY_FENCE_ENV] = declared;
      try {
        return runCliProcess({ node: process.execPath, cli: "-e", args: ["0"], cwd: "/",
          env: { ...childEnv }, timeoutMs: 5000 });
      } finally { delete process.env[SOCIETY_FENCE_ENV]; }
    };
    try {
      assert.throws(() => start("9999"), /not open/, "a fence that is not there was accepted");
      assert.throws(() => start(String(notASocket)), /not the society lease/, "a plain file was accepted as the lease");
      assert.throws(() => start("4x"), /not a descriptor number/);
      assert.throws(() => start(""), /not a descriptor number/);
      // The positive control: the real lease on the real descriptor starts a
      // real child, so the refusals above are about the fence and not about
      // this path being broken for everything.
      const ran = await start(String(lease.fence));
      assert.equal(ran.code, 0, ran.stderr);
    } finally { closeSync(notASocket); lease.release(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
