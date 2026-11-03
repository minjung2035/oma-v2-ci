/** AUD-09: a roster page whose boundary falls on the Principal row emits
 * `next: "principal"`. The same API must accept that cursor back -- through the
 * dispatcher's request validation, and through the roster tool that consumes
 * the page it returned -- while every slot that names a controllable Worker
 * keeps refusing the Principal. The registry, the projection, the page
 * encoder, the request decoder and the tool are the real ones; only the
 * frame budget is tightened, and only to put the boundary on that row. */
import "#oma-test/app/runtime/client-preload";
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Actor, AgentStatus, AuthContext, ExecutionObservation } from "@oma/contracts";
import type { StatusSnapshot } from "@oma/contracts/runtime";
import { Store } from "@oma/storage";
import { PublicDispatcher } from "@oma/broker/public-dispatcher";
import { errorAnswer } from "@oma/broker/replies";
import { publicFailure } from "@oma/domain/errors";
import { REFERENCE_PROTOCOL_LIMITS } from "@oma/domain/protocol-limits";
import { decodePublicParams } from "@oma/protocol/methods";
import { statusPage } from "@oma/protocol/status-page";
import { Client } from "@oma/client";
import { ViewsModule } from "#oma-test/app/views";
import { makeValidAgent } from "./fixtures/spec.js";
import { PolicyExecution } from "./fixtures/execution.js";

/** The registry order the Store projects: the Principal row sorts between the
 * first Resident and the rest, which is what puts a page boundary on it. */
const NAMES = ["alice", "principal", "w2", "zulu"];
const observedAtMs = 1_728_224_000_000;
const creation = { capability: false, childProfile: null, childHasMailSend: null, maxWorkers: 6, workerCount: 3, observedAtMs };
const auth: AuthContext = { actor: "alice", incarnation: 1, role: "resident", channel: "actor",
  capabilities: new Set(), peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } };

type Answer = { readonly ok: true; readonly result: { readonly agents: readonly AgentStatus[]; readonly next?: string } }
  | { readonly ok: false; readonly error: { readonly code: string } };

interface Society {
  readonly root: string;
  readonly rows: readonly AgentStatus[];
  /** The exact size of the page this roster emits up to and including the
   * Principal row, for one request id: the Principal row is the last row that
   * fits the budget, so the page boundary falls on it. */
  readonly budgetFor: (id: string) => number;
  readonly dispatcher: (frameBytes: number) => PublicDispatcher;
}

async function society(t: TestContext): Promise<Society> {
  const root = mkdtempSync(join(tmpdir(), "oma-status-cursor-"));
  const store = new Store(join(root, "runtime.sqlite"), 5, { society: "demo" });
  store.transaction(tx => {
    tx.insertAgent(makeValidAgent("principal"));
    for (const name of ["alice", "w2", "zulu"]) tx.insertAgent(makeValidAgent(name, { createdBy: "principal" }));
  });
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const execution = new PolicyExecution();
  const units: ReadonlyMap<Actor, ExecutionObservation | "no-unit"> = new Map(NAMES.map(name =>
    [name, name === "principal" ? "no-unit" : execution.observe(name)] as [Actor, ExecutionObservation | "no-unit"]));
  const snapshot: StatusSnapshot = { observedAtMs, units, failure: null };
  const views = new ViewsModule(store, root, "demo", "p");
  const rows = await views.statusOf(snapshot);
  const boundary = rows.findIndex(value => value.agent === "principal") + 1;
  assert.ok(boundary > 0 && boundary < rows.length,
    `the fixture roster has no Principal row to page at: ${rows.map(value => value.agent).join(",")}`);
  const upToPrincipal = rows.slice(0, boundary);
  const unused = (): never => { throw new Error("a status read performed an effect"); };
  return {
    root,
    rows,
    budgetFor: id => Buffer.byteLength(JSON.stringify({ v: 1, id, ok: true,
      result: { observedAtMs, agents: upToPrincipal, creation, next: "principal" } })),
    dispatcher: frameBytes => new PublicDispatcher({
      waitRun: unused,
      store: {
        listAgents: () => store.agentNames().map(name => ({ name })),
        getAgent: actor => {
          const agent = store.getAgent(actor);
          return agent === null ? null
            : { name: agent.name, incarnation: agent.incarnation, desired: agent.desired, specJson: agent.specJson };
        },
        getReceipt: unused,
        hasOperation: unused,
      },
      mail: { send: async () => unused() },
      units: { statusSnapshot: async () => snapshot },
      views: { status: (agent, state) => views.statusOf(state, agent) },
      lifecycle: { creation: () => creation, create: async () => unused(), start: unused, stop: unused, ack: unused, follow: unused },
      git: null,
      review: null,
      limits: { ...REFERENCE_PROTOCOL_LIMITS, frameBytes },
      isDraining: () => false,
      assertAdmission() {},
      refreshViews() {},
      failureAnswer: (id, error) => errorAnswer(id, publicFailure(error)),
      readLogs: async () => ({ text: "", truncated: false, observedAtMs }),
    }),
  };
}

const call = (dispatcher: PublicDispatcher, request: Record<string, unknown>): Promise<Answer> =>
  dispatcher.dispatch(auth, request as never, null) as Promise<Answer>;

const namesOf = (rows: readonly AgentStatus[]): string[] => rows.map(value => value.agent);

