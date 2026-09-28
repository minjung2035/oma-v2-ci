/** The seventh review (adversarial, 2026-09-28): the core's findings, each
 * held by what the product now does. Platform findings are in
 * platform-stream-publication, platform-host-service and platform-snapshot. */
import test from "node:test";
import assert from "node:assert/strict";
import { closeSync, mkdirSync, mkdtempSync, openSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requestKeyOf } from "../src/extension/shared.js";
import { publishNoReplace } from "../src/storage/durable-fs.js";
import { replaceDerivedSymlink } from "../src/storage/staged-tree.js";
import { lockFileDescriptor } from "../src/leaf.js";
import { RequestCache, readCacheFile, type CacheReader } from "../src/request-cache.js";
import { StoreError } from "../src/domain/errors.js";

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
  const { Broker } = await import("../src/broker.js");
  const { LifecycleModule } = await import("../src/lifecycle.js");
  const { ViewsModule } = await import("../src/views.js");
  const { RunRegistry } = await import("../src/runtime/run-registry.js");
  const { preparedFixture } = await import("./fixtures/delivery-receipt.js");
  const { TEST_VIEW_LIMITS } = await import("./fixtures/limits.js");
  let invocation = "c".repeat(32);
  const f = await preparedFixture(1);
  const units = {
    onRevokeRun: undefined, bindIncarnationReader: () => undefined, unitCgroup: () => "",
    observe: () => ({ activeState: "active", subState: "running", result: "success", execMainStatus: 0, cgroup: "/oma/alice", invocationId: invocation }),
  } as never;
  const lifecycle = new LifecycleModule(f.store, units, { stateRoot: f.root, projectGit: join(f.root, "repos", "project.git"), society: "demo",
    hasGoal: () => true, activationAllowed: () => true }, ((_parent: unknown, input: Record<string, unknown>) => ({ ...input })) as never, f.mail);
  const broker = new Broker(f.store, f.mail, units, new ViewsModule(f.store, f.root, "demo", "p", TEST_VIEW_LIMITS), lifecycle, null, null,
    { stateRoot: f.root, runRoot: join(f.root, "run"), society: "demo", hasGoal: () => true });
  t.after(async () => { try { await broker.drainAndClose(); } catch { f.store.close(); } finally { rmSync(f.root, { recursive: true, force: true }); } });
  // Each invocation's cgroup, as the kernel reports it: populated until it dies.
  const cgroups: { population: "populated" | "empty" }[] = [];
  Reflect.set(broker, "runLeases", new RunRegistry(() => {
    const cgroup = { population: "populated" as "populated" | "empty" }; cgroups.push(cgroup);
    return { fd: -1, identity: { dev: 1n, ino: BigInt(cgroups.length) }, population: () => cgroup.population, matches: () => true, close() {} };
  }));
  await broker.start();
  const openRun = (): unknown => (Reflect.get(broker, "openRun") as (actor: string, id: string) => unknown).call(broker, "alice", invocation);
  const incarnation = (): number => f.store.getAgent("alice")!.incarnation;
  const servers = (): number => (Reflect.get(broker, "actorServers") as Set<unknown>).size;
  const nextInvocation = (): void => { cgroups.at(-1)!.population = "empty"; invocation = String(cgroups.length).padStart(32, "d"); };
  const before = incarnation(); const listening = servers();
  // The endpoint could not be made (a full disk, a path too long).
  const listen = Reflect.get(broker, "listenActor") as (...args: unknown[]) => unknown;
  Reflect.set(broker, "listenActor", () => { throw Object.assign(new Error("ENOSPC: no space left on device, mkdir"), { code: "ENOSPC" }); });
  assert.throws(openRun, /ENOSPC/);
  Reflect.set(broker, "listenActor", listen);
  assert.equal(incarnation(), before, "a failed open consumed an incarnation");
  // R16/V07B: the invocation whose opening failed ends; it does not retry.
  assert.throws(openRun, { code: "STALE_RUN" });
  // The next invocation: the endpoint was made and the commit then refused.
  nextInvocation();
  const transaction = f.store.transaction.bind(f.store);
  (f.store as unknown as { transaction: unknown }).transaction = () => { throw new StoreError("DB_BUSY", "the ledger is busy"); };
  assert.throws(openRun, { code: "DB_BUSY" });
  (f.store as unknown as { transaction: unknown }).transaction = transaction;
  assert.equal(incarnation(), before);
  assert.equal(servers(), listening, "the endpoint of a run that was not opened is left listening");
  // The invocation after it opens the incarnation that neither failure took.
  nextInvocation();
  const lease = openRun() as { incarnation: number };
  assert.equal(lease.incarnation, before + 1);
  assert.equal(incarnation(), before + 1);
  assert.equal(servers(), listening + 1);
});

test("P0V-114 / G04-02, G04-03, G03-05: one owner clears a socket's name before a server listens there; a name already gone is no failure, and a file that is not a socket is kept", async t => {
  const { spawnSync } = await import("node:child_process");
  const { existsSync, lstatSync, readFileSync } = await import("node:fs");
  const { clearSocketName } = await import("../src/storage/socket-name.js");
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
  const { EgressForwarder } = await import("../src/runtime/egress-forwarder.js");
  const dir = mkdtempSync(join(tmpdir(), "oma-sock-"));
  t.after(() => { rmSync(dir, { recursive: true, force: true }); });
  const path = join(dir, "principal-inference.sock");
  const run = { placeholderId: UUID, society: "demo", actor: "principal", incarnation: 0, modelProfile: "p" };
  const first = await EgressForwarder.listen(path, join(dir, "egress.sock"), run, 1);
  const closing = first.close();
  assert.equal(existsSync(path), false, "the closing forwarder's name is gone as close returns");
  const next = createServer();
  next.listen(path);
  t.after(() => { next.close(); });
  await closing;
  assert.equal(existsSync(path), true, "a closed forwarder removed the next server's name");
});

test("P0V-114 / G04-01: what a tenure holds ends with it, before the society is free; one handed over after the end is closed at once", async t => {
  const { HostTenure } = await import("../src/runtime/host-tenure.js");
  const { tryHoldSociety } = await import("../src/runtime/society-lease.js");
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
  const { renderUnit } = await import("../src/units/render.js");
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
  const { GitObserver } = await import("../src/git/observe.js");
  const { compareAndSwapCanonicalRef, createCanonicalRef } = await import("../src/git/canonical-command.js");
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
  const { pidfdLiveness } = await import("../src/leaf.js");
  // /dev/null polls readable, exactly as a pidfd of an exited process does.
  const fd = openSync("/dev/null", "r");
  try { assert.deepEqual(pidfdLiveness(fd), { kind: "failed", errno: 9 }); }
  finally { closeSync(fd); }
  assert.deepEqual(pidfdLiveness(fd), { kind: "failed", errno: 9 }, "a closed number is no answer either");
});

test("P0V-118 / G07-02, G07-03: a message's values are refused as the request they are; a header block is judged by one rule in either form", async () => {
  const { buildEml } = await import("../src/mail/serialize.js");
  const { parseEmlHeaders } = await import("../src/mail/headers.js");
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
