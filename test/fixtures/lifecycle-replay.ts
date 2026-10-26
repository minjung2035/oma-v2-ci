import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { serializePlanIntent } from "./plan.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthContext, ProtocolLimits, ExecutionObservation } from "@oma/contracts";
import { Store } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { LifecycleModule } from "@oma/lifecycle";
import { PolicyExecution } from "./execution.js";
import { PublicDispatcher } from "@oma/broker/public-dispatcher";
import { errorAnswer } from "@oma/broker/replies";
import { publicFailure } from "@oma/domain/errors";
import { receiptOfOperation } from "@oma/protocol/receipt-projector";
import { generateOperationId } from "@oma/native/identity";
import { requestHash } from "@oma/domain/request-identity";
import { makeValidAgent, makeValidResolvedSpec, ALL_CAPS } from "./spec.js";

export type ActionKind = "agent.start" | "agent.stop";
/** Only physical systemd observations/effects are controlled. Store, decoding,
 * management authority, public dispatch and LifecycleModule are production code.
 * This fixture is not a native socket, systemd or cgroup proof.
 */
export class ObservedUnits extends PolicyExecution {
  readonly effects: Array<{ kind: "start" | "stop"; agent: string; incarnation?: number }> = [];
  active = false;
  deathKnown = true;
  failEffect = false;
  override observe(_agent: string): ExecutionObservation {
    return { activeState: this.active ? "active" : "inactive", subState: this.active ? "running" : "dead",
      result: "success", execMainStatus: 0, scope: this.active ? "/system.slice/oma-replay-a.service" : "",
      invocationId: "1".repeat(32) };
  }
  override confirmDead(_agent: string, _incarnation: number): boolean { return this.deathKnown && !this.active; }
  override start(agent: string, _explicitRepair: boolean, authorize?: () => void): void {
    authorize?.();
    this.effects.push({ kind: "start", agent });
    if (this.failEffect) throw new Error("controlled unconfirmed start");
    this.active = true;
  }
  override stop(agent: string, incarnation: number): ExecutionObservation {
    this.effects.push({ kind: "stop", agent, incarnation });
    if (this.failEffect) throw new Error("controlled unconfirmed stop");
    this.active = false;
    return this.observe(agent);
  }
}
const limits: ProtocolLimits = {
  frameBytes: 262144, mailBodyBytes: 262144, subjectBytes: 512, addresses: 64,
  replyReferences: 64, contextFiles: 256, contextBytes: 8388608, bundleBytes: 268435456,
  logBytes: 1048576, batchMaxMessages: 24, idleStreamSeconds: 30, receiptWaitSeconds: 30,
};
export function lifecycleReplayFixture() {
  const root = mkdtempSync(join(tmpdir(), "oma-action-replay-"));
  const store = new Store(join(root, "runtime.sqlite"));
  store.transaction(tx => {
    tx.insertAgent(makeValidAgent("principal"));
    tx.insertAgent(makeValidAgent("manager", { createdBy: "principal" }));
    tx.insertAgent(makeValidAgent("a", { createdBy: "manager" }));
  });
  const units = new ObservedUnits();
  const mail = createMailModule({ stateRoot: root, society: "replay" }, store, 64);
  const controls = { hasGoal: true, allowActivation: true };
  const lifecycle = createLifecycleModule(store, units, { stateRoot: root, projectGit: join(root, "project.git"), society: "replay",
    hasGoal: () => controls.hasGoal, activationAllowed: () => controls.allowActivation },
    (_parent, input) => makeValidResolvedSpec(input.name, "p", ALL_CAPS, input.from, input.brief), mail);
  const capabilities = new Set(ALL_CAPS);
  const auth: AuthContext = { actor: "manager", incarnation: 1, role: "resident", channel: "actor", capabilities,
    peer: { pid: process.pid, uid: 1000, gid: 1000 } };
  const publicStore = {
    listAgents: () => store.listAgents(), getAgent: (actor: string) => store.getAgent(actor),
    getReceipt: (actor: string, key: string) => { const operation = store.getOperation(actor, key); return operation ? receiptOfOperation(operation) : null; },
    hasOperation: (actor: string, key: string) => store.getOperation(actor, key) !== null,
  };
  const dispatcher = new PublicDispatcher({ waitRun: () => { throw new Error("no live run in this fixture"); }, store: publicStore, mail, lifecycle, review: null,
git: null,
    units: { statusSnapshot: () => Promise.reject(new Error("status is not part of the action replay fixture")) },
    views: { status: () => { throw new Error("status is not part of the action replay fixture"); } }, limits,
    isDraining: () => false, assertAdmission() {},  refreshViews() {},
    failureAnswer: (id, error) => errorAnswer(id, publicFailure(error)),
    readLogs: async () => { throw new Error("logs are not part of the action replay fixture"); } });
  return { root, store, units, lifecycle, dispatcher, auth, capabilities, controls,
    dispatch(kind: ActionKind, key: string) {
      return dispatcher.dispatch(auth, { v: 1, id: key, method: kind, request: key, params: { agent: "a" } }, null);
    },
    seedPending(kind: ActionKind, key: string, state: "pending" | "unknown" = "unknown") {
      const id = generateOperationId();
      store.transaction(tx => {
        const target = store.getAgent("a")!;
        const desired = kind === "agent.start" ? "enabled" : "stopped";
        tx.updateAgent({ name: "a", desired });
        tx.acceptOperation({ id, actor: auth.actor, requestKey: key, requestHash: requestHash(kind, { agent: "a" }), kind,
          payloadJson: JSON.stringify({ agent: "a" }),
          planJson: serializePlanIntent({ kind, agent: "a", previousIncarnation: target.incarnation, desired, remainingOperations: [] }) });
        if (state === "unknown") tx.setOperationUnknown(id);
      });
      return store.getOperationById(id)!;
    },
    close() { store.close(); rmSync(root, { recursive: true, force: true }); },
  };
}
