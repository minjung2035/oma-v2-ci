import type { RawDescriptor } from "@oma/contracts/files";
import { TransportSpool } from "@oma/storage/transport-spool";
import { testBroker } from "./helpers/broker-fixture.js";
import { createLifecycleModule } from "#oma-test/app/broker/lifecycle-composition";
import { serializePlanIntent } from "./fixtures/plan.js";
/** The seventh review (adversarial, 2026-09-28): the core's findings, each
 * held by what the product now does. Platform findings are in
 * platform-stream-publication, platform-host-service and platform-snapshot. */
import test from "node:test";
import assert from "node:assert/strict";
import { closeSync, mkdirSync, mkdtempSync, openSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requestKeyOf } from "@oma/tool-runtime/shared";
import { publishNoReplace } from "@oma/storage/durable-fs";
import { replaceDerivedSymlink } from "@oma/storage/staged-tree";
import { lockFileDescriptor } from "@oma/native/linux";
import { RequestCache, readCacheFile, type CacheReader } from "#oma-test/app/request-cache";
import { StoreError } from "@oma/domain/errors";

const UUID = "0123abcd-0000-4000-8000-00000000beef";

test("P0V-111 / G01-01: a publication collects every dead locked temporary in its directory, whatever name it was for", t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-collect-"));
  t.after(() => { rmSync(dir, { recursive: true, force: true }); });
  // A receipt whose publication was killed and that is never published again.
  writeFileSync(join(dir, `.gone.json.${UUID}.held.tmp`), "half");
  // A live writer of another name, holding its lock.
  const live = `.busy.json.${UUID.replace("beef", "cafe")}.held.tmp`;
  writeFileSync(join(dir, live), "writing");
  const held = openSync(join(dir, live), "r");
  t.after(() => { closeSync(held); });
  assert.equal(lockFileDescriptor(held).kind, "held");
  // A configuration's temporary, written without a lock.
  writeFileSync(join(dir, `.config.json.${UUID}.tmp`), "unlocked");
  assert.equal(publishNoReplace(join(dir, "other.json"), "x"), "created");
  assert.deepEqual(readdirSync(dir).sort(), [live, `.config.json.${UUID}.tmp`, "other.json"].sort());
});

test("P0V-111 / G01r2-02: a derived link's publication removes what a killed one of the same link left", t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-link-"));
  t.after(() => { rmSync(dir, { recursive: true, force: true }); });
  symlinkSync("revisions/a", join(dir, `.current.${UUID}.tmp`));
  symlinkSync("revisions/b", join(dir, `.other.${UUID}.tmp`));
  writeFileSync(join(dir, `.current.${UUID.replace("beef", "f00d")}.tmp`), "a file is not this writer's link");
  replaceDerivedSymlink(join(dir, "current"), "revisions/c");
  assert.deepEqual(readdirSync(dir).sort(), [`.current.${UUID.replace("beef", "f00d")}.tmp`, `.other.${UUID}.tmp`, "current"].sort());
});

/** A session branch as the engine keeps it: an assistant message with its
 * tool calls, and a tool result for each call that got one. */
function session(entries: readonly { call: string; tool: string; args: Record<string, unknown>; answered: boolean }[]) {
  const branch = entries.flatMap(entry => [
    { type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: entry.call, name: entry.tool, arguments: entry.args }] } },
    ...(entry.answered ? [{ type: "message", message: { role: "toolResult", toolCallId: entry.call, toolName: entry.tool, content: [] } }] : []),
  ]);
  return { sessionManager: { getSessionId: () => "session-1", getBranch: () => branch } };
}

test("P0V-110 / F-07: a call repeated after its result was lost has the key of the first; after a result the model saw, a new one", () => {
  const args = { to: ["bob"], subject: "hi", body: "the same letter" };
  const send = (id: string, context: ReturnType<typeof session>) => requestKeyOf(undefined, { id, tool: "oma_mail_send", params: args, context });
  // The first call; the engine died before its result was recorded.
  const first = send("call-1", session([{ call: "call-1", tool: "oma_mail_send", args, answered: false }]));
  // The engine answered it with "No result provided" (not kept in the session); the model calls again.
  const again = send("call-2", session([
    { call: "call-1", tool: "oma_mail_send", args, answered: false },
    { call: "call-2", tool: "oma_mail_send", args, answered: false },
  ]));
  assert.equal(again, first, "the repeated call is the same request, which the broker answers once");
  // The model saw the first result and sends the same letter again: a new request.
  const later = send("call-3", session([
    { call: "call-1", tool: "oma_mail_send", args, answered: true },
    { call: "call-3", tool: "oma_mail_send", args, answered: false },
  ]));
  assert.notEqual(later, first);
  // Other arguments, another tool: other requests.
  assert.notEqual(requestKeyOf(undefined, { id: "call-4", tool: "oma_mail_send", params: { ...args, body: "another" }, context: session([]) }), first);
  assert.notEqual(requestKeyOf(undefined, { id: "call-5", tool: "oma_mail_ack", params: args, context: session([]) }), first);
  // The model's own key is the key; an invalid one is refused.
  assert.equal(requestKeyOf("mine-1", { id: "x", tool: "oma_mail_send", params: args, context: session([]) }), "mine-1");
  assert.throws(() => requestKeyOf("bad key", { id: "x", tool: "oma_mail_send", params: args }));
  // Without the engine's session, the call's own id stands in for it.
  assert.notEqual(requestKeyOf(undefined, { id: "a", tool: "oma_mail_send", params: args }), requestKeyOf(undefined, { id: "b", tool: "oma_mail_send", params: args }));
  assert.match(first, /^pi-[0-9a-f]{40}$/);
});

