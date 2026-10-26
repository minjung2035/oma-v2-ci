import { testBroker } from "./helpers/broker-fixture.js";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
/** Stream bodies transfer from connection reception to accepted execution.
 * Caller close cannot destroy an execution-owned body; unfinished reception
 * cleans its private copy. Real Broker/RpcConnection, spool, Git and Store. */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProtocolLimits } from "@oma/contracts";
import { Store } from "@oma/storage";
import { Broker } from "@oma/broker";
import { PolicyExecution } from "./fixtures/execution.js";
import { ViewsModule } from "#oma-test/app/views";
import { LifecycleModule } from "@oma/lifecycle";
import { StoreError } from "@oma/domain/errors";
import { encodeFrame } from "@oma/protocol/frame";
import { sha256Hex } from "@oma/domain/canonical-json";
import { ALL_CAPS, makeValidAgent, makeValidResolvedSpec } from "./fixtures/spec.js";
import { removeTree } from "./fixtures/cleanup.js";
import { gitAuth, gitFixture, seedGit } from "./fixtures/git-crash.js";
import { padTree, removePad } from "./fixtures/storage-pad.js";
import { goalPublishedAt } from "./fixtures/goal.js";

const LIMITS: ProtocolLimits = { frameBytes: 256 * 1024, mailBodyBytes: 64 * 1024, subjectBytes: 8 * 1024, addresses: 64,
  replyReferences: 64, contextFiles: 64, contextBytes: 1024 * 1024, bundleBytes: 64 * 1024 * 1024, logBytes: 64 * 1024,
  batchMaxMessages: 32, idleStreamSeconds: 30, receiptWaitSeconds: 30 };
/** Synthetic tree size; a sparse pad avoids consuming that much disk space. */
const TREE_BYTES = 1024 * 1024 * 1024;

