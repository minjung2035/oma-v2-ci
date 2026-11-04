/** Shared-owner state transitions only; these controlled scopes do not
 * manufacture kernel lifetime or Darwin qualification evidence. */
import test from "node:test";
import assert from "node:assert/strict";
import { ExecutionCoordinator } from "../dist/owned-execution.js";
const deferred = () => {
  let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const observation = { kind: "exited", exitCode: 0, stdout: Buffer.from("drained"), stderr: Buffer.alloc(0),
  stdoutTruncated: false, stderrTruncated: false, signal: null, errorCode: null, elapsedMs: 1 };
function fixture(options = {}) {
  const published = deferred(), result = deferred(), closed = deferred(), terminal = deferred(), rows = [], trace = [];
  let population = "populated", attempts = 0;
  const journal = { entries: () => rows.map(row => ({ ...row })), reserve(slot) {
    const row = { slot, execution: "controlled", witness: null }; rows.push(row);
    return { execution: row.execution, publish(witness) { row.witness = witness; trace.push("published"); published.resolve(); },
      retire() { trace.push("retired"); rows.splice(rows.indexOf(row), 1); } };
  }, retire() { throw new Error("unexpected recovery"); } };
  const scope = { witness: { kind: "controlled-scope" }, result: result.promise, closed: closed.promise,
    ...(options.prepared ? { prepared: options.prepared } : {}),
    ...(options.terminal ? { terminal: terminal.promise } : {}),
    population: () => population, release: () => trace.push("released"),
    terminate() {
      trace.push("terminated"); attempts++;
      if (attempts >= (options.sweeps ?? 1)) {
        population = "empty";
        if (options.closeOnTerminate) closed.resolve();
      }
      if (options.onTerminate) options.onTerminate();
    }, close: () => trace.push("closed") };
  const owner = new ExecutionCoordinator(journal, () => ({ kind: "unavailable" }));
  return { owner, scope, trace, rows, published, result, closed, terminal };
}

test("001. Kernel witness publication precedes pending setup and authority is checked after it", { timeout: 10000 }, async () => {
  const prepared = deferred(), f = fixture({ prepared: prepared.promise, closeOnTerminate: true });
  let authorized = false;
  const begin = f.owner.begin({ slot: "worker", launch: async () => f.scope,
    authorize() { authorized = true; assert.equal(f.rows[0].witness, f.scope.witness); f.trace.push("authorized"); } });
  await f.published.promise; assert.equal(authorized, false); assert.deepEqual(f.trace, ["published"]);
  prepared.resolve(); const ticket = await begin;
  assert.deepEqual(f.trace.slice(0, 3), ["published", "authorized", "released"]);
  f.result.resolve(observation); assert.equal(await ticket.completion, observation); assert.deepEqual(f.rows, []);
});

test("002. Revocation during setup cannot release a prepared workload", { timeout: 10000 }, async () => {
  const prepared = deferred(), f = fixture({ prepared: prepared.promise, closeOnTerminate: true });
  const refused = new Error("current authority was revoked"); let allowed = true;
  const begin = f.owner.begin({ slot: "worker", launch: async () => f.scope,
    authorize() { if (!allowed) throw refused; } });
  await f.published.promise; allowed = false; prepared.resolve();
  await assert.rejects(begin, error => error === refused);
  assert.equal(f.trace.includes("released"), false); assert.deepEqual(f.rows, []);
});

test("003. Drain stops a witnessed scope without waiting for preparation to finish", { timeout: 10000 }, async () => {
  const prepared = deferred(), f = fixture({ prepared: prepared.promise, closeOnTerminate: true });
  const begin = f.owner.begin({ slot: "worker", launch: async () => f.scope, authorize() { assert.fail("cancelled setup authorized"); } });
  const refused = assert.rejects(begin, { code: "CANCELLED_BEFORE_COMMIT" });
  await f.published.promise; await f.owner.drain(); await refused;
  assert.equal(f.trace.includes("released"), false); assert.deepEqual(f.rows, []);
});

test("004. Terminal notification stops descendants before waiting for captured stdio to drain", { timeout: 10000 }, async () => {
  const f = fixture({ terminal: true, closeOnTerminate: true });
  f.scope.terminate = () => { f.trace.push("terminated"); f.result.resolve(observation); f.closed.resolve(); };
  // The captured result can settle only after the owner requests termination.
  // Population is independently controlled by this scope fixture.
  f.scope.population = () => f.trace.includes("terminated") ? "empty" : "populated";
  const ticket = await f.owner.begin({ slot: "worker", launch: async () => f.scope, authorize() {} });
  f.terminal.resolve(); assert.equal(await ticket.completion, observation);
  assert.ok(f.trace.indexOf("terminated") < f.trace.indexOf("retired")); assert.deepEqual(f.rows, []);
});

test("005. Later member sweeps do not retire the witness before independent population and drain", { timeout: 10000 }, async () => {
  const f = fixture({ terminal: true, sweeps: 3 });
  const ticket = await f.owner.begin({ slot: "worker", launch: async () => f.scope, authorize() {} });
  const emptied = deferred();
  f.scope.population = () => {
    const empty = f.trace.filter(value => value === "terminated").length >= 3;
    if (empty) emptied.resolve();
    return empty ? "empty" : "populated";
  };
  f.terminal.resolve(); await emptied.promise;
  assert.equal(f.rows.length, 1, "unclosed stdio retains the journal witness");
  f.result.resolve(observation); f.closed.resolve(); await ticket.completion;
  assert.deepEqual(f.rows, []); assert.equal(f.owner.confirmDead("worker"), true);
});

test("006. A refused termination retains a populated scope and a later stop can reobserve it", { timeout: 10000 }, async () => {
  const f = fixture({ closeOnTerminate: true }), terminate = f.scope.terminate;
  const ticket = await f.owner.begin({ slot: "worker", launch: async () => f.scope, authorize() {} });
  f.scope.terminate = () => { throw new Error("kernel control refused"); };
  await assert.rejects(ticket.stop(), { code: "RUN_TERMINATION_UNKNOWN" });
  assert.equal(f.rows.length, 1); assert.equal(f.owner.slotState("worker"), "unknown");
  assert.equal(f.trace.includes("retired"), false);
  f.scope.terminate = terminate; await ticket.stop(); f.result.resolve(observation);
  assert.equal(await ticket.completion, observation); assert.deepEqual(f.rows, []);
});

test("007. An older result completing after resource return cannot settle its slot's replacement", { timeout: 10000 }, async () => {
  const first = fixture({ terminal: true, closeOnTerminate: true }), next = fixture({ closeOnTerminate: true });
  const old = await first.owner.begin({ slot: "worker", launch: async () => first.scope, authorize() {} });
  first.terminal.resolve(); await old.stop(); assert.deepEqual(first.rows, []);
  const current = await first.owner.begin({ slot: "worker", launch: async () => next.scope, authorize() {} });
  first.result.resolve(observation); await old.completion;
  assert.equal(first.owner.slotState("worker"), "busy"); assert.equal(first.rows.length, 1);
  assert.equal(next.trace.includes("terminated"), false, "old completion must not terminate the replacement");
  next.result.resolve(observation); await current.completion; assert.deepEqual(first.rows, []);
});

test("008. Setup completion after terminal cannot authorize while resource return is still pending", { timeout: 10000 }, async () => {
  const prepared = deferred(), terminating = deferred(), f = fixture({ terminal: true, prepared: prepared.promise });
  const terminate = f.scope.terminate;
  f.scope.terminate = () => { terminate(); terminating.resolve(); };
  const begin = f.owner.begin({ slot: "worker", launch: async () => f.scope, authorize() { f.trace.push("authorized"); } });
  const answer = begin.then(() => null, error => error);
  await f.published.promise; f.terminal.resolve(); await terminating.promise;
  prepared.resolve(); await new Promise(setImmediate);
  const authorized = f.trace.includes("authorized"), released = f.trace.includes("released");
  f.result.resolve(observation); f.closed.resolve();
  assert.equal((await answer)?.code, "CANCELLED_BEFORE_COMMIT");
  assert.equal(authorized, false); assert.equal(released, false); assert.deepEqual(f.rows, []);
});

test("009. Child observations can be retained only while the admitted execution still owns its scope", async () => {
  const f = fixture({ closeOnTerminate: true }); let acquisitions = 0, returns = 0;
  const pin = Object.freeze({ pid: 123, uid: 456, gid: 789, alive: () => true, close: () => { returns++; } });
  f.scope.pinChild = () => { acquisitions++; return pin; };
  const ticket = await f.owner.begin({ slot: "child", launch: async () => f.scope, authorize() {} });
  assert.equal(ticket.pinChild(), pin); assert.equal(acquisitions, 1);
  f.result.resolve(observation); await ticket.completion;
  assert.throws(() => ticket.pinChild(), { code: "RUN_TERMINATION_UNKNOWN" });
  assert.equal(acquisitions, 1, "a retired ticket must not invoke a backend acquisition");
  pin.close(); assert.equal(returns, 1); assert.deepEqual(f.rows, []);
});

test("010. Losing scope ownership during child acquisition returns the new pin and refuses it", async () => {
  const f = fixture({ closeOnTerminate: true }); let returned = 0;
  f.scope.pinChild = () => { f.scope.terminate(); return { pid: 123, uid: 456, gid: 789,
    alive: () => true, close: () => { returned++; } }; };
  const ticket = await f.owner.begin({ slot: "child", launch: async () => f.scope, authorize() {} });
  assert.throws(() => ticket.pinChild(), { code: "RUN_TERMINATION_UNKNOWN" }); assert.equal(returned, 1);
  f.result.resolve(observation); await ticket.completion; assert.deepEqual(f.rows, []);
});