test("P0V-112 / G02-ledger-r2-02: request metadata larger than a request and its receipt can be is not read, and is not taken for absent", t => {
  const home = mkdtempSync(join(tmpdir(), "oma-cache-bound-"));
  t.after(() => { rmSync(home, { recursive: true, force: true }); });
  const dir = join(home, ".local", "state", "oma", "requests");
  mkdirSync(dir, { recursive: true });
  let reads = 0;
  const reader: CacheReader = (path, expected, maximum) => { reads += 1; return readCacheFile(path, expected, maximum); };
  writeFileSync(join(dir, "k1.json"), `{"key":"k1","pad":"${"x".repeat(4096)}"}`);
  const observed = new RequestCache(home, reader, 1024).read("k1");
  assert.equal(observed.kind, "corrupt");
  assert.match(observed.kind === "corrupt" ? observed.reason : "", /larger than a request and its receipt/);
  assert.equal(reads, 1);
  assert.equal(new RequestCache(home).read("k1").kind, "corrupt", "under the reference bound it is read, and still not a request this cache wrote");
});

test("P0V-113 / G03-broker-r2-01: a run that could not be opened leaves the incarnation where it was, and its endpoint closed", async t => {
  const { Broker } = await import("@oma/broker");
  const { LifecycleModule } = await import("@oma/lifecycle");
  const { ViewsModule } = await import("#oma-test/app/views");
  const { RunRegistry } = await import("@oma/broker/run-registry");
  const { preparedFixture } = await import("./fixtures/delivery-receipt.js");
  const { TEST_VIEW_LIMITS } = await import("./fixtures/limits.js");
  let invocation = "c".repeat(32);
  const f = await preparedFixture(1);
  const units = {
    onRevokeRun: undefined, bindIncarnationReader: () => undefined, unitCgroup: () => "",
    observe: () => ({ activeState: "active", subState: "running", result: "success", execMainStatus: 0, cgroup: "/oma/alice", invocationId: invocation }),
  } as never;
  const lifecycle = createLifecycleModule(f.store, units, { stateRoot: f.root, projectGit: join(f.root, "repos", "project.git"), society: "demo",
    hasGoal: () => true, activationAllowed: () => true }, ((_parent: unknown, input: Record<string, unknown>) => ({ ...input })) as never, f.mail);
  const broker = testBroker({ store: f.store, mail: f.mail, units: units, views: new ViewsModule(f.store, f.root, "demo", "p", TEST_VIEW_LIMITS), lifecycle: lifecycle, git: null, reviews: null, reconcile: null, paths: { stateRoot: f.root, runRoot: join(f.root, "run"), society: "demo", hasGoal: () => true } });
  t.after(async () => { try { await broker.drainAndClose(); } catch { f.store.close(); } finally { rmSync(f.root, { recursive: true, force: true }); } });
  // Each invocation's cgroup, as the kernel reports it: populated until it dies.
  const cgroups: { population: "populated" | "empty" }[] = [];
  Reflect.set(broker, "runLeases", new RunRegistry(() => {
    const cgroup = { population: "populated" as "populated" | "empty" }; cgroups.push(cgroup);
    return { fd: -1, identity: { dev: 1n, ino: BigInt(cgroups.length) }, population: () => cgroup.population, matches: () => true, close() {} };
  }));
  await broker.start();
  const openRun = (): Promise<{ incarnation: number }> => (Reflect.get(broker, "openRun") as (actor: string, id: string) => Promise<{ incarnation: number }>).call(broker, "alice", invocation);
  const incarnation = (): number => f.store.getAgent("alice")!.incarnation;
  const servers = (): number => (Reflect.get(broker, "listeners") as import("@oma/broker/listeners").BrokerListeners).size;
  const nextInvocation = (): void => { cgroups.at(-1)!.population = "empty"; invocation = String(cgroups.length).padStart(32, "d"); };
  const before = incarnation(); const listening = servers();
  // The endpoint could not be made (a full disk, a path too long).
  const listen = Reflect.get(broker, "listenActor") as (...args: unknown[]) => unknown;
  Reflect.set(broker, "listenActor", () => { throw Object.assign(new Error("ENOSPC: no space left on device, mkdir"), { code: "ENOSPC" }); });
  await assert.rejects(openRun, /ENOSPC/);
  Reflect.set(broker, "listenActor", listen);
  assert.equal(incarnation(), before, "a failed open consumed an incarnation");
  // R16/V07B: the invocation whose opening failed ends; it does not retry.
  await assert.rejects(openRun, { code: "STALE_RUN" });
  // The next invocation: the endpoint was made and the commit then refused.
  nextInvocation();
  const transaction = f.store.transaction.bind(f.store);
  (f.store as unknown as { transaction: unknown }).transaction = () => { throw new StoreError("DB_BUSY", "the ledger is busy"); };
  await assert.rejects(openRun, { code: "DB_BUSY" });
  (f.store as unknown as { transaction: unknown }).transaction = transaction;
  assert.equal(incarnation(), before);
  assert.equal(servers(), listening, "the endpoint of a run that was not opened is left listening");
  // The pathname exists, but listening fails later: still no incarnation.
  nextInvocation();
  let releaseReady!: () => void;
  let failReady!: (error: Error) => void;
  let closed = 0;
  const delayed = (): void => {
    const ready = new Promise<void>((resolve, reject) => { releaseReady = resolve; failReady = reject; });
    Reflect.set(broker, "listenActor", () => ({ socketHostPath: "not-ready.sock", ready, done: () => { closed += 1; } }));
  };
  delayed();
  const failed = openRun();
  assert.equal(incarnation(), before);
  const refused = assert.rejects(failed, /EADDRINUSE/);
  failReady(new Error("EADDRINUSE: asynchronous bind failure"));
  await refused;
  assert.equal(incarnation(), before); assert.equal(closed, 1);
  await assert.rejects(openRun, { code: "STALE_RUN" });
  // A revoke or new unit observation during readiness cannot commit either.
  for (const change of ["revoke", "invocation", "population", "drain"] as const) {
    nextInvocation(); delayed();
    const opening = openRun();
    await assert.rejects(openRun, { code: "STALE_RUN" });
    if (change === "revoke") (Reflect.get(broker, "runLeases") as InstanceType<typeof RunRegistry>).get("alice")!.revoke();
    if (change === "invocation") invocation = "e".repeat(32);
    if (change === "population") cgroups.at(-1)!.population = "empty";
    if (change === "drain") Reflect.set(broker, "draining", true);
    releaseReady();
    await assert.rejects(opening, { code: "STALE_RUN" });
    assert.equal(incarnation(), before);
    if (change === "drain") Reflect.set(broker, "draining", false);
  }
  assert.equal(closed, 5);
  Reflect.set(broker, "listenActor", listen);
  // Only a ready endpoint under the still-current invocation commits.
  nextInvocation();
  const lease = await openRun();
  assert.equal(lease.incarnation, before + 1);
  assert.equal(incarnation(), before + 1);
  assert.equal(servers(), listening + 1);
  // Drive the actual listener's asynchronous error, not just a rejected stub.
  nextInvocation();
  const { Server } = await import("node:net");
  const originalListen = Server.prototype.listen;
  Server.prototype.listen = function (this: InstanceType<typeof Server>) {
    queueMicrotask(() => this.emit("error", Object.assign(new Error("injected bind conflict"), { code: "EADDRINUSE" })));
    return this;
  } as typeof originalListen;
  try { await assert.rejects(openRun, /injected bind conflict/); }
  finally { Server.prototype.listen = originalListen; }
  assert.equal(incarnation(), before + 1);
  assert.equal(servers(), listening);
  await assert.rejects(openRun, { code: "STALE_RUN" });
  // A real drain closes admission while readiness is pending. The resumed
  // open must refuse before touching the Store that the drain closes.
  nextInvocation(); delayed();
  const pendingDrain = openRun();
  const rejectedDrain = assert.rejects(pendingDrain, { code: "BROKER_UNAVAILABLE" });
  const draining = broker.drainAndClose();
  releaseReady();
  await rejectedDrain; await draining;
  assert.equal(servers(), 0);
});

