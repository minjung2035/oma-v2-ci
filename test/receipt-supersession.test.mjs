/** REC-007: a recorded observation of durable state does not become less
 * settled, and two processes observing one request cannot make it so.
 *
 * `lastReceipt` is a record of what happened to a request. Reading it, deciding
 * it may be replaced, and writing the replacement used to be three unguarded
 * steps against a file any `oma` of this Human may hold open: two processes
 * observing one key both read the same older value, both decide they are newer,
 * and the write that lands last is the one the Human sees. A settled success
 * regressing to `pending` is not a cosmetic wrong: it is an offer to retry work
 * that already happened.
 *
 * Ordering the states is half the answer. The other half is that the read and
 * the write are one critical section, because an order cannot be applied to a
 * value that was already stale when it was read -- so the concurrency test
 * below is not an extra: it is the half of the property the unit table cannot
 * reach.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { receiptSupersession } from "@oma/protocol/receipt-codec";
import { RequestCache, CacheError } from "#oma-test/app/request-cache";

const CACHE_MODULE = fileURLToPath(new URL(import.meta.resolve("#oma-test/app/request-cache")));
const LEAF_MODULE = fileURLToPath(new URL(import.meta.resolve("@oma/native/linux"), import.meta.url));
const OP = "op-12345678-1234-4234-8234-123456789abc";
const OTHER_OP = "op-87654321-4321-4321-8321-cba987654321";

const pending = (operation = OP) => ({ operation, state: "pending" });
const unknown = (operation = OP) => ({ operation, state: "unknown" });
const failed = (operation = OP, message = "no") =>
  ({ operation, state: "failed", error: { code: "REQUEST_NOT_FOUND", message, retry: "never" } });
const succeeded = (operation = OP) =>
  ({ operation, state: "succeeded", result: { kind: "route.follow", ok: true } });

function home() {
  const path = mkdtempSync(join(tmpdir(), "oma-receipt-"));
  return { path, dir: join(path, ".local/state/oma/requests"), cleanup: () => rmSync(path, { recursive: true, force: true }) };
}
const request = (key) => ({ key, method: "route.follow", params: { topic: "commons" }, createdAtMs: 1 });
/** How many processes compete with the one that settles. */
const REGRESSORS = ["b", "c", "d"];

test("REC-007: the ordering admits progress, refuses regression, and names contradiction as neither", () => {
  // Read as a table, because the failure this prevents is a missing row rather
  // than a wrong line: every pair of states has to have an answer, and the two
  // non-terminal states must not be treated as settled just because something
  // was written.
  const cases = [
    [null, pending(), "supersedes", "the first observation of a request is always news"],
    [null, failed(), "supersedes", "a request may be observed settled without ever being observed pending"],
    [pending(), pending(), "supersedes", "pending is not settled, so re-observing it is not a regression"],
    [pending(), succeeded(), "supersedes", "settling a pending request is the ordinary case"],
    [pending(), failed(), "supersedes", "settling a pending request as failed is the ordinary case"],
    [unknown(), failed(), "supersedes", "unknown is an absence of knowledge, not a settled state"],
    [unknown(), pending(), "supersedes", "unknown may be replaced by anything, including less"],
    [succeeded(), pending(), "stale", "a success does not go back to pending"],
    [succeeded(), unknown(), "stale", "a success does not become unknown again"],
    [failed(), pending(), "stale", "a failure does not go back to pending"],
    [succeeded(), succeeded(), "stale", "the same settled state twice is older news, not an update"],
    [failed(), failed(), "stale", "the same settled state twice is older news, not an update"],
    [succeeded(), failed(), "contradiction", "one operation does not both succeed and fail"],
    [failed(), succeeded(), "contradiction", "one operation does not both fail and succeed"],
  ];
  for (const [previous, observed, expected, why] of cases)
    assert.equal(receiptSupersession(previous, observed), expected,
      `${previous === null ? "absent" : previous.state} -> ${observed.state}: ${why}`);
});

test("REC-007: a settled receipt is not rewritten by a later observation of less", () => {
  const h = home();
  try {
    const cache = new RequestCache(h.path);
    cache.freeze(request("settle"));
    assert.equal(cache.updateReceipt("settle", failed()).lastReceipt.state, "failed");
    const bytes = readFileSync(join(h.dir, "settle.json"), "utf8");
    for (const regression of [pending(), unknown()]) {
      const kept = cache.updateReceipt("settle", regression);
      assert.equal(kept.lastReceipt.state, "failed", `${regression.state} replaced a settled observation`);
    }
    assert.equal(readFileSync(join(h.dir, "settle.json"), "utf8"), bytes,
      "the record was rewritten even though the observation was refused");
    assert.equal(cache.read("settle").value.lastReceipt.state, "failed");
  } finally { h.cleanup(); }
});

