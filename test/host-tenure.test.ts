/** TUI-004/REC-007/PR-002: the object that answers "may I", and when it stops.
 *
 * Four audits found four defects -- a lease released before its engine died, a
 * delivery opened before the registration that authorised it, a repair that
 * had not happened yet, a write with no ownership at all -- and they were one
 * structure: permissions kept in loose flags, each read by whoever remembered
 * to. These tests hold the replacement to the properties the flags could not
 * keep, and each one that restates a defect comes with the control that shows
 * the test would notice if the defect came back.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { fstatSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostTenure, type FencedEngine } from "../src/runtime/host-tenure.js";
import { tryHoldSociety } from "../src/runtime/society-lease.js";

const scratch = (): string => mkdtempSync(join(tmpdir(), "oma-tenure-"));

/** flock conflicts between two open file descriptions even inside one process,
 * so this really does answer "could another `oma` take the society now". */
const takeable = (runRoot: string): boolean => {
  const other = tryHoldSociety(runRoot);
  if (other === null) return false;
  other.release();
  return true;
};

/** An engine that stops when it is told to, and one that does not. The
 * difference is the whole subject of the teardown tests. */
const engineThat = (dies: boolean): FencedEngine & { closed: number; die: () => void } => {
  let release: () => void = () => {};
  const exited = new Promise<void>(resolve => { release = resolve; });
  return {
    closed: 0,
    exited,
    close(): void { this.closed += 1; if (dies) release(); },
    die: () => { release(); },
  };
};