test("P0V-114 / G04-02, G04-03, G03-05: one owner clears a socket's name before a server listens there; a name already gone is no failure, and a file that is not a socket is kept", async t => {
  const { spawnSync } = await import("node:child_process");
  const { existsSync, lstatSync, readFileSync } = await import("node:fs");
  const { clearSocketName } = await import("@oma/storage/socket-name");
  const dir = mkdtempSync(join(tmpdir(), "oma-sock-"));
  t.after(() => { rmSync(dir, { recursive: true, force: true }); });
  const path = join(dir, "a.sock");
  clearSocketName(path);
  // A name a server left when its process ended without closing it.
  const left = spawnSync(process.execPath, ["-e", "require('net').createServer().listen(process.argv[1], () => process.exit(0))", path], { timeout: 20_000 });
  assert.equal(left.status, 0);
  assert.ok(lstatSync(path).isSocket());
  clearSocketName(path);
  assert.equal(existsSync(path), false);
  writeFileSync(path, "not a socket");
  assert.throws(() => clearSocketName(path), { code: "STORE_CORRUPT" });
  assert.equal(readFileSync(path, "utf8"), "not a socket");
});

test("P0V-114 / G04-03: a server's close removes its own name, and not a name the next server bound meanwhile", async t => {
  const { createServer } = await import("node:net");
  const { existsSync } = await import("node:fs");
  const { InferenceRelay } = await import("#oma-test/app/runtime/inference-relay");
  const dir = mkdtempSync(join(tmpdir(), "oma-sock-"));
  t.after(() => { rmSync(dir, { recursive: true, force: true }); });
  const path = join(dir, "principal-inference.sock");
  const run = { placeholderId: UUID, society: "demo", actor: "principal", incarnation: 0, modelProfile: "p" };
  const first = await InferenceRelay.open(path, { origin: "https://fixture.invalid", headers: {} }, { concurrent: 1, timeoutMs: 1000 });
  const closing = first.close();
  assert.equal(existsSync(path), false, "the closing forwarder's name is gone as close returns");
  const next = createServer();
  next.listen(path);
  t.after(() => { next.close(); });
  await closing;
  assert.equal(existsSync(path), true, "a closed forwarder removed the next server's name");
});

