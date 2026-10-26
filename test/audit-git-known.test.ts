import test from "node:test";
import assert from "node:assert/strict";
import type { AuthContext } from "@oma/contracts";
import { PublicDispatcher } from "@oma/broker/public-dispatcher";
import { decodeRpcReply } from "@oma/protocol/response-codec";
import { encodeFrame } from "@oma/protocol/frame";
import { makeValidAgent } from "./fixtures/spec.js";

function fixture(frameBytes: number, main: string, published: string[]) {
  const unused = (): never => {
    throw new Error("unexpected fixture effect");
  };
  const dispatcher = new PublicDispatcher({ waitRun: () => { throw new Error("no live run in this fixture"); },
    store: {
      listAgents: () => [{ name: "a" }],
      getAgent: () => makeValidAgent("a"),
      hasOperation: unused,
      getReceipt: unused,
    },
    mail: { send: async () => unused() },
    units: { statusSnapshot: unused },
    views: { status: unused },
    lifecycle: {
      create: async () => unused(),
      start: unused,
      stop: unused,
      ack: unused,
      follow: unused,
    },
    review: null,
    git: {
      knownRefs: () => ({ main, published }),
      isPublished: unused,
      submit: async () => unused(),
      integrate: async () => unused(),
      publishContext: async () => unused(),
    },
    limits: {
      frameBytes,
      mailBodyBytes: 262144,
      subjectBytes: 512,
      addresses: 64,
      replyReferences: 64,
      contextFiles: 256,
      contextBytes: 8388608,
      bundleBytes: 268435456,
      logBytes: 1048576,
      batchMaxMessages: 24,
      idleStreamSeconds: 60,
      receiptWaitSeconds: 60,
    },
    isDraining: () => false,
    assertAdmission() {},

    refreshViews() {},
    readLogs: async () => unused(),
    failureAnswer(_id, error) {
      throw error;
    },
  });
  const auth: AuthContext = {
    actor: "a",
    incarnation: 1,
    role: "resident",
    channel: "actor",
    capabilities: new Set(),
    peer: { pid: process.pid, uid: 1000, gid: 1000 },
  };
  return async (candidate: string, id = "known") => {
    const params = { candidate };
    const response = await dispatcher.dispatch(
      auth,
      { v: 1, id, method: "git.known", params },
      null,
    );
    assert.ok(encodeFrame(response).length - 4 <= frameBytes);
    const decoded = decodeRpcReply("git.known", response, id, params);
    assert.ok(decoded.ok);
    return decoded.result;
  };
}

test("CLI submit: git.known includes current main and deduplicates published tips", async () => {
  const main = "a".repeat(40);
  const published = "b".repeat(40);
  const query = fixture(4096, main, [main, published, published]);
  assert.deepEqual(await query(main), {
    hasCandidate: true,
    prerequisites: [main, published],
  });
  assert.deepEqual(await query("c".repeat(40)), {
    hasCandidate: false,
    prerequisites: [main, published],
  });
});

test("CLI submit: git.known remains frame-bounded without hiding candidate presence", async () => {
  const main = "a".repeat(64);
  const published = Array.from({ length: 100 }, (_, index) =>
    index.toString(16).padStart(64, "0"),
  );
  const result = await fixture(
    256,
    main,
    published,
  )(published.at(-1)!, 'known"\\');
  assert.equal(result.hasCandidate, true);
  assert.equal(result.prerequisites[0], main);
  assert.ok(result.prerequisites.length < published.length);
  assert.equal(result.prerequisites.includes(published.at(-1)!), false);
});
