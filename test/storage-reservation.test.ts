/** V22A: a streamed request's storage reservation lives from its preflight
 * until its execution settles or its connection closes, is counted by every
 * other admission meanwhile, is released exactly once, and refuses overflow and
 * exhaustion explicitly. Real Broker transport (serveFrames/RpcConnection with a
 * scripted socket), real TransportSpool, GitModule submit and Store; the tree
 * scan is the production observer.
 */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProtocolLimits } from "../implementation/contracts.js";
import { Store } from "../src/store.js";
import { Broker } from "../src/broker.js";
import { UnitsModule } from "../src/units.js";
import { ViewsModule } from "../src/views.js";
import { LifecycleModule } from "../src/lifecycle.js";
import { StoreError } from "../src/domain/errors.js";
import { encodeFrame } from "../src/frame.js";
import { sha256Hex } from "../src/hash.js";
import { ALL_CAPS, TEST_RESOURCES, makeValidAgent, makeValidResolvedSpec } from "./fixtures/spec.js";
import { removeTree } from "./fixtures/cleanup.js";
import { gitAuth, gitFixture, seedGit } from "./fixtures/git-crash.js";
import { padTree, removePad } from "./fixtures/storage-pad.js";

const LIMITS: ProtocolLimits = { frameBytes: 256 * 1024, mailBodyBytes: 64 * 1024, subjectBytes: 8 * 1024, addresses: 64,
  replyReferences: 64, contextFiles: 64, contextBytes: 1024 * 1024, bundleBytes: 64 * 1024 * 1024, logBytes: 64 * 1024,
  batchMaxMessages: 32, idleStreamSeconds: 30, receiptWaitSeconds: 30 };
/** A fixed configured quota; the tree is placed relative to it with a sparse pad. */
const QUOTA = 1024 * 1024 * 1024;

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
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
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
  t.after(() => { try { store.close(); } finally { removeTree(root); } });
  store.transaction(tx => { tx.insertAgent(makeValidAgent("a")); tx.insertAgent(makeValidAgent("b")); });
  seedGit(root);
  const { git, mail } = gitFixture(root, store);
  const units = new UnitsModule("crash", { node: process.execPath, libdir: root, state: root, society: "crash", agent: "", config: join(root, "config.json"), run: join(root, "oma", "crash"), brokerUnit: "" }, join(root, "units"), { p: TEST_RESOURCES });
  t.mock.method(units, "observe", () => ({ activeState: "inactive", subState: "dead", result: "success", execMainStatus: 0, cgroup: "", invocationId: "" }));
  const views = new ViewsModule(store, root, "crash", "p");
  const lifecycle = new LifecycleModule(store, units, { stateRoot: root, projectGit: join(root, "repos/project.git"), society: "crash", hasGoal: () => true, activationAllowed: () => true },
    (_parent, input) => makeValidResolvedSpec(input.name, "p", ALL_CAPS, input.from, input.brief), mail);
  const paths = { stateRoot: root, runRoot: join(root, "run"), society: "crash", storageBytes: QUOTA };
  const broker = new Broker(store, mail, units, views, lifecycle, git, null, paths, LIMITS);
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

test("V22A: a streamed submission keeps its reservation until execution settles, and others see it meanwhile", async t => {
  const f = society(t);
  const entered = deferred(); const release = deferred();
  const importer = Reflect.get(f.git, "quarantineImport") as (...args: unknown[]) => Promise<void>;
  t.mock.method(f.git as unknown as Record<string, (...args: unknown[]) => Promise<void>>, "quarantineImport", async function (this: unknown, ...args: unknown[]) {
    entered.resolve(); await release.promise; return importer.apply(this, args);
  });
  const socket = f.serve();
  socket.emit("data", Buffer.concat([f.submitFrame("stream-1"), f.bundle]));
  await entered.promise;
  // Accepted: the transport copy and the accepted spool copy are both on disk
  // and the request's own reservation is still outstanding.
  assert.equal(f.store.getOperation("a", "stream-1")?.state, "pending");
  assert.equal(f.wires().length, 1);
  // The tree alone fits; the tree plus the in-flight reservation does not.
  padTree(f.root, QUOTA - Math.floor(f.bundle.length / 2));
  const concurrent = await f.mailSend("while-streaming");
  assert.deepEqual([concurrent.ok, concurrent.error?.code], [false, "QUOTA_EXCEEDED"],
    "an in-flight stream's reservation is counted by every other admission");
  assert.equal(f.store.getOperation("a", "while-streaming"), null);

  removePad(f.root);
  release.resolve();
  await until(() => socket.writes.length === 1, "the submission answer");
  assert.equal(socket.answers()[0]?.ok, true, JSON.stringify(socket.answers()));
  await until(() => f.wires().length === 0, "the transport copy to be released");
  // Settled: nothing remains reserved, so a tree exactly at the quota fits.
  padTree(f.root, QUOTA);
  assert.equal((await f.mailSend("after-settle")).ok, true, "a settled stream returns its reservation");
});