test("P0V-114 / G04-01: what a tenure holds ends with it, before the society is free; one handed over after the end is closed at once", async t => {
  const { HostTenure } = await import("#oma-test/app/runtime/host-tenure");
  const { tryHoldSociety } = await import("#oma-test/app/runtime/society-lease");
  const root = mkdtempSync(join(tmpdir(), "oma-tenure-"));
  t.after(() => { rmSync(root, { recursive: true, force: true }); });
  const takeable = (): boolean => { const other = tryHoldSociety(root); other?.release(); return other !== null; };
  const tenure = HostTenure.take(root)!;
  const seen: string[] = [];
  const holding = (name: string) => ({ close: async () => { seen.push(`${name} closed; society ${takeable() ? "free" : "held"}`); } });
  assert.equal(await tenure.hold(holding("egress")), true);
  let exited: () => void = () => undefined;
  tenure.adopt({ close() {}, exited: new Promise<void>(resolve => { exited = resolve; }) });
  // A disown and a quit end the tenure together: both wait for the same end.
  const disown = tenure.end(); const quit = tenure.end();
  assert.equal(quit, disown);
  exited();
  await quit;
  assert.deepEqual(seen, ["egress closed; society held"]);
  assert.equal(takeable(), true);
  assert.equal(await tenure.hold(holding("late")), false);
  assert.deepEqual(seen, ["egress closed; society held", "late closed; society free"]);
});

test("P0V-115 / G05-02: a unit carries a society's and an agent's name only when it needs no escape anywhere it lands", async () => {
  const { renderUnit } = await import("@oma/platform-linux/units/render");
  const values = { node: "/n", libdir: "/l", state: "/s", society: "demo", agent: "alice" };
  const template = "Description=OMA @SOCIETY@ @AGENT@\nExecStart=@NODE@ --society @SOCIETY@ --agent @AGENT@\nUnit=oma-@SOCIETY@-@AGENT@.service";
  assert.equal(renderUnit(template, values), "Description=OMA demo alice\nExecStart=/n --society demo --agent alice\nUnit=oma-demo-alice.service");
  for (const society of ["de$mo", "de mo", "De", "de%i"])
    assert.throws(() => renderUnit(template, { ...values, society }), { code: "INVALID_REQUEST" }, society);
  for (const agent of ["a$HOME", "a\\x20", "", "a b"])
    assert.throws(() => renderUnit(template, { ...values, agent }), { code: "INVALID_REQUEST" }, agent);
  // A template that names no agent renders whatever the base values hold.
  assert.equal(renderUnit("--state-root @STATE_ARG@", { ...values, agent: "" }), "--state-root /s");
});

test("P0V-116 / G06-01, G06-02: a word git could read as an option never reaches it, and is not observed as absent or as the expected value", async () => {
  const { GitObserver } = await import("@oma/git/observe");
  const { compareAndSwapCanonicalRef, createCanonicalRef } = await import("@oma/git/canonical-command");
  const runs: string[][] = [];
  const observer = new GitObserver(args => { runs.push([...args]); return { status: 1, signal: null, stdout: new Uint8Array(), stderr: new Uint8Array() }; });
  const oid = "a".repeat(40);
  const refused = { code: "INVALID_REQUEST" };
  assert.throws(() => compareAndSwapCanonicalRef(observer, "/nowhere.git", "refs/heads/inj", "--stdin", null), refused);
  assert.throws(() => compareAndSwapCanonicalRef(observer, "/nowhere.git", "--bad", oid, null), refused);
  assert.throws(() => compareAndSwapCanonicalRef(observer, "/nowhere.git", "refs/heads/main", oid, "--no-deref"), refused);
  assert.throws(() => createCanonicalRef(observer, "/nowhere.git", "refs/heads/main", "-z"), refused);
  assert.throws(() => observer.ref("/nowhere.git", "--all"), refused);
  assert.throws(() => observer.ancestry("/nowhere.git", "--fork-point", oid), refused);
  assert.throws(() => observer.changedPaths("/nowhere.git", oid, "--output=/tmp/x"), refused);
  assert.throws(() => observer.commit("/nowhere.git", "--batch"), refused);
  assert.deepEqual(runs, [], "git ran with a refused argument");
  // Ref names and object ids are asked as before.
  assert.equal(observer.ref("/nowhere.git", "refs/heads/main").kind, "absent");
  assert.equal(observer.ref("/nowhere.git", "HEAD").kind, "absent");
  assert.equal(runs.length, 2);
});

