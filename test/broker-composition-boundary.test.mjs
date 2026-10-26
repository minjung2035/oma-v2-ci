import * as nodePath from "node:path";
import { projectInternalPeers } from "@oma/broker/internal-dispatcher";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import ts from "typescript";

function loadComposition() {
  const source = readFileSync(
    new URL("../apps/oma/src/broker/composition.ts", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const projectorCalls = [], inboxReads = [];
  const exports = {};
  new Script(compiled.outputText, {
    filename: "broker-composition.cjs",
  }).runInNewContext({
    exports,
    require(name) {
      if (name === "node:path") return nodePath;
      if (name === "@oma/storage/directory") return { listOwnedDirectory: (path, options) => { assert.equal(options.required, true); inboxReads.push(path); return [{ name: "message" }]; } };
      assert.equal(
        name,
        "@oma/protocol/receipt-projector",
        `unexpected composition dependency: ${name}`,
      );
      return {
        receiptOfOperation: (operation) => {
          projectorCalls.push("project");
          return { receiptFor: operation.id };
        },
      };
    },
  });
  return { ...exports, projectorCalls, inboxReads };
}

function fixture() {
  const calls = [];
  const state = {
    agents: [
      {
        name: "alice",
        incarnation: 2,
        desired: "enabled",
        specJson: "{}",
        secret: "not-for-dispatch",
      },
    ],
    operation: { id: "operation-1" },
  };
  const store = {
    listAgents() {
      calls.push("listAgents");
      return state.agents;
    },
    // WP23.03: parameter checks read names only.
    agentNames() {
      calls.push("agentNames");
      return state.agents.map((agent) => agent.name);
    },
    getAgent(actor) {
      calls.push(`getAgent:${actor}`);
      return state.agents.find((agent) => agent.name === actor) ?? null;
    },
    getOperation(actor, key) {
      calls.push(`getOperation:${actor}:${key}`);
      return state.operation;
    },
    pendingDeliveryCount() {
      calls.push("pendingDeliveryCount");
      return 2;
    },
    getBatch() {
      calls.push("getBatch");
      return { agent: "alice" };
    },
    preparedBatches() {
      calls.push("preparedBatches");
      return [{ id: "batch-1" }];
    },
  };
  const mail = {
    send() {
      calls.push("mail.send:original");
      return Promise.resolve("mail");
    },
    prepare() {
      calls.push("mail.prepare");
      return Promise.resolve(null);
    },
    complete() {
      calls.push("mail.complete");
      return Promise.resolve();
    },
    moveToCur() {
      calls.push("mail.moveToCur");
      return 1;
    },
    reconcilePending() {
      calls.push("mail.reconcilePending");
      return Promise.resolve({ examined: 0, repaired: 0, remaining: 0 });
    },
  };
  // WP23: the public port sees the broker's shared status refresh only.
  const units = {
    request() {
      calls.push("status.request");
      return Promise.resolve({ observedAtMs: 1, units: new Map(), failure: null });
    },
  };
  const views = {
    status() {
      calls.push("views.status");
      return [];
    },
  };
  const lifecycle = {
    setSociety() { calls.push("lifecycle.setSociety"); return "society"; },
    create() {},
    start() {},
    stop() {},
    ack() {},
    follow() {},
  };
  const reviews = {
      record: (...args) => { calls.push(["attest.record", ...args]); return "attestation"; },
      store: { privateWriter: true },
      status(...args) { calls.push(["review.status", ...args]); return "review-status"; },
  };
  const git = {
    knownRefs() {
      calls.push("git.knownRefs");
      return { main: "main", published: [] };
    },
    isPublished() {
      calls.push("git.isPublished");
      return false;
    },
    submit() {
      calls.push("git.submit");
      return Promise.resolve("submit");
    },
    integrate() {
      calls.push("git.integrate");
      return Promise.resolve("integrate");
    },
    publishContext() {
      calls.push("git.publishContext");
      return Promise.resolve("context");
    },
  };
  return { calls, state, store, mail, units, views, lifecycle, git, reviews };
}

test("P18 public composition exposes only projected capabilities and keeps lookups live", async () => {
  const { createPublicDispatchPorts, projectorCalls } = loadComposition();
  const { calls, state, store, mail, units, views, lifecycle, git, reviews } = fixture();
  const ports = createPublicDispatchPorts(
    store,
    mail,
    units,
    views,
    lifecycle,
    git,
    reviews,
    { frameBytes: 1 },
  );

  assert.deepEqual(Object.keys(ports).sort(), [
    "git",
    "lifecycle",
    "limits",
    "mail",
    "review",
    "store",
    "units",
    "views",
  ]);
  assert.notEqual(ports.store, store);
  assert.deepEqual(Object.keys(ports.store).sort(), [
    "getAgent",
    "getReceipt",
    "hasOperation",
    "listAgents",
  ]);
  assert.deepEqual(Object.keys(ports.mail), ["send"]);
  assert.deepEqual(Object.keys(ports.units), ["statusSnapshot"]);
  assert.deepEqual(Object.keys(ports.views), ["status"]);
  assert.deepEqual(Object.keys(ports.lifecycle).sort(), [
    "ack",
    "create",
    "follow",
    "setSociety",
    "start",
    "stop",
  ]);
  assert.deepEqual(Object.keys(ports.git).sort(), [
    "integrate",
    "isPublished",
    "knownRefs",
    "publishContext",
    "submit",
  ]);

  assert.equal(ports.review === reviews, false, "the concrete owner must not escape through a nested port");
  assert.deepEqual(Object.keys(ports.review).sort(), ["record", "status"]);
  const auth = { actor: "alice" }, input = { kind: "review", name: "merge-00000000-0000-4000-8000-000000000000", body: "review" };
  assert.equal(await ports.review.record(auth, "key", input), "attestation");
  assert.deepEqual(calls.pop(), ["attest.record", auth, "key", input]);
  assert.equal(ports.review === reviews, false, "the review owner must not escape through a nested port");
  assert.deepEqual(Object.keys(ports.review).sort(), ["record", "status"]);
  assert.equal(await ports.review.status(auth, "oma_merge/cand", 16, "r1"), "review-status");
  assert.deepEqual(calls.pop(), ["review.status", auth, "oma_merge/cand", 16, "r1"]);
  assert.equal(ports.lifecycle.setSociety({}, "closed", "request"), "society");
  assert.equal(calls.pop(), "lifecycle.setSociety");
  const view = ports.store.getAgent("alice");
  assert.deepEqual(Object.keys(view).sort(), [
    "desired",
    "incarnation",
    "name",
    "specJson",
  ]);
  assert.equal(view.name, "alice");
  assert.equal(view.incarnation, 2);
  assert.equal(view.desired, "enabled");
  assert.equal(view.specJson, "{}");
  assert.equal(view.secret, undefined);
  assert.notEqual(view, state.agents[0]);
  state.agents[0].incarnation = 3;
  assert.equal(ports.store.getAgent("alice").incarnation, 3);
  assert.equal(ports.store.listAgents()[0].name, "alice");
  assert.equal(Object.keys(ports.store.listAgents()[0]).length, 1);

  calls.length = 0;
  projectorCalls.length = 0;
  assert.deepEqual(ports.store.getReceipt("alice", "key"), {
    receiptFor: "operation-1",
  });
  assert.equal(calls[0], "getOperation:alice:key");
  assert.equal(projectorCalls[0], "project");
  assert.equal(ports.store.hasOperation("alice", "key"), true);
  const originalSend = mail.send;
  mail.send = () => Promise.resolve("live");
  assert.equal(await ports.mail.send({}, "key", {}), "live");
  assert.equal(calls.includes("mail.send:original"), false);
  mail.send = originalSend;
});

test("P18 internal composition exposes narrow live capabilities without concrete owners", () => {
  const { createInternalDispatchDataPorts, inboxReads } = loadComposition();
  const { calls, store, mail } = fixture();
  const peers = {
    requireRunnerPeer() {},
    requireHostUnit() {},
    runnerActor() {
      return "alice";
    },
    runnerAuth() {
      return {};
    },
  };
  const ports = { ...createInternalDispatchDataPorts(store, mail, "/state"), peers: projectInternalPeers(peers) };

  assert.deepEqual(Object.keys(ports).sort(), [
    "mail",
    "peers",
    "store",
  ]);
  assert.notEqual(ports.store, store);
  assert.deepEqual(Object.keys(ports.store).sort(), [
    "getAgentIdentity",
    "getBatchAgent",
    "pendingDeliveryCount",
    "preparedBatchIds",
  ]);
  assert.deepEqual(Object.keys(ports.mail).sort(), [
    "complete",
    "moveToCur",
    "prepare",
  ]);
  assert.equal(ports.principalInboxNewEntries, undefined, "retired host relay has no filesystem capability");
  assert.deepEqual(inboxReads, []);
  assert.notEqual(ports.peers, peers);
  assert.deepEqual(Object.keys(ports.peers).sort(), ["requireRunnerPeer", "runnerActor", "runnerAuth"]);

  const identity = ports.store.getAgentIdentity("alice");
  assert.equal(identity.incarnation, 2);
  assert.equal(ports.store.pendingDeliveryCount("alice"), 2);
  assert.equal(ports.store.getBatchAgent("batch-1"), "alice");
  assert.equal(ports.store.preparedBatchIds("alice")[0], "batch-1");
  assert.equal(calls.includes("pendingDeliveryCount"), true);
});
