// AUD-19: two accepted bundle imports contend for the one native quarantine
// slot. The loser is a *known* live peer and must refuse as the transient,
// same-key busy the codebase names for a preparation in flight; only an
// unproven previous scope keeps RUN_TERMINATION_UNKNOWN. The execution owner is
// the real ExecutionCoordinator -- only the OS-level launcher/observer backend
// is scripted, so the observed slot states are the production state machine's.
import test from "node:test";
import assert from "node:assert/strict";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QuarantineImporter } from "@oma/git/quarantine";
import { ExecutionCoordinator } from "@oma/process/owned-execution";
import { acceptedFailure, acceptedFailurePolicy, publicFailure } from "@oma/domain/errors";

const WITNESS = Object.freeze({ kind: "test-scope", token: "quarantine-witness" });
const CANDIDATE = "a".repeat(40);
const EXPORT_REF = "refs/oma/input";

/** Mirrors ExecutionJournal's per-slot contract: one live reservation per slot. */
function memoryJournal() {
  const bySlot = new Map();
  let sequence = 0;
  return {
    entries: () => [...bySlot.values()],
    reserve(slot) {
      if (bySlot.has(slot)) throw new Error("previous execution scope is not retired");
      const execution = `execution-${++sequence}`;
      return {
        execution,
        publish: witness => bySlot.set(slot, { slot, execution, witness }),
        retire: () => bySlot.delete(slot),
      };
    },
    retire(slot, execution) {
      const row = bySlot.get(slot);
      if (row?.execution === execution) bySlot.delete(slot);
    },
  };
}

function coordinatorWith(journal) {
  return new ExecutionCoordinator(journal, () => ({ kind: "running", identity: WITNESS }));
}

/** A scripted native backend scope: populated until its own termination. */
function scriptedScope(result) {
  const state = { population: "populated" };
  let resolveClosed;
  const closed = new Promise(resolve => { resolveClosed = resolve; });
  return {
    witness: WITNESS,
    result,
    closed,
    population: () => state.population,
    release() {},
    terminate() { state.population = "empty"; resolveClosed(); },
    close() {},
  };
}
const liveScope = () => scriptedScope(new Promise(() => {}));
const gatedScope = (gate, observation) => scriptedScope(gate.then(() => observation));
const exitedScope = observation => scriptedScope(Promise.resolve(observation));

function observationFor(request) {
  return { kind: "exited", exitCode: 0, stdout: Buffer.from(`${request.candidate}\n`), stderr: Buffer.alloc(0),
    stdoutTruncated: false, stderrTruncated: false, signal: null, errorCode: null, elapsedMs: 1 };
}

function quarantineFixture(root, coordinator, hooks = {}) {
  const stateRoot = join(root, "state");
  mkdirSync(stateRoot, { recursive: true });
  const projectGit = join(root, "project.git");
  mkdirSync(projectGit, { recursive: true });
  const bundlePath = join(root, "input.bundle");
  writeFileSync(bundlePath, "candidate bundle bytes");
  const bundleFd = openSync(bundlePath, "r");
  const phases = [];
  const port = {
    slotState: () => coordinator.slotState("quarantine"),
    execute: async (request, authorize) => {
      phases.push(request.phase);
      const observation = await coordinator.run({ slot: "quarantine", authorize,
        launch: async () => {
          hooks.onLaunch?.(request);
          const gate = hooks.gated?.(request);
          return gate === undefined ? exitedScope(observationFor(request)) : gatedScope(gate, observationFor(request));
        } });
      if (hooks.afterPhase !== undefined) await hooks.afterPhase(request);
      return observation;
    },
  };
  const importer = new QuarantineImporter({ stateRoot, projectGit, society: "test" }, () => true, port);
  return { importer, bundleFd, stateRoot, projectGit, phases,
    import: () => importer.importBundle(bundleFd, CANDIDATE, EXPORT_REF, [], () => {}),
    flush: () => closeSync(bundleFd) };
}

function refusalOf(promise) {
  return promise.then(() => { throw new Error("importBundle unexpectedly resolved"); }, error => error);
}