test("P0V-117 / G07-01: a descriptor that is not a pidfd is no answer about a process, not an exited one", async () => {
  const { pidfdLiveness } = await import("@oma/native/linux");
  // /dev/null polls readable, exactly as a pidfd of an exited process does.
  const fd = openSync("/dev/null", "r");
  try { assert.deepEqual(pidfdLiveness(fd), { kind: "failed", errno: 9 }); }
  finally { closeSync(fd); }
  assert.deepEqual(pidfdLiveness(fd), { kind: "failed", errno: 9 }, "a closed number is no answer either");
});

test("P0V-118 / G07-02, G07-03: a message's values are refused as the request they are; a header block is judged by one rule in either form", async () => {
  const { buildEml } = await import("@oma/mail/serialize");
  const { parseEmlHeaders } = await import("@oma/mail/headers");
  const id = "m-00000000-0000-4000-8000-000000000118-0";
  const valid = { from: "a@demo.oma.invalid", to: ["principal@demo.oma.invalid"], replyTo: [], subject: "hello", kind: "message" as const,
    contextRevision: null, inReplyTo: null, references: [], messageId: `${id}@demo.oma.invalid`, body: "body" };
  await buildEml(valid);
  for (const broken of [{ subject: undefined }, { subject: 7 }, { to: undefined }, { references: "x" }, { body: 1 }, { from: null }])
    await assert.rejects(buildEml({ ...valid, ...broken } as never), { code: "INVALID_REQUEST" }, JSON.stringify(broken));
  const block = "Subject: hi\r\nFrom: a@demo.oma.invalid";
  assert.deepEqual(parseEmlHeaders(Buffer.from(`${block}\r\n\r\nbody`)), parseEmlHeaders(`${block}\r\n\r\nbody`));
  for (const form of [`${block}\r\n\r\n`, Buffer.from(`${block}\r\n\r\n`)])
    assert.throws(() => parseEmlHeaders(form, { maxHeaderBytes: 8 }), { code: "INVALID_REQUEST" });
  assert.throws(() => parseEmlHeaders("Subject: \ud800\r\n\r\n"), { code: "INVALID_REQUEST" });
});

test("P0V-119 / G08-01, G09-01, G09-02: JSON nested past one named bound is refused as a request, by the parser and by the codec, never as a stack overflow", async () => {
  const { JSON_NESTING_LIMIT, canonicalJson, snapshotJson } = await import("@oma/domain/canonical-json");
  const { parseJsonObject, FrameError } = await import("@oma/protocol/frame");
  const { decodeMutationPayload } = await import("@oma/protocol/request-codec");
  const { buildRequestIdentity } = await import("@oma/domain/request-identity");
  const nested = (levels: number): unknown => { let value: unknown = 0; for (let i = 0; i < levels; i++) value = [value]; return value; };
  const text = (levels: number): string => `{"a":${"[".repeat(levels)}0${"]".repeat(levels)}}`;
  assert.equal(JSON_NESTING_LIMIT, 64);
  // The root object is the first level.
  assert.doesNotThrow(() => canonicalJson({ a: nested(JSON_NESTING_LIMIT - 1) }));
  assert.doesNotThrow(() => parseJsonObject(Buffer.from(text(JSON_NESTING_LIMIT - 1))));
  const refused = (error: unknown): boolean => error instanceof StoreError && error.code === "INVALID_REQUEST" && /nesting exceeds 64/.test(error.message);
  for (const levels of [JSON_NESTING_LIMIT, 100_000]) {
    assert.throws(() => snapshotJson({ a: nested(levels) }), refused);
    assert.throws(() => canonicalJson({ a: nested(levels) }), refused);
    assert.throws(() => decodeMutationPayload("mail.ack", { ids: nested(levels) }), refused);
    assert.throws(() => buildRequestIdentity("mail.send", { to: ["alice"], body: nested(levels) } as never), refused);
    assert.throws(() => parseJsonObject(Buffer.from(text(levels))),
      (error: unknown) => error instanceof FrameError && error.code === "INVALID_REQUEST" && /nesting exceeds 64/.test(error.message));
  }
});