test("REC-007: two settled states for one operation is a corruption, not an update", () => {
  const h = home();
  try {
    const cache = new RequestCache(h.path);
    cache.freeze(request("both"));
    cache.updateReceipt("both", failed());
    assert.throws(() => cache.updateReceipt("both", succeeded()),
      error => error instanceof CacheError && error.code === "CACHE_CORRUPT");
    // The refusal must leave the evidence alone: a caller that reports a
    // contradiction and then overwrites one half of it has destroyed the only
    // record of which two things disagreed.
    assert.equal(cache.read("both").value.lastReceipt.state, "failed");
  } finally { h.cleanup(); }
});

test("REC-007: a receipt for another operation is refused rather than ordered against this one", () => {
  const h = home();
  try {
    const cache = new RequestCache(h.path);
    cache.freeze(request("other"));
    cache.updateReceipt("other", pending(OP));
    assert.throws(() => cache.updateReceipt("other", failed(OTHER_OP)),
      error => error instanceof CacheError && error.code === "CACHE_CORRUPT");
  } finally { h.cleanup(); }
});

/** A child that walks every key in order, writing one observation to each.
 *
 * `passes` is what makes the outcome independent of which child is scheduled
 * first. The settler walks once and stops; the regressor keeps walking until
 * the settler says it is done. So a settled receipt that a regressor overwrote
 * is never re-settled by a later pass, and the final state of a key answers
 * "was this ever lost" rather than "who happened to write last". */
function walker(home, keys, receiptLiteral, ready, { untilDone = false } = {}) {
  return spawn(process.execPath, ["--input-type=module", "-e", `
    const { RequestCache } = await import(${JSON.stringify(CACHE_MODULE)});
    const cache = new RequestCache(${JSON.stringify(home)});
    const keys = ${JSON.stringify(keys)};
    const { writeFileSync, existsSync } = await import("node:fs");
    const done = ${JSON.stringify(join(home, "done"))};
    writeFileSync(${JSON.stringify(ready)}, "");
    // Both walkers start from the same signal, so their reads overlap rather
    // than running one after the other -- an interleaving test that does not
    // interleave proves nothing.
    const start = Date.now();
    while (!existsSync(${JSON.stringify(join(home, "go"))})) {
      // Bounded: a walker that spins forever on a signal that never comes turns
      // a broken product into a test that never finishes, and a test that never
      // finishes reports nothing at all.
      if (Date.now() - start > 30_000) throw new Error("the start signal never came");
    }
    let i = 0;
    // CACHE_UNAVAILABLE rides on the error's code, not in its message, and is
    // the cache's defined answer when a contending process holds a receipt
    // lock past the wait bound. A regressor takes it and moves on: its passes
    // keep racing the other keys either way. The settler retries it a bounded
    // number of times instead -- a skipped settle would leave the key
    // unsettled, which reads exactly like the regression under test, and a
    // cache that stays unavailable is a failure to report, not a pass.
    const SETTLER_RETRIES = 10;
    const pass = () => {
      i += 1;
      for (const key of keys) {
        for (let attempt = 0; ; attempt++) {
          try { cache.updateReceipt(key, ${receiptLiteral}); break; }
          catch (error) {
            if (error && error.code === "CACHE_UNAVAILABLE") {
              if (${JSON.stringify(untilDone)}) break;
              if (attempt < SETTLER_RETRIES) continue;
              throw error;
            }
            if (!/cannot both succeed and fail/.test(String(error && error.message))) throw error;
            break;
          }
        }
      }
    };
    if (${JSON.stringify(untilDone)}) {
      // At least one pass, always. Checking the finish flag first would let a
      // settler that won the start make this child write nothing at all, and a
      // race in which only one side ever ran is not a race.
      do {
        if (Date.now() - start > 60_000) throw new Error("the settler never finished");
        pass();
      } while (!existsSync(done));
    } else {
      pass();
      writeFileSync(done, "");
    }
  `], { stdio: ["ignore", "inherit", "inherit"] });
}