test("T119 a society has one tenure at a time, and it is takeable again only when that one ends", async () => {
  const root = scratch();
  try {
    const held = HostTenure.take(root);
    assert.ok(held);
    assert.equal(HostTenure.take(root), null, "two tenures over one society");
    assert.equal(takeable(root), false);
    await held.end();
    assert.equal(takeable(root), true, "the society stayed locked after its tenure ended");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T119 the fence is a live descriptor while the tenure holds, and unreadable once it does not", async () => {
  const root = scratch();
  try {
    const held = HostTenure.take(root);
    assert.ok(held);
    // Not a token or an index: a descriptor the kernel will let a child
    // inherit. If this stopped being true, every child would be started
    // without the fence and nothing else in the test suite would notice.
    assert.ok(fstatSync(held.fence).isFile());
    assert.equal(held.held, true);
    await held.end();
    assert.equal(held.held, false);
    assert.throws(() => held.fence, /소유하고 있지 않습니다/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("PR-002 delivery needs a tenure, a live broker, a registration and an engine -- all four, all current", async () => {
  const root = scratch();
  try {
    const held = HostTenure.take(root);
    assert.ok(held);
    const engine = engineThat(true);

    assert.equal(held.deliverable, false, "delivery was open before anything was true");
    held.brokerReady();
    assert.equal(held.deliverable, false, "a ready broker alone opened delivery");
    held.adopt(engine);
    assert.equal(held.deliverable, false, "an engine with no registration opened delivery");
    held.principalRegistered();
    assert.equal(held.deliverable, true, "delivery stayed shut with every term satisfied");

    // Each term withdrawn on its own shuts it again.
    held.principalUnregistered();
    assert.equal(held.deliverable, false, "a withdrawn registration left delivery open");
    held.principalRegistered();
    held.brokerLost();
    assert.equal(held.deliverable, false, "a dead broker left delivery open");
    held.brokerReady();
    held.principalRegistered();
    held.engineEnded();
    assert.equal(held.deliverable, false, "a dead engine left delivery open");
    await held.end();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("PR-002 a refused registration never opens delivery, however ready the broker is", async () => {
  // The defect verbatim: `register()` resolved on refusal and the caller went
  // on to deliver, because the only gate it consulted was the broker's
  // readiness. Readiness is now not sufficient for anything.
  const root = scratch();
  try {
    const held = HostTenure.take(root);
    assert.ok(held);
    held.adopt(engineThat(true));
    held.brokerReady();
    held.principalUnregistered();
    assert.equal(held.deliverable, false);
    await held.end();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("PR-002 a restarted broker does not inherit the registration the previous one granted", async () => {
  // A credential is minted by one broker process for one engine. A supervisor
  // that replaces the broker has replaced the authority behind every
  // credential it issued, so readiness must close delivery, not reopen it.
  const root = scratch();
  try {
    const held = HostTenure.take(root);
    assert.ok(held);
    held.adopt(engineThat(true));
    held.brokerReady();
    held.principalRegistered();
    assert.equal(held.deliverable, true);
    held.brokerLost();
    held.brokerReady();
    assert.equal(held.deliverable, false, "a new broker honoured the old broker's registration");
    held.principalRegistered();
    assert.equal(held.deliverable, true);
    await held.end();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("PR-002 a registration cannot be claimed without a live broker or a live engine", async () => {
  const root = scratch();
  try {
    const held = HostTenure.take(root);
    assert.ok(held);
    held.principalRegistered();
    assert.equal(held.deliverable, false, "a registration was accepted with no broker and no engine");
    held.brokerReady();
    held.principalRegistered();
    assert.equal(held.deliverable, false, "a registration was accepted with no engine");
    await held.end();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("TUI-004 writes are refused once the society has been given back", async () => {
  const root = scratch();
  try {
    const held = HostTenure.take(root);
    assert.ok(held);
    held.assertOwned("설정");
    await held.end();
    assert.throws(() => { held.assertOwned("설정"); }, /소유하고 있지 않습니다/);
    assert.throws(() => { held.adopt(engineThat(true)); }, /소유하고 있지 않습니다/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T119 a tenure runs one engine at a time", async () => {
  const root = scratch();
  try {
    const held = HostTenure.take(root);
    assert.ok(held);
    held.adopt(engineThat(true));
    assert.throws(() => { held.adopt(engineThat(true)); }, /one engine at a time/);
    await held.end();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("REC-007 the lease is given up after the engine is gone, not after it was asked to go", async () => {
  const root = scratch();
  try {
    const held = HostTenure.take(root);
    assert.ok(held);
    const engine = engineThat(false);
    held.adopt(engine);

    const ending = held.end();
    // `close()` has been called and returned. This is exactly the moment the
    // old teardown treated as death.
    await new Promise<void>(resolve => { setImmediate(resolve); });
    assert.equal(engine.closed, 1, "the engine was never asked to stop");
    assert.equal(takeable(root), false, "the society was handed on when the engine was only asked to stop");

    engine.die();
    await ending;
    assert.equal(takeable(root), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("REC-007 negative control: releasing on `close()` rather than on death hands the society straight on", async () => {
  // The same shape with the wait removed -- which is what the code did before
  // this change. If this control ever stops reproducing, the test above has
  // stopped being evidence: it would be passing because the engine died
  // quickly, not because anything waited for it.
  const root = scratch();
  try {
    const lease = tryHoldSociety(root);
    assert.ok(lease);
    const engine = engineThat(false);
    engine.close();
    lease.release();
    assert.equal(engine.closed, 1);
    assert.equal(takeable(root), true,
      "the control did not reproduce the defect: an unawaited teardown kept the society");
    engine.die();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("REC-007 quitting finishes even when the engine will not die, and hands the society to nobody", async () => {
  // Bounding the wait is safe only because the fence outlives the release: the
  // lease is given up here, and the society still cannot be taken, because in
  // production the engine holds an inherited descriptor onto the same open
  // file description. The bound is about how long quitting takes.
  const root = scratch();
  try {
    const held = HostTenure.take(root, 60);
    assert.ok(held);
    held.adopt(engineThat(false));
    const started = Date.now();
    await held.end();
    const took = Date.now() - started;
    assert.ok(took >= 55 && took < 5000, `the bounded wait did not bound: ${took}ms`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("REC-007 a crash path gives the society up without waiting, and asks the engine to stop first", () => {
  const root = scratch();
  try {
    const held = HostTenure.take(root, 60_000);
    assert.ok(held);
    const engine = engineThat(false);
    held.adopt(engine);
    // Synchronous on purpose: the next statement in the entrypoint is
    // `process.exit`, and anything awaited here would never run.
    held.abandon();
    assert.equal(engine.closed, 1, "the crash path left the engine running with nothing asked of it");
    assert.equal(held.held, false);
    assert.equal(held.deliverable, false);
    assert.throws(() => { held.assertOwned("설정"); }, /소유하고 있지 않습니다/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("T119 ending twice is the same as ending once", async () => {
  const root = scratch();
  try {
    const held = HostTenure.take(root);
    assert.ok(held);
    const engine = engineThat(true);
    held.adopt(engine);
    await held.end();
    await held.end();
    held.abandon();
    assert.equal(engine.closed, 1, "a second teardown reached the engine again");
    assert.equal(takeable(root), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