test("001. A concurrent import of an accepted submit refuses as transient same-key busy", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-quarantine-busy-"));
  try {
    const coordinator = coordinatorWith(memoryJournal());
    let releaseVerify; const verifyGate = new Promise(resolve => { releaseVerify = resolve; });
    let entered; const enteredExecution = new Promise(resolve => { entered = resolve; });
    const fixture = quarantineFixture(root, coordinator, { gated: request => request.phase === "verify" ? verifyGate : undefined,
      onLaunch: request => { if (request.phase === "verify") entered(); } });

    // The first accepted submit's import is inside its verify phase: the slot
    // is owned by a live peer, and nothing of the second submit has started.
    const first = fixture.import();
    await enteredExecution;
    assert.equal(coordinator.confirmDead("quarantine"), false);
    assert.equal(coordinator.slotState("quarantine"), "busy");
    const staging = join(fixture.stateRoot, "staging");
    const before = readdirSync(staging).sort();

    // The second accepted submit reaches the same importer: known contention.
    const busy = await refusalOf(fixture.import());
    assert.equal(busy.code, "BROKER_UNAVAILABLE");
    assert.equal(busy.details?.reason, "busy");
    assert.deepEqual(readdirSync(staging).sort(), before, "busy refuses before making its own staging");
    const accepted = acceptedFailure(busy, "none");
    const policy = acceptedFailurePolicy(accepted, "accepted", "none");
    assert.equal(policy.terminal, null, "busy never settles the accepted operation failed/unknown");
    assert.equal(policy.blockScope, "none", "busy does not block the run scope");
    const reported = publicFailure(accepted);
    assert.deepEqual({ code: reported.code, retry: reported.retry, reason: reported.details?.reason },
      { code: "BROKER_UNAVAILABLE", retry: "same-key", reason: "busy" });

    // The live peer completes normally; its own import still succeeds.
    releaseVerify();
    await first;
    assert.equal(coordinator.slotState("quarantine"), "dead");
    assert.deepEqual(fixture.phases, ["verify", "import"]);
    assert.deepEqual(readdirSync(staging), [], "the completed staging is collected");
    fixture.flush();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("002. A peer taking the slot between phases refuses busy and its staging is retained", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-quarantine-busy-"));
  try {
    const coordinator = coordinatorWith(memoryJournal());
    let peerStarted = false;
    let peer;
    const fixture = quarantineFixture(root, coordinator, { afterPhase: async request => {
      if (request.phase === "verify" && !peerStarted) {
        peerStarted = true;
        peer = await coordinator.begin({ slot: "quarantine", launch: async () => liveScope(), authorize: () => {} });
      }
    } });
    assert.equal(coordinator.slotState("quarantine"), "dead");
    const busy = await refusalOf(fixture.import());
    assert.equal(busy.code, "BROKER_UNAVAILABLE");
    assert.equal(busy.details?.reason, "busy");
    assert.equal(peerStarted, true);
    assert.deepEqual(fixture.phases, ["verify"], "the import phase did not start under a live peer");
    const staging = join(fixture.stateRoot, "staging");
    assert.equal(existsSync(staging), true, "the unproven phase's staging stays owned");

    // Once the peer's death is proven, the next import collects that staging
    // and runs both phases fresh.
    await peer.stop();
    assert.equal(coordinator.slotState("quarantine"), "dead");
    await fixture.import();
    assert.deepEqual(fixture.phases, ["verify", "verify", "import"]);
    assert.deepEqual(readdirSync(staging), []);
    fixture.flush();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("003. A failed execution owner keeps the unknown fence and never reads as busy", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-quarantine-busy-"));
  try {
    const journal = memoryJournal();
    const reserve = journal.reserve.bind(journal);
    // The reservation retires, then its owner's cleanup fails: the coordinator
    // keeps the failed state, which a live peer must never be confused with.
    journal.reserve = slot => {
      const reservation = reserve(slot);
      return { ...reservation, retire: () => { reservation.retire(); throw new Error("journal retirement failed"); } };
    };
    const coordinator = coordinatorWith(journal);
    const observation = { kind: "exited", exitCode: 0, stdout: Buffer.from(`${CANDIDATE}\n`), stderr: Buffer.alloc(0),
      stdoutTruncated: false, stderrTruncated: false, signal: null, errorCode: null, elapsedMs: 1 };
    const ticket = await coordinator.begin({ slot: "quarantine", launch: async () => exitedScope(observation), authorize: () => {} });
    await assert.rejects(ticket.completion);
    assert.equal(coordinator.slotState("quarantine"), "unknown");
    assert.equal(coordinator.confirmDead("quarantine"), false);

    let executed = false;
    const fixture = quarantineFixture(root, coordinator, { onLaunch: () => { executed = true; } });
    const unknown = await refusalOf(fixture.import());
    assert.equal(unknown.code, "RUN_TERMINATION_UNKNOWN");
    assert.equal(executed, false, "a failed owner never reaches the native execution");
    assert.equal(existsSync(join(fixture.stateRoot, "staging")), false, "the fence refuses before any staging is made");
    fixture.flush();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("004. An unretired scope reservation keeps the strict unknown-termination fence", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-quarantine-busy-"));
  try {
    const journal = memoryJournal();
    const coordinator = coordinatorWith(journal);
    // A previous opening whose death was never proven: reservation retained.
    const reservation = journal.reserve("quarantine");
    reservation.publish(WITNESS);
    assert.equal(coordinator.confirmDead("quarantine"), false);
    assert.equal(coordinator.slotState("quarantine"), "unknown");

    let executed = false;
    const fixture = quarantineFixture(root, coordinator, { onLaunch: () => { executed = true; } });
    const unknown = await refusalOf(fixture.import());
    assert.equal(unknown.code, "RUN_TERMINATION_UNKNOWN");
    assert.equal(executed, false, "an unproven scope never reaches the native execution");
    assert.equal(existsSync(join(fixture.stateRoot, "staging")), false, "the fence refuses before any staging is made");
    const accepted = acceptedFailure(unknown, "none");
    const policy = acceptedFailurePolicy(accepted, "accepted", "none");
    assert.equal(policy.blockScope, "run", "the genuine fence still holds the run");
    fixture.flush();
  } finally { rmSync(root, { recursive: true, force: true }); }
});
