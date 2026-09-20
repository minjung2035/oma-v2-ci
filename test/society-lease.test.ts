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
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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