test("G08-03: the canonical spelling of numbers is Number::toString, held by golden vectors", async () => {
  const { canonicalJson, sha256Hex } = await import("@oma/domain/canonical-json");
  assert.equal(canonicalJson([0, -0, 1, -1, 1.5, 0.1 + 0.2, 1e21, 1e-7, 5e-324, 1.7976931348623157e308, 9007199254740991, 123e-20, 100, 2 ** 53]),
    "[0,0,1,-1,1.5,0.30000000000000004,1e+21,1e-7,5e-324,1.7976931348623157e+308,9007199254740991,1.23e-18,100,9007199254740992]");
  // Computed apart from this code: printf '%s' '<text>' | sha256sum.
  const document = canonicalJson({ b: [1.5, -0, 1e21], a: { z: 0.1, y: null } });
  assert.equal(document, '{"a":{"y":null,"z":0.1},"b":[1.5,0,1e+21]}');
  assert.equal(sha256Hex(document), "485a45b66e22b875f2cf59f3b982deae7045941126f6f58a95e83413933637d7");
});

test("P0V-120 / G10-04: the provider names only a port the bridge holds -- no one's while it has none, then the one the kernel gave it", async t => {
  const { createServer, connect } = await import("node:net");
  const { startInferenceBridge } = await import("@oma/extension/inference-bridge");
  const dir = mkdtempSync(join(tmpdir(), "oma-bridge-"));
  const listening = (server: import("node:net").Server, at: number | string): Promise<void> =>
    new Promise(resolve => { typeof at === "number" ? server.listen(at, "127.0.0.1", resolve) : server.listen(at, resolve); });
  // Another process took the port chosen for the bridge.
  const holder = createServer(socket => { socket.end("a stranger"); });
  await listening(holder, 0);
  const taken = (holder.address() as import("node:net").AddressInfo).port;
  const relay = createServer(socket => { socket.end("the relay"); });
  await listening(relay, join(dir, "relay.sock"));
  const saved = { ...process.env };
  t.after(() => { process.env = saved; holder.close(); relay.close(); rmSync(dir, { recursive: true, force: true }); });
  Object.assign(process.env, { OMA_INFERENCE_SOCKET: join(dir, "relay.sock"), OMA_INFERENCE_PROVIDER: "p", OMA_INFERENCE_KEY: "placeholder", OMA_INFERENCE_PORT: String(taken) });
  const urls: string[] = [];
  const ready = startInferenceBridge({ on: () => {}, registerProvider: (_name: string, config: { baseUrl: string }) => { urls.push(config.baseUrl); } } as never);
  assert.deepEqual(urls, ["http://127.0.0.1:0"], "no request may name the planned port before binding");
  await ready;
  assert.ok(urls.length >= 2);
  assert.ok(!urls.includes(`http://127.0.0.1:${taken}`), "the stranger's port was registered");
  assert.ok(urls.slice(0, -1).every(url => url === "http://127.0.0.1:0"));
  const port = Number(/^http:\/\/127\.0\.0\.1:(\d+)$/.exec(urls.at(-1) ?? "")?.[1]);
  assert.ok(port > 0 && port !== taken);
  const answer = await new Promise<string>(resolve => {
    const socket = connect(port, "127.0.0.1"); let text = "";
    socket.on("data", chunk => { text += chunk; }); socket.on("close", () => resolve(text));
  });
  assert.equal(answer, "the relay");
});

test("P0V-121 / G10-05: a journal prefix stands only when the view's own bound ended the read", async () => {
  const { journalView } = await import("@oma/process/policies");
  const observed = (kind: string, truncated: boolean, exitCode: number | null = null) => ({ kind, exitCode, stdout: Buffer.from("prefix"), stderr: Buffer.alloc(0),
    stdoutTruncated: truncated, stderrTruncated: false, signal: null, errorCode: null, elapsedMs: 1 }) as never;
  assert.deepEqual(journalView(observed("output-limited", true)), { bytes: Buffer.from("prefix"), truncated: true });
  assert.deepEqual(journalView(observed("exited", true, 0)), { bytes: Buffer.from("prefix"), truncated: true });
  assert.deepEqual(journalView(observed("exited", false, 0)), { bytes: Buffer.from("prefix"), truncated: false });
  for (const kind of ["signalled", "aborted", "unobserved", "spawn-failed"])
    assert.throws(() => journalView(observed(kind, true)), { code: "INTERNAL_ERROR" }, kind);
  assert.throws(() => journalView(observed("timed-out", true)), { code: "DEADLINE_EXCEEDED" });
});

