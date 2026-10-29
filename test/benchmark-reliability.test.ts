/** Production scheduling/mail owners with controlled execution outcomes; no provider or native sandbox qualification. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthContext, PreparedBatch, RunLease } from "@oma/contracts";
import type { InternalMailPort } from "@oma/broker/ports";
import type { Broker } from "@oma/broker";
import { setImmediate as nextTurn } from "node:timers/promises";
import { Store } from "@oma/storage";
import { ResidentRuntime } from "@oma/process/resident-runtime";
import type { ExecutionTicket } from "@oma/process/owned-execution";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { createReconcileModule } from "#oma-test/app/broker/reconcile-composition";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { ViewsModule } from "#oma-test/app/views";
import { runnerReceiptPathAt, runnerViewPathAt } from "@oma/domain/paths";
import { ALL_CAPS, makeValidAgent, makeValidResolvedSpec, withWorkerCapacity } from "./fixtures/spec.js";
import { testBroker } from "./helpers/broker-fixture.js";
import { TEST_VIEW_LIMITS } from "./fixtures/limits.js";

for (const arrival of ["after-exit", "before-exit", "interrupted-before-open"] as const)
  test(`wait scheduling: ${arrival} preserves fresh-work and redelivery ownership`, async () => {
    const root = mkdtempSync(join(tmpdir(), "oma-wait-scheduling-"));
    const store = new Store(join(root, "runtime.sqlite"), 5, { society: "demo" });
    store.transaction(tx => { tx.insertAgent(makeValidAgent("principal")); tx.insertAgent(makeValidAgent("alice")); });
    const runs: { finish(): void; ticket: ExecutionTicket<string> }[] = [];
    let broker: Broker | undefined;
    const runtime = new ResidentRuntime<string>({
      references: () => ({ profile: "p", modelProfile: "md" }), incarnation: actor => store.getAgent(actor)?.incarnation ?? null,
      confirmDead: () => runs.every(run => run.ticket.population() === "empty"), revoke: () => {},
      hint: () => broker?.hintWork(), failure: error => { throw error; },
      begin: async (_actor, _references, authorize, prepared) => {
        const execution = String(runs.length + 1).padStart(32, "0");
        const completion = Promise.withResolvers<Awaited<ExecutionTicket<string>["completion"]>>();
        let populated = true;
        prepared(execution, execution); authorize();
        const finish = () => { populated = false; completion.resolve({ kind: "exited", exitCode: 0,
          signal: null, errorCode: null, elapsedMs: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), stdoutTruncated: false, stderrTruncated: false }); };
        const ticket: ExecutionTicket<string> = { execution, witness: execution, completion: completion.promise,
          population: () => populated ? "populated" : "empty", stop: async () => { finish(); } };
        runs.push({ finish, ticket }); return ticket;
      },
    }, () => 0);
    const units = Object.assign(runtime, { bindRunRevoker: () => {}, bindIncarnationReader: () => {}, scopeRoot: () => null, runnerAlive: () => false,
      readLogs: async () => ({ text: "", truncated: false, observedAtMs: 0 }) });
    const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 64, 24, TEST_VIEW_LIMITS, () => broker?.hintWork());
    const paths = { stateRoot: root, projectGit: join(root, "project.git"), society: "demo", hasGoal: () => true, activationAllowed: () => true };
    const lifecycle = createLifecycleModule(store, units, paths,
      withWorkerCapacity((_parent, input) => makeValidResolvedSpec(input.name)), mail);
    const reconcile = createReconcileModule(store, mail, null, null, units, lifecycle, paths);
    broker = testBroker({ store, mail, units, lifecycle, reconcile, git: null, reviews: null,
      views: new ViewsModule(store, root, "demo", "p"), paths: { ...paths, runRoot: join(root, "run") } });
    const owner = broker as unknown as { openRun(actor: string, invocation: string): Promise<RunLease>;
      internalDispatcher: { deps: { mail: InternalMailPort } } };
    const auth = (actor: "principal" | "alice"): AuthContext => ({ actor, role: actor === "principal" ? "principal" : "resident",
      incarnation: store.getAgent(actor)!.incarnation, channel: actor === "principal" ? "host" : "actor",
      capabilities: new Set(ALL_CAPS), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } });
    const send = (key: string) => mail.send(auth("principal"), key, { to: ["alice"], subject: key, kind: "message", body: `mail ${key}` });
    const prepare = async (): Promise<PreparedBatch> => {
      await owner.openRun("alice", runtime.observe("alice").invocationId);
      const batch = await owner.internalDispatcher.deps.mail.prepare(auth("alice")); assert.ok(batch); return batch;
    };
    const wait = async () => {
      const answer = await broker!.dispatch(auth("alice"), { v: 1, id: "wait", method: "agent.wait", params: {} }, null);
      assert.ok("ok" in answer); assert.equal(answer.ok, true);
    };
    const drain = async () => { await nextTurn(); await reconcile.sweep(); };
    try {
      await broker.start(); await send("A"); await drain();
      assert.equal(runs.length, 1);
      const a = await prepare(), original = store.getBatch(a.id);
      await wait();
      if (arrival !== "after-exit") { await send("B"); await wait(); }
      runs[0]!.finish(); await drain();
      if (arrival === "after-exit") {
        for (let i = 0; i < 12; i++) { broker.hintWork(); await drain(); }
        assert.equal(runs.length, 1, "unchanged IDs and repeated wake hints must not start the waited work");
        await send("B"); await drain();
      }
      assert.equal(runs.length, 2, "fresh work must resume, including mail accepted before the waiting scope exits");
      if (arrival === "interrupted-before-open") {
        await runtime.stop("alice", store.getAgent("alice")!.incarnation);
        await runtime.start("alice", true);
        assert.equal((await prepare()).id, a.id, "explicit start cannot inherit an unleased automatic invocation's fresh-first policy");
        return;
      }
      const b = await prepare(); assert.notEqual(a.id, b.id); assert.match(b.notice, /subject=B/);
      assert.match(readFileSync(join(runnerViewPathAt(root, "alice"), "inbox.md"), "utf8"), new RegExp(b.messageIds[0]!));
      assert.deepEqual(store.getBatch(a.id), original, "fresh delivery must not rewrite or complete the waited batch");
      await wait(); runs[1]!.finish(); await drain();
      for (let i = 0; i < 12; i++) { broker.hintWork(); await drain(); }
      assert.equal(runs.length, 2); assert.equal(runtime.startLimitStatus("alice"), null);
      for (const batch of [a, b]) {
        assert.equal(existsSync(runnerReceiptPathAt(root, "alice", batch.id)), false);
        const delivery = store.getDelivery(batch.messageIds[0]!, "alice")!;
        assert.equal(delivery.presented, 0); assert.equal(delivery.acknowledged, 0);
      }
      await runtime.start("alice", true);
      assert.equal((await prepare()).id, a.id, "explicit start keeps oldest-first redelivery");
      await wait(); runs[2]!.finish(); await drain();
      const recovered = createReconcileModule(store, mail, null, null, units, lifecycle, paths);
      await recovered.sweep();
      // Recovery has no inherited wait/deferred selection, even though both batches remain prepared.
      assert.equal(recovered.deferredWork("alice", store.getAgent("alice")!.incarnation), undefined);
      assert.equal((await mail.prepare(auth("alice")))!.id, a.id);
      assert.equal(store.preparedBatches("alice").length, 2);
    } finally {
      broker.closeAdmission(); await runtime.close(); await broker.drainAndClose(); rmSync(root, { recursive: true, force: true });
    }
  });