test("REC-007: a settled receipt survives a process observing the same request as pending", async () => {
  // The unit table above cannot see this defect. Each process applies the
  // ordering correctly to the value it read; the regression happens because
  // the value it read stopped being current before it wrote. Only a hold that
  // spans the read and the write refuses it, so only two real processes can
  // show it is held.
  //
  // Under a correct product the answer does not depend on scheduling: a
  // `pending` observed after a settled one is older news whenever it is
  // applied, so every key ends settled however the two passes interleave.
  const h = home();
  try {
    const cache = new RequestCache(h.path);
    const keys = Array.from({ length: 300 }, (_, index) => `race-${index}`);
    for (const key of keys) cache.freeze(request(key));
    const readyA = join(h.path, "ready-a");
    const settler = walker(h.path, keys, `({ operation: ${JSON.stringify(OP)}, state: "failed", error: { code: "REQUEST_NOT_FOUND", message: "settled", retry: "never" } })`, readyA);
    // Alternating non-terminals, because a second `pending` on top of a
    // `pending` is already stale and writes nothing: a regressor that stops
    // writing after its first pass has only one window in which it can lose an
    // update, and whether it hits it is then a matter of scheduling. Two
    // non-terminal states that supersede each other keep the window open for
    // every pass, so the interleaving is produced rather than hoped for.
    // Several regressors, not one. A single competitor has to be inside its
    // own read-write window on the very key the settler is writing, and
    // whether it is depends on how the two processes happen to be scheduled.
    // Several independent ones make the window overlap something on nearly
    // every key, which is the difference between reproducing a lost update and
    // hoping to see one.
    const readyB = REGRESSORS.map(tag => join(h.path, `ready-${tag}`));
    const regressors = readyB.map(ready =>
      walker(h.path, keys, `({ operation: ${JSON.stringify(OP)}, state: i % 2 ? "pending" : "unknown" })`, ready, { untilDone: true }));
    const exits = Promise.all([settler, ...regressors].map(child =>
      new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); })));
    const armed = Date.now() + 30_000;
    while (!(existsSync(readyA) && readyB.every(existsSync))) {
      // Same rule as above: a walker that died before it armed must end this
      // test, not suspend it.
      assert.ok(Date.now() < armed, "a walker never signalled that it was ready");
      await new Promise(resolve => setImmediate(resolve));
    }
    writeFileSync(join(h.path, "go"), "");
    assert.deepEqual(await exits, [0, ...REGRESSORS.map(() => 0)],
      "a walker failed rather than finishing its pass");

    const observed = keys.map(key => cache.read(key).value.lastReceipt.state);
    const regressed = keys.filter((_, index) => observed[index] !== "failed");
    assert.deepEqual(regressed, [],
      `${regressed.length} settled receipts were replaced by a later, less settled observation`);
  } finally { h.cleanup(); }
});

test("REC-007: a receipt lock another process holds is reported as unavailable, never taken", async () => {
  // The bounded wait exists so a stuck holder cannot hang the Human's terminal
  // indefinitely. What must never happen is the other reading of a wait that
  // ran out: proceeding as though the lock had been acquired, which would put
  // the read-modify-write back outside any hold at exactly the moment another
  // process is known to be inside it.
  const h = home();
  try {
    const cache = new RequestCache(h.path);
    cache.freeze(request("busy"));
    cache.updateReceipt("busy", pending());
    const holding = join(h.path, "holding");
    const holder = spawn(process.execPath, ["--input-type=module", "-e", `
      const { lockFileDescriptor } = await import(${JSON.stringify(LEAF_MODULE)});
      const { openSync, writeFileSync } = await import("node:fs");
      const fd = openSync(${JSON.stringify(join(h.dir, "busy.lock"))}, "r+");
      const lock = lockFileDescriptor(fd);
      if (lock.kind !== "held") { console.error("holder could not take the lock: " + lock.kind); process.exit(1); }
      writeFileSync(${JSON.stringify(holding)}, "");
      await new Promise(resolve => setTimeout(resolve, 30_000));
    `], { stdio: ["ignore", "inherit", "inherit"] });
    let exited = null; let dead = false;
    holder.once("exit", code => { exited = code; dead = true; });
    try {
      const deadline = Date.now() + 10_000;
      while (!existsSync(holding)) {
        // Bounded, and it names why it gave up. A product that no longer creates
        // the lock file at all leaves the holder unable to open it, so an
        // unbounded wait here would hang on exactly the defect this test exists
        // to catch -- and a hang is not a failure, it is a missing answer.
        assert.equal(exited, null, `the holder exited (${exited}) before it took the lock`);
        assert.ok(Date.now() < deadline, "the holder never reported taking the lock");
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.throws(() => cache.updateReceipt("busy", failed()),
        error => error instanceof CacheError && error.code === "CACHE_UNAVAILABLE",
        "a receipt was updated while another process held the lock that guards it");
      assert.equal(cache.read("busy").value.lastReceipt.state, "pending",
        "the refused update wrote anyway");
    } finally {
      holder.kill("SIGKILL");
      // `exit` fires once, and a holder that could not take the lock at all --
      // which is what a product that no longer creates the lock file leaves
      // behind -- has already fired it by the time this runs. Waiting for a
      // second one would hang the run on exactly the defect this test exists to
      // catch, and a run that hangs reports nothing.
      if (!dead) await new Promise(resolve => holder.once("exit", resolve));
    }
    // Positive control: the refusal was about the hold, not a lock this code
    // leaves behind. A lock that outlived its critical section would make every
    // later update fail in exactly the same way, and the test above could not
    // tell the two apart.
    assert.equal(cache.updateReceipt("busy", failed()).lastReceipt.state, "failed");
  } finally { h.cleanup(); }
});
