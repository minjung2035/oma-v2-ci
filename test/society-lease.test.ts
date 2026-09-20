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
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Readable } from "node:stream";
import { spawnOwnedRpc, spawnSupervisedService } from "../src/process/async.js";
import { SOCIETY_LEASE_FILE, tryHoldSociety } from "../src/runtime/society-lease.js";

const scratch = (): string => mkdtempSync(join(tmpdir(), "oma-lease-"));

/** A second real process that takes the lease, says so, and then waits to be
 * told to let go. Ownership between processes is the only thing the lease is
 * for, so nothing here stands in for the other process. */
function otherProcess(runRoot: string, scriptRoot: string): {
  /** True when it took the society, false when it was told someone else has
   * it. Both are answers: the whole point of the lease is that the second
   * process is refused rather than failing, so a harness that can only hear
   * "yes" cannot tell a refusal from a hang. */
  readonly took: Promise<boolean>;
  readonly release: () => Promise<void>;
  readonly kill: () => void;
} {
  const script = join(scriptRoot, "holder.mjs");
  const entry = pathToFileURL(join(process.cwd(), "dist/src/runtime/society-lease.js")).href;
  writeFileSync(script, [
    `import { tryHoldSociety } from ${JSON.stringify(entry)};`,
    `const lease = tryHoldSociety(${JSON.stringify(runRoot)});`,
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
    const runRoot = join(root, "run");
    const other = otherProcess(runRoot, root);
    try {
      assert.equal(await other.took, true, "the first process could not take a free society");
      // The second answer is null, not an exception: "someone else owns this"
      // is an ordinary outcome the product shows a Control Panel for.
      assert.equal(tryHoldSociety(runRoot), null, "two processes held one society at once");
      await other.release();
      const mine = tryHoldSociety(runRoot);
      assert.ok(mine, "a released society could not be taken");
      assert.equal(mine.path, join(runRoot, SOCIETY_LEASE_FILE));
      // And it is exclusive again from here.
      const third = otherProcess(runRoot, root);
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
    const runRoot = join(root, "run");
    const other = otherProcess(runRoot, root);
    assert.equal(await other.took, true);
    assert.equal(tryHoldSociety(runRoot), null);
    other.kill();
    // The descriptor closes when the process is reaped, which is not instant.
    const deadline = Date.now() + 20000;
    let mine = tryHoldSociety(runRoot);
    while (mine === null && Date.now() < deadline) {
      await new Promise<void>(resolve => { setTimeout(resolve, 20).unref(); });
      mine = tryHoldSociety(runRoot);
    }
    assert.ok(mine, "a society whose owner was killed stayed locked");
    mine.release();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T119 releasing is idempotent, and releasing twice does not give away someone else's society", async () => {
  const root = scratch();
  try {
    const runRoot = join(root, "run");
    const mine = tryHoldSociety(runRoot);
    assert.ok(mine);
    mine.release();
    // A second release must not close a descriptor this lease no longer owns:
    // by now the number could be any file this process has opened since --
    // including, as here, another society's lease.
    const second = join(root, "other-run");
    const theirs = tryHoldSociety(second);
    assert.ok(theirs);
    mine.release();
    mine.release();
    assert.equal(tryHoldSociety(second), null, "releasing a released lease gave away another society");
    theirs.release();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T119 a lease that cannot be taken at all is not reported as someone else's", () => {
  // The distinction the whole design rests on: a null answer means another
  // process owns the society and this one shows a Control Panel. Anything else
  // -- a lease path that is a symlink, a run root that cannot be made -- is a
  // failure, and returning null for it would make this process quietly give up
  // a society nobody owns, or, worse, treat a tampered path as ownership.
  const root = scratch();
  try {
    const runRoot = join(root, "run");
    mkdirSync(runRoot, { recursive: true });
    symlinkSync("/etc/passwd", join(runRoot, SOCIETY_LEASE_FILE));
    assert.throws(() => tryHoldSociety(runRoot), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(String(error.message), /^$/);
      return true;
    }, "a lease path that is a symlink was read as another process's ownership");

    const blocked = join(root, "file");
    writeFileSync(blocked, "");
    assert.throws(() => tryHoldSociety(join(blocked, "run")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T119 the lease lives in the run root, private to this user", () => {
  // A lease under the state tree would survive a reboot and claim a society
  // for a process that no longer exists. The run root is cleared by the
  // system, so the lease is a fact about this boot.
  const root = scratch();
  try {
    const runRoot = join(root, "run", "oma", "demo");
    assert.equal(existsSync(runRoot), false);
    const mine = tryHoldSociety(runRoot);
    assert.ok(mine);
    assert.equal(mine.path, join(runRoot, SOCIETY_LEASE_FILE));
    assert.equal(statSync(runRoot).mode & 0o777, 0o700, "the run root was made readable to other users");
    assert.ok(existsSync(mine.path));
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
function killableHost(runRoot: string, scriptRoot: string, fenced: boolean): {
  readonly childPid: Promise<number>;
  readonly kill: () => Promise<void>;
} {
  const script = join(scriptRoot, `host-${fenced ? "fenced" : "bare"}.mjs`);
  const entry = pathToFileURL(join(process.cwd(), "dist/src/runtime/society-lease.js")).href;
  writeFileSync(script, [
    `import { spawn } from "node:child_process";`,
    `import { tryHoldSociety } from ${JSON.stringify(entry)};`,
    `const lease = tryHoldSociety(${JSON.stringify(runRoot)});`,
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

const freeWithin = async (runRoot: string, ms: number): Promise<boolean> => {
  const deadline = Date.now() + ms;
  for (;;) {
    const taken = tryHoldSociety(runRoot);
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
    const runRoot = join(root, "run");
    const host = killableHost(runRoot, root, true);
    const engine = await host.childPid;
    assert.equal(tryHoldSociety(runRoot), null, "the society was free while its host held it");
    await host.kill();
    assert.ok(alive(engine), "the engine died with its host, so this proves nothing");

    // A full second of trying, which is far longer than the gap any real
    // second `oma` would need to start its own engine.
    assert.equal(await freeWithin(runRoot, 1000), false,
      "the society was handed on while the engine of its dead host was still running");
    assert.ok(alive(engine));

    process.kill(engine, "SIGKILL");
    assert.equal(await freeWithin(runRoot, 20000), true,
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
    const runRoot = join(root, "run");
    const host = killableHost(runRoot, root, false);
    const engine = await host.childPid;
    await host.kill();
    assert.ok(alive(engine), "the engine died with its host, so this control proves nothing");
    assert.equal(await freeWithin(runRoot, 20000), true,
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
  const entry = pathToFileURL(join(process.cwd(), "dist/src/runtime/society-lease.js")).href;
  const runRoot = join(root, "run");
  writeFileSync(script, [
    `import { spawn } from "node:child_process";`,
    `import { tryHoldSociety } from ${JSON.stringify(entry)};`,
    `const lease = tryHoldSociety(${JSON.stringify(runRoot)});`,
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
    assert.equal(await freeWithin(runRoot, 500), false,
      "the society was handed on while a process the dead engine started was still running");
    process.kill(grandchild, "SIGKILL");
    assert.equal(await freeWithin(runRoot, 20000), true);
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

/** Which file the parent means, named the way the child can name it. A
 * descriptor that is merely open proves nothing -- the helper could push any
 * number -- so the two sides are compared by inode. */
const identity = (path: string): string => {
  const stat = statSync(path, { bigint: true });
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
async function heldByTheChildAlone(runRoot: string, lease: { release: () => void }, child: ChildProcess, what: string): Promise<void> {
  lease.release();
  assert.equal(await freeWithin(runRoot, 500), false,
    `the society was free while ${what} the lease was handed to was still running`);
  await new Promise<void>(resolve => { child.once("exit", () => { resolve(); }); child.kill("SIGKILL"); });
  assert.equal(await freeWithin(runRoot, 20000), true,
    `the society stayed locked after ${what} was gone`);
}

test("T119/REC-007 an owned RPC child is started holding the society lease itself", async () => {
  const root = scratch();
  try {
    const runRoot = join(root, "run");
    const lease = tryHoldSociety(runRoot);
    assert.ok(lease);
    const child = spawnOwnedRpc(process.execPath, ["-e", REPORT([3], 1)], "/", childEnv, false, lease.fence);
    try {
      assert.equal(await firstLine(child.stdout, "the owned child"), identity(lease.path),
        "the descriptor after stderr was not the society lease");
      await heldByTheChildAlone(runRoot, lease, child, "an owned child");
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
    const runRoot = join(root, "run");
    const lease = tryHoldSociety(runRoot);
    assert.ok(lease);
    const child = spawnOwnedRpc(process.execPath, ["-e", REPORT([3], 1)], "/", childEnv);
    try {
      // Not "nothing is open there": a Node process has descriptors of its own
      // at that number. The claim is only that the society lease is not one of
      // them, which is exactly what the fence argument decides.
      assert.notEqual(await firstLine(child.stdout, "the unfenced child"), identity(lease.path),
        "a child started without a fence was handed the society lease anyway");
      lease.release();
      assert.equal(await freeWithin(runRoot, 20000), true,
        "the control did not reproduce the defect: an unfenced child kept the society");
    } finally { child.kill("SIGKILL"); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T119/REC-007 the fence goes after the channel, so neither displaces the other", async () => {
  // The engine reads its credential off descriptor 3 and must never read the
  // lease there; the lease must be present all the same. Asserting only "the
  // lease is somewhere" would pass a helper that overwrote the channel with
  // it, which would break the credential handover instead of the fence.
  const root = scratch();
  try {
    const runRoot = join(root, "run");
    const lease = tryHoldSociety(runRoot);
    assert.ok(lease);
    const child = spawnOwnedRpc(process.execPath, ["-e", REPORT([3, 4], 1)], "/", childEnv, true, lease.fence);
    try {
      const [channel, fence] = (await firstLine(child.stdout, "the owned child with a channel")).split(" ");
      assert.equal(fence, identity(lease.path), "the descriptor after the channel was not the society lease");
      assert.notEqual(channel, identity(lease.path), "the lease displaced the channel the engine reads its credential from");
      await heldByTheChildAlone(runRoot, lease, child, "an owned child with a channel");
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
    const runRoot = join(root, "run");
    const lease = tryHoldSociety(runRoot);
    assert.ok(lease);
    const child = spawnSupervisedService(process.execPath, ["-e", REPORT([3], 2)], childEnv, false, lease.fence);
    try {
      assert.equal(await firstLine(child.stderr, "the supervised service"), identity(lease.path),
        "the descriptor after stderr was not the society lease");
      await heldByTheChildAlone(runRoot, lease, child, "a supervised service");
    } finally { child.kill("SIGKILL"); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T119/REC-007 a supervised service keeps its supervision channel and its fence apart", async () => {
  const root = scratch();
  try {
    const runRoot = join(root, "run");
    const lease = tryHoldSociety(runRoot);
    assert.ok(lease);
    const child = spawnSupervisedService(process.execPath, ["-e", REPORT([3, 4], 2)], childEnv, true, lease.fence);
    try {
      const [channel, fence] = (await firstLine(child.stderr, "the supervised service with a channel")).split(" ");
      assert.equal(fence, identity(lease.path), "the descriptor after the supervision channel was not the society lease");
      assert.notEqual(channel, identity(lease.path), "the lease displaced the supervision channel");
      await heldByTheChildAlone(runRoot, lease, child, "a supervised service with a channel");
    } finally { child.kill("SIGKILL"); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