/** A socket the connection drives; frames written back are decoded for the test. */
class ScriptedSocket {
  destroyed = false; ended = false; paused = false;
  readonly writes: Buffer[] = [];
  private readonly handlers = new Map<string, Array<(...args: never[]) => void>>();
  write(value: Uint8Array): boolean { this.writes.push(Buffer.from(value)); return true; }
  end(value?: Uint8Array): this { this.ended = true; if (value !== undefined) this.writes.push(Buffer.from(value)); return this; }
  pause(): this { this.paused = true; return this; }
  resume(): this { this.paused = false; return this; }
  destroy(): this { this.destroyed = true; return this; }
  on(name: string, fn: (...args: never[]) => void): this { this.handlers.set(name, [...(this.handlers.get(name) ?? []), fn]); return this; }
  once(name: string, fn: (...args: never[]) => void): this { return this.on(name, fn); }
  off(): this { return this; }
  emit(name: string, ...args: unknown[]): void { for (const fn of this.handlers.get(name) ?? []) fn(...(args as never[])); }
  answers(): Array<{ ok: boolean; error?: { code: string } }> {
    return this.writes.map(frame => JSON.parse(frame.subarray(4).toString("utf8")) as { ok: boolean; error?: { code: string } });
  }
}
function deferred() {
  let done = false;
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = () => { done = true; yes(); }; });
  return { promise, resolve, get done() { return done; } };
}
async function until(predicate: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

function society(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "oma-reservation-"));
  const store = new Store(join(root, "runtime.sqlite"));
  store.transaction(tx => { tx.insertAgent(makeValidAgent("a")); tx.insertAgent(makeValidAgent("b")); });
  seedGit(root);
  const { git, mail } = gitFixture(root, store);
  const units = new PolicyExecution();
  t.mock.method(units, "observe", () => ({ activeState: "inactive", subState: "dead", result: "success", execMainStatus: 0, scope: "", invocationId: "" }));
  const views = new ViewsModule(store, root, "crash", "p");
  const lifecycle = createLifecycleModule(store, units, { stateRoot: root, projectGit: join(root, "repos/project.git"), society: "crash", hasGoal: () => true, activationAllowed: () => true },
    (_parent, input) => makeValidResolvedSpec(input.name, "p", ALL_CAPS, input.from, input.brief), mail);
  const paths = { stateRoot: root, runRoot: join(root, "run"), society: "crash", hasGoal: goalPublishedAt(root) };
  const broker = testBroker({ store: store, mail: mail, units: units, views: views, lifecycle: lifecycle, git: git, reviews: null, reconcile: null, paths: paths, limits: LIMITS });
  t.after(async () => { try { await broker.drainAndClose(); } finally { removeTree(root); } });
  const info = JSON.parse(readFileSync(join(root, "git-fixture.json"), "utf8")) as { base: string; candidate: string; exportRef: string };
  const bundle = readFileSync(join(root, "candidate.bundle"));
  const serve = () => {
    const socket = new ScriptedSocket();
    const peer = { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), cgroup: null, releaseConnection: () => undefined,
      retainForExecution: () => () => undefined };
    (Reflect.get(broker, "serveFrames") as (...args: unknown[]) => void).call(broker, socket, peer,
      (raw: Record<string, unknown>, body: AsyncIterable<Uint8Array> | null) => broker.dispatch(gitAuth, raw as never, body),
      (raw: Record<string, unknown>) => (Reflect.get(broker, "preflightPublicStream") as (...args: unknown[]) => void).call(broker, gitAuth, raw));
    return socket;
  };
  const submitFrame = (key: string) => encodeFrame({ v: 1, id: key, method: "git.submit", request: key, params: {
    candidate: info.candidate, exportRef: info.exportRef, prerequisites: [info.base], to: ["b"], subject: "candidate",
    body: "streamed", paths: ["change.txt"], bundle: { bytes: bundle.length, sha256: sha256Hex(bundle), mediaType: "application/x-git-bundle" } } });
  const mailSend = (key: string) => broker.dispatch(gitAuth, { v: 1, id: key, method: "mail.send", request: key,
    params: { to: ["b"], subject: "concurrent", kind: "message", body: "concurrent" } } as never, null) as Promise<{ ok: boolean; error?: { code: string } }>;
  const wires = () => readdirSync(join(root, "staging")).filter(name => name.endsWith(".wire"));
  return { root, store, git, paths, broker, bundle, serve, submitFrame, mailSend, wires };
}

test("V22A: a streamed submission owns its body until execution settles while ordinary mail proceeds", async t => {
  const entered = deferred(); const release = deferred();
  t.after(() => release.resolve());
  const f = society(t);
  const importer = Reflect.get(Reflect.get(f.git, "repository"), "quarantineImport") as (...args: unknown[]) => Promise<void>;
  t.mock.method(Reflect.get(f.git, "repository") as Record<string, (...args: unknown[]) => Promise<void>>, "quarantineImport", async function (this: unknown, ...args: unknown[]) {
    entered.resolve(); await release.promise; return importer.apply(this, args);
  });
  const socket = f.serve();
  socket.emit("data", Buffer.concat([f.submitFrame("stream-1"), f.bundle]));
  await until(() => entered.done || socket.writes.length > 0, "submission acceptance");
  assert.equal(entered.done, true, JSON.stringify(socket.answers()));
  // Accepted: the transport copy and the accepted spool copy are both on disk
  // and the execution still owns the transport body.
  assert.equal(f.store.getOperation("a", "stream-1")?.state, "pending");
  assert.equal(f.wires().length, 1);
  // Existing data does not impose an artificial admission budget.
  padTree(f.root, TREE_BYTES - Math.floor(f.bundle.length / 2));
  const concurrent = await f.mailSend("while-streaming");
  assert.deepEqual([concurrent.ok, concurrent.error?.code], [true, undefined],
    "ordinary mail proceeds while a stream owns its body");
  assert.equal(f.store.getOperation("a", "while-streaming")?.state, "succeeded");

  removePad(f.root);
  release.resolve();
  await until(() => socket.writes.length === 1, "the submission answer");
  assert.equal(socket.answers()[0]?.ok, true, JSON.stringify(socket.answers()));
  await until(() => f.wires().length === 0, "the transport copy to be released");
  // The completed transport copy is gone; existing tree size does not gate mail.
  padTree(f.root, TREE_BYTES);
  assert.equal((await f.mailSend("after-settle")).ok, true, "settled transport does not gate new mail");
});

