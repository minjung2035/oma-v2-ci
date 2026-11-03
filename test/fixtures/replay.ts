import type { TestContext } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthContext, ProtocolLimits, Request } from "@oma/contracts";
import { Store } from "@oma/storage";
import { PublicDispatcher } from "@oma/broker/public-dispatcher";
import { errorAnswer } from "@oma/broker/replies";
import { publicFailure } from "@oma/domain/errors";
import { receiptOfOperation } from "@oma/protocol/receipt-projector";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { makeValidAgent, ALL_CAPS } from "./spec.js";
import { removeTree } from "./cleanup.js";

export const REPLAY_LIMITS: ProtocolLimits = {
  frameBytes: 262144, mailBodyBytes: 262144, subjectBytes: 512, addresses: 64,
  replyReferences: 64, contextFiles: 256, contextBytes: 8388608, bundleBytes: 268435456,
  logBytes: 1048576, batchMaxMessages: 24, idleStreamSeconds: 30, receiptWaitSeconds: 30,
};

const auth: AuthContext = { actor: "alice", incarnation: 1, role: "resident", channel: "actor",
  capabilities: new Set(ALL_CAPS), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } };

type Answer = { ok: true; result: { operation?: string; state?: string } } | { ok: false; code: string | undefined };
export function replayFixture(t: TestContext, options: { limits?: () => ProtocolLimits; isDraining?: () => boolean; assertAdmission?: () => void } = {}) {
  const root = mkdtempSync(join(tmpdir(), "oma-replay-"));
  const store = new Store(join(root, "runtime.sqlite"));
  t.after(() => { try { store.close(); } finally { removeTree(root); } });
  store.transaction(tx => {
    tx.insertAgent(makeValidAgent("principal"));
    tx.insertAgent(makeValidAgent("alice", { createdBy: "principal" }));
    tx.insertAgent(makeValidAgent("bob", { createdBy: "principal" }));
  });
  const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 64);
  const dispatcher = new PublicDispatcher({
    store: {
      listAgents: () => store.listAgents(),
      getAgent: actor => store.getAgent(actor),
      getReceipt: (actor, key) => { const operation = store.getOperation(actor, key); return operation ? receiptOfOperation(operation) : null; },
      hasOperation: (actor, key) => store.getOperation(actor, key) !== null,
    },
    mail,
    units: { statusSnapshot: () => Promise.reject(new Error("status is not part of this fixture")) },
    views: { status: () => { throw new Error("status is not part of this fixture"); } },
    lifecycle: {} as never,
    review: null,
    git: null,
    get limits() { return options.limits?.() ?? REPLAY_LIMITS; },
    waitRun: () => { throw new Error("no live run in this fixture"); },
    isDraining: () => options.isDraining?.() ?? false,
    assertAdmission: () => options.assertAdmission?.(),

    failureAnswer: (id, error) => errorAnswer(id, publicFailure(error)),
    refreshViews() {},
    readLogs: async () => { throw new Error("logs are not part of this fixture"); },
  });
  const call = async (envelope: Record<string, unknown>): Promise<Answer> => {
    const answer = await dispatcher.dispatch(auth, envelope as Request, null) as { ok: boolean; result?: { operation?: string; state?: string }; error?: { code?: string } };
    return answer.ok ? { ok: true, result: answer.result! } : { ok: false, code: answer.error?.code };
  };
  return { root, store, call };
}