test("P0V-122 / G10-02: the pinned engine searches only copied single-link files, including context-zero grep", async t => {
  const { readFileSync, realpathSync } = await import("node:fs");
  const { containWorkspaceTools } = await import("@oma/tool-runtime/contained-tools");
  const base = realpathSync(mkdtempSync(join(tmpdir(), "oma-grep-")));
  t.after(() => { rmSync(base, { recursive: true, force: true }); });
  const workspace = join(base, "workspace"); mkdirSync(workspace);
  writeFileSync(join(base, "secret"), "host secret\n");
  symlinkSync(join(base, "secret"), join(workspace, "linked"));
  writeFileSync(join(workspace, "notes.txt"), "a secret of the workspace\n");
  const tools: Record<string, { execute(id: string, params: Record<string, unknown>, signal: undefined, update: undefined, ctx: unknown): Promise<{ content: { text?: string }[] }> }> = {};
  containWorkspaceTools({ registerTool: (tool: { name: string }) => { tools[tool.name] = tool as never; } } as never, workspace, false);
  assert.ok(tools.grep, "grep is registered with contained operations");
  await assert.rejects(tools.grep.execute("call", { pattern: "secret", path: "linked" }, undefined, undefined, { cwd: workspace }), /link|not followed|outside/);
  // A match's lines are read as read reads: not through a file that has another name.
  writeFileSync(join(base, "profile"), "before\nsecret line\nafter\n");
  const { linkSync } = await import("node:fs");
  linkSync(join(base, "profile"), join(workspace, "alias"));
  for (const context of [undefined, 0, 1]) {
    await assert.rejects(tools.grep.execute("call", { pattern: "secret line", path: "alias", context }, undefined, undefined, { cwd: workspace }), /other names/);
    const found = await tools.grep.execute("call", { pattern: "secret", context }, undefined, undefined, { cwd: workspace });
    const shown = found.content.map(part => part.text ?? "").join("");
    assert.match(shown, /notes.txt:1: a secret of the workspace/);
    assert.doesNotMatch(shown, /host secret|secret line|before|after|alias|linked/);
  }
  assert.ok(tools.find);
  const found = await tools.find.execute("call", { pattern: "*" }, undefined, undefined, { cwd: workspace });
  assert.match(found.content.map(part => part.text ?? "").join(""), /notes.txt/);
  assert.doesNotMatch(found.content.map(part => part.text ?? "").join(""), /alias|linked/);
  // The engine's ripgrep and fd, as the pinned engine runs them: never told to follow a link.
  for (const tool of ["grep", "find"]) {
    const source = readFileSync(new URL(`../../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/${tool}.js`, import.meta.url), "utf8");
    assert.match(source, /spawn\((?:rgPath|fdPath), args/, `${tool} no longer runs its program as this test knows it`);
    assert.doesNotMatch(source, /["'](?:--follow|-L)["']/, `${tool} is run with link following`);
  }
});

test("P0V-123 / G03-broker-01, r2-02: an answer too large to send after the request was handled is an unknown outcome, asked again under the same key", async t => {
  const { EventEmitter } = await import("node:events");
  const { RpcConnection } = await import("@oma/broker/connection");
  const { SharedPeerPin } = await import("@oma/broker/peer-pin");
  const { encodeFrame, FrameParser } = await import("@oma/protocol/frame");
  class Sock extends EventEmitter {
    destroyed = false; output: Buffer[] = [];
    pause(): void {} resume(): void {}
    write(bytes: Uint8Array): boolean { this.output.push(Buffer.from(bytes)); return true; }
    end(bytes?: Uint8Array): void { if (bytes) this.output.push(Buffer.from(bytes)); }
    destroy(): void { if (!this.destroyed) { this.destroyed = true; this.emit("close", false); } }
  }
  const root = mkdtempSync(join(tmpdir(), "oma-answer-"));
  t.after(() => { rmSync(root, { recursive: true, force: true }); });
  const socket = new Sock(); const tasks: Promise<unknown>[] = [];
  let handled = false;
  new RpcConnection({ socket, peer: new SharedPeerPin(() => true, () => undefined), makeSpool: (descriptor: RawDescriptor) => new TransportSpool(root, descriptor),
    limits: { frameBytes: 256, idleStreamSeconds: 2, receiptWaitSeconds: 5 },
    handle: async () => { handled = true; return { v: 1, id: "req", ok: true, result: { big: "x".repeat(2000) } }; },
    preflight: () => undefined, onTask: (task: Promise<unknown>) => { tasks.push(task); } } as never);
  socket.emit("data", encodeFrame({ v: 1, id: "req", method: "mail.send", params: {} }));
  await Promise.allSettled(tasks); await new Promise(resolve => setImmediate(resolve));
  const frames = socket.output.flatMap(chunk => new FrameParser(1 << 20).feed(chunk).map(frame => frame.raw));
  assert.equal(handled, true);
  assert.deepEqual(frames.map(frame => [frame.ok, (frame.error as { code: string; retry: string }).code, (frame.error as { retry: string }).retry]),
    [[false, "FRAME_TOO_LARGE", "same-key"]], "a handled request was answered as refused input");
});

test("P0V-124 / G03-broker-r2-04: one judgment of whether a peer runs inside a unit's cgroup", async () => {
  const { insideCgroup } = await import("@oma/broker/peer-authenticator");
  const unit = "/user.slice/app.slice/oma-demo-alice.service";
  assert.equal(insideCgroup(unit, unit), true);
  assert.equal(insideCgroup(`${unit}/payload`, unit), true);
  assert.equal(insideCgroup(`${unit}/payload`, `${unit}/`), true);
  assert.equal(insideCgroup(`${unit}x`, unit), false, "a sibling whose name begins the same is not inside");
  assert.equal(insideCgroup("/user.slice/app.slice", unit), false);
  for (const [peer, group] of [[null, unit], [unit, ""], [unit, null], ["", unit]] as const) assert.equal(insideCgroup(peer, group), false);
});

test("P0V-126 / G02-ledger-r2-03: every row a store writes is stamped from its one clock, clamped where it steps back", async t => {
  const { Store } = await import("@oma/storage");
  const { makeValidAgent } = await import("./fixtures/spec.js");
  const root = mkdtempSync(join(tmpdir(), "oma-clock-"));
  let clock = 5_000_000;
  const store = new Store(join(root, "runtime.sqlite"), undefined, null, () => clock);
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  store.transaction(tx => { tx.insertAgent(makeValidAgent("alice")); });
  assert.deepEqual([store.getAgent("alice")!.createdAtMs, store.getAgent("alice")!.updatedAtMs], [5_000_000, 5_000_000]);
  clock = 4_000_000;
  store.transaction(tx => { tx.updateAgent({ name: "alice", incarnation: store.getAgent("alice")!.incarnation + 1 }); tx.follow("news", "alice"); });
  assert.equal(store.getAgent("alice")!.updatedAtMs, 5_000_000, "a clock that stepped back is clamped at the row's creation");
  assert.equal(store.allSubscriptions().find(row => row.topic === "news")?.createdAtMs, 4_000_000, "a subscription read its own clock");
  clock = 6_000_000;
  store.transaction(tx => { tx.updateAgent({ name: "alice", desired: "stopped" }); });
  assert.equal(store.getAgent("alice")!.updatedAtMs, 6_000_000);
  // An operation is stamped from the same clock.
  const { requestHash } = await import("@oma/domain/request-identity");
  const { makeValidMessagePlan } = await import("./fixtures/valid.js");
  const operation = "op-00000000-0000-4000-8000-000000000126";
  const input = { to: ["alice"], subject: "clock", kind: "message", body: "clock\n" };
  clock = 7_000_000;
  store.transaction(tx => { tx.acceptOperation({ id: operation, actor: "alice", requestKey: "clock-126", requestHash: requestHash("mail.send", input),
    kind: "mail.send", payloadJson: JSON.stringify(input), planJson: serializePlanIntent({ kind: "mail.send", message: makeValidMessagePlan(operation) }) });
    tx.insertDeliveries([{ messageId: "m-00000000-0000-4000-8000-000000000126-0", recipient: "alice", operationId: operation }]); });
  const row = store.getOperationById(operation as never)!;
  assert.deepEqual([row.createdAtMs, row.updatedAtMs], [7_000_000, 7_000_000]);
});


test("P0V-127 / G05-04: another owner's unit proves neither death nor an empty process list", async t => {
  const { UnitsModule, renderUnit } = await import("@oma/platform-linux/units");
  const dir = mkdtempSync(join(tmpdir(), "oma-foreign-death-"));
  t.after(() => { rmSync(dir, { recursive: true, force: true }); });
  const values = { node: process.execPath, libdir: process.cwd(), state: join(dir, "ours"), society: "demo", agent: "alice",
    config: join(dir, "config.json"), run: join(dir, "run") };
  const units = new UnitsModule("demo", values, dir, () => 1);
  let revoked = 0;
  units.onRevokeRun = () => { revoked++; };
  for (const [suffix, description] of [["service", "OMA @SOCIETY@ resident @AGENT@"], ["path", "Wake OMA @SOCIETY@ resident @AGENT@ on mail"]]) {
    const path = join(dir, `oma-demo-alice.${suffix}`);
    writeFileSync(path, renderUnit(`[Unit]\nDescription=${description}\nX-OMA-Owner=@STATE@\n`, { ...values, state: join(dir, "theirs") }));
    assert.equal(units.observe("alice").activeState, "unknown");
    assert.equal((await units.observeAsync("alice")).activeState, "unknown");
    assert.equal((await units.observeStatus(["alice"])).get("alice"), "no-unit", "the diagnostic view still identifies the name collision");
    for (const incarnation of [0, 1]) assert.equal(units.confirmDead("alice", incarnation), false);
    assert.throws(() => units.cgroupProcs("alice"), { code: "RUN_TERMINATION_UNKNOWN" });
    assert.throws(() => units.stop("alice", 1), { code: "RUN_TERMINATION_UNKNOWN" });
    rmSync(path);
  }
  assert.equal(revoked, 2, "our own run authority is still revoked without touching the foreign unit");
});