test("001. A real status page that ends at the Principal row continues from its cursor", async t => {
  const s = await society(t);
  assert.deepEqual(namesOf(s.rows), NAMES, "the registry projection moved the Principal row");
  const whole = await call(s.dispatcher(REFERENCE_PROTOCOL_LIMITS.frameBytes),
    { v: 1, id: "whole", method: "status.get", params: {} });
  assert.equal(whole.ok, true);
  if (whole.ok) assert.deepEqual(namesOf(whole.result.agents), NAMES, "the roomy page is not the whole roster");

  const paged = s.dispatcher(s.budgetFor("page-1"));
  const first = await call(paged, { v: 1, id: "page-1", method: "status.get", params: {} });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.deepEqual(namesOf(first.result.agents), ["alice", "principal"]);
  assert.equal(first.result.next, "principal");
  // The cursor the page itself emitted, sent back by the next request.
  const rest = await call(paged, { v: 1, id: "page-2", method: "status.get", params: { after: first.result.next } });
  assert.equal(rest.ok, true, JSON.stringify(rest));
  if (!rest.ok) return;
  assert.deepEqual(namesOf(rest.result.agents), ["w2", "zulu"]);
  assert.equal(rest.result.next, undefined);

  // A roster row can also be selected by name, and a name the roster cannot
  // carry is still refused -- including the display form tools resolve before
  // the wire.
  const one = await call(paged, { v: 1, id: "principal-row", method: "status.get", params: { agent: "principal" } });
  assert.equal(one.ok, true);
  if (one.ok) assert.deepEqual(namesOf(one.result.agents), ["principal"]);
  for (const after of ["Principal", "broker", "principal@demo.oma.invalid", ""]) {
    const refused = await call(paged, { v: 1, id: "malformed", method: "status.get", params: { after } });
    assert.equal(refused.ok, false, `${JSON.stringify(after)} was accepted as a roster cursor`);
    if (!refused.ok) assert.equal(refused.error.code, "INVALID_REQUEST");
  }

  // Slots that name a controllable Worker keep refusing the Principal.
  const logs = await call(paged, { v: 1, id: "logs", method: "logs.read", params: { agent: "principal", sinceSeconds: 60 } });
  assert.equal(logs.ok, false, "logs.read accepted the Principal as a Worker");
  if (!logs.ok) assert.equal(logs.error.code, "INVALID_REQUEST");
  const start = await call(paged, { v: 1, id: "start", method: "agent.start", params: { agent: "principal" }, request: "principal-start" });
  assert.equal(start.ok, false, "agent.start accepted the Principal as a Worker");
  if (!start.ok) assert.equal(start.error.code, "INVALID_REQUEST");
});

test("002. The typed roster client consumes the Principal cursor its own page returned", async t => {
  const s = await society(t);
  const socket = join(s.root, "control.sock");
  const frames: { method?: string }[] = [];
  const server = createServer(connection => {
    let pending = Buffer.alloc(0);
    connection.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 4 && pending.length >= 4 + pending.readUInt32BE(0)) {
        const length = pending.readUInt32BE(0);
        const frame = JSON.parse(pending.subarray(4, 4 + length).toString("utf8")) as { id?: string; method?: string; params?: Record<string, unknown> };
        pending = pending.subarray(4 + length);
        frames.push(frame);
        const id = typeof frame.id === "string" ? frame.id : "x";
        const decoded = frame.method === "status.get"
          ? decodePublicParams("status.get", frame.params ?? {}, { limits: REFERENCE_PROTOCOL_LIMITS }) : null;
        const rows = decoded === null ? [] : decoded.agent === undefined ? s.rows : s.rows.filter(value => value.agent === decoded.agent);
        // The peer is a status service, not an echo: it answers with the broker's
        // own page encoder, and refuses exactly what the wire refuses.
        const answer = decoded !== null && rows.length > 0
          ? statusPage(id, observedAtMs, rows, s.budgetFor(id), creation, decoded.after)
          : { v: 1, id, ok: false, error: { code: "INVALID_REQUEST", message: "invalid params for status.get", retry: "never" } };
        const bytes = Buffer.from(JSON.stringify(answer));
        const head = Buffer.alloc(4);
        head.writeUInt32BE(bytes.length, 0);
        connection.write(Buffer.concat([head, bytes]));
      }
    });
    connection.on("error", () => {});
  });
  const listening = Promise.withResolvers<void>();
  server.listen(socket, () => listening.resolve());
  await listening.promise;
  t.after(() => {
    const closed = Promise.withResolvers<void>();
    server.close(() => closed.resolve());
    return closed.promise;
  });
  const client = new Client({ cwd: s.root, env: { HOME: s.root, OMA_SOCKET: socket } });
  const page = async (params: Record<string, unknown>) => client.query("status.get", params);

  const first = await page({});
  assert.deepEqual(namesOf(first.agents), ["alice", "principal"]);
  assert.equal(first.next, "principal");
  // The cursor that page returned is what the next request is made with: the
  // tool must carry it to the service and show the page after the Principal row.
  const rest = await page({ after: first.next! });
  assert.deepEqual(namesOf(rest.agents), ["w2", "zulu"]);
  assert.equal(rest.next, undefined);

  assert.deepEqual(frames.map(frame => frame.method), ["status.get", "status.get"]);
});