test("P0V-50 / F4, P0-4: a caller that goes away does not remove the body its accepted execution owns", async t => {
  const entered = deferred(); const release = deferred();
  t.after(() => release.resolve());
  const f = society(t);
  const importer = Reflect.get(Reflect.get(f.git, "repository"), "quarantineImport") as (...args: unknown[]) => Promise<void>;
  t.mock.method(Reflect.get(f.git, "repository") as Record<string, (...args: unknown[]) => Promise<void>>, "quarantineImport", async function (this: unknown, ...args: unknown[]) {
    entered.resolve(); await release.promise; return importer.apply(this, args);
  });
  const socket = f.serve();
  socket.emit("data", Buffer.concat([f.submitFrame("gone"), f.bundle]));
  await until(() => entered.done || socket.writes.length > 0, "submission acceptance");
  assert.equal(entered.done, true, JSON.stringify(socket.answers()));
  assert.equal(f.wires().length, 1);
  // The caller disconnects while the accepted submission is still being
  // imported: its body remains with execution until that work ends.
  socket.emit("close", true);
  assert.equal(f.wires().length, 1, "the connection removed its execution-owned body");
  padTree(f.root, TREE_BYTES - Math.floor(f.bundle.length / 2));
  const concurrent = await f.mailSend("while-gone");
  assert.deepEqual([concurrent.ok, concurrent.error?.code], [true, undefined]);
  removePad(f.root);
  release.resolve();
  await until(() => f.store.getOperation("a", "gone")?.state === "succeeded", "the accepted submission to settle");
  await until(() => f.wires().length === 0, "the execution-owned body to close");
});

test("V22A: partial transport bodies close once and large-tree streams remain unrestricted", async t => {
  const f = society(t);
  // Closed mid-stream: the unaccepted partial transport copy is removed.
  const cut = f.serve();
  cut.emit("data", Buffer.concat([f.submitFrame("cut"), f.bundle.subarray(0, 8)]));
  await until(() => existsSync(join(f.root, "staging")) && f.wires().length === 1, "stream admission and spooling");
  assert.equal(f.wires().length, 1);
  cut.emit("close", true);
  assert.equal(f.wires().length, 0);
  assert.equal(f.store.getOperation("a", "cut"), null);

  // Repeated close after completion cannot repeat body disposal.
  const done = f.serve();
  done.emit("data", Buffer.concat([f.submitFrame("done"), f.bundle]));
  await until(() => done.writes.length === 1, "the submission answer");
  assert.equal(done.answers()[0]?.ok, true, JSON.stringify(done.answers()));
  done.emit("close", false); done.emit("close", true);

  // Ordinary large-tree input still accepts a subsequent stream.
  padTree(f.root, TREE_BYTES - f.bundle.length + 1);
  const refused = f.serve();
  refused.emit("data", Buffer.concat([f.submitFrame("refused"), f.bundle]));
  await until(() => refused.writes.length === 1, "the subsequent submission answer");
  assert.equal(refused.answers()[0]?.ok, true);
  assert.equal(f.wires().length, 0);
  assert.equal(f.store.getOperation("a", "refused")?.state, "succeeded");
  // Exactly the stream's bytes fit when nothing else is reserved.
  padTree(f.root, TREE_BYTES - 2 * f.bundle.length - 64 * 1024);
  const fits = f.serve();
  fits.emit("data", Buffer.concat([f.submitFrame("fits"), f.bundle]));
  await until(() => fits.writes.length === 1, "the submission answer");
  assert.equal(fits.answers()[0]?.ok, true, JSON.stringify(fits.answers()));
});