test("V22A: a reservation is released once however the connection ends, and a stream that no longer fits is refused before spooling", async t => {
  const f = society(t);
  // Closed mid-stream: the partial transport copy and its reservation go.
  const cut = f.serve();
  cut.emit("data", Buffer.concat([f.submitFrame("cut"), f.bundle.subarray(0, 8)]));
  assert.equal(f.wires().length, 1);
  cut.emit("close", true);
  assert.equal(f.wires().length, 0);
  assert.equal(f.store.getOperation("a", "cut"), null);

  // Completed, then closed twice: released once, never twice.
  const done = f.serve();
  done.emit("data", Buffer.concat([f.submitFrame("done"), f.bundle]));
  await until(() => done.writes.length === 1, "the submission answer");
  assert.equal(done.answers()[0]?.ok, true, JSON.stringify(done.answers()));
  done.emit("close", false); done.emit("close", true);

  // A double release would make this stream fit; it must be refused before any byte is spooled.
  padTree(f.root, QUOTA - f.bundle.length + 1);
  const refused = f.serve();
  refused.emit("data", Buffer.concat([f.submitFrame("refused"), f.bundle]));
  await until(() => refused.writes.length === 1, "the refusal");
  assert.equal(refused.answers()[0]?.error?.code, "QUOTA_EXCEEDED");
  assert.equal(f.wires().length, 0);
  assert.equal(f.store.getOperation("a", "refused"), null);
  // Exactly the stream's bytes fit when nothing else is reserved.
  padTree(f.root, QUOTA - 2 * f.bundle.length - 64 * 1024);
  const fits = f.serve();
  fits.emit("data", Buffer.concat([f.submitFrame("fits"), f.bundle]));
  await until(() => fits.writes.length === 1, "the submission answer");
  assert.equal(fits.answers()[0]?.ok, true, JSON.stringify(fits.answers()));
});

test("V22A: reservations refuse overflow and exhaustion explicitly and release idempotently", async () => {
  const quota = await import("../src/storage/quota.js") as unknown as Record<string, unknown>;
  const Owner = quota.StorageAdmission as (new (root: string, storageBytes: number | undefined, headroom: number) => {
    readonly outstanding: number; reserve(bytes: number): () => void; admit(category: string): () => void;
  }) | undefined;
  assert.equal(typeof Owner, "function", "one owner holds the process's storage reservations");
  const root = mkdtempSync(join(tmpdir(), "oma-reservation-unit-"));
  try {
    const owner = new Owner!(root, 1024 * 1024, 4096);
    const first = owner.reserve(600 * 1024);
    assert.throws(() => owner.reserve(600 * 1024), (error: unknown) => error instanceof StoreError && error.code === "QUOTA_EXCEEDED");
    assert.throws(() => owner.reserve(Number.MAX_SAFE_INTEGER), (error: unknown) => error instanceof StoreError && error.code === "QUOTA_EXCEEDED");
    assert.throws(() => owner.reserve(-1), (error: unknown) => error instanceof StoreError);
    assert.equal(owner.outstanding, 600 * 1024);
    first(); first();
    assert.equal(owner.outstanding, 0, "a second release subtracts nothing");
    const second = owner.reserve(600 * 1024);
    assert.equal(owner.outstanding, 600 * 1024);
    second();
    const full = new Owner!(root, 1, 4096);
    assert.throws(() => full.admit("admit"), (error: unknown) => error instanceof StoreError && error.code === "QUOTA_EXCEEDED");
    full.admit("read")(); full.admit("safety-control")();
  } finally { removeTree(root); }
});
