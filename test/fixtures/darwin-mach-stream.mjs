/** Real Darwin/Node transport observations. Never a substitute for execution
 * scope, filesystem, actor-membership or full G-AUTH qualification. Children
 * are trusted probe processes; joining them proves only their own exit.
 */
import assert from "node:assert/strict";
import { fork, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { closeSync, fstatSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createMachEndpoint, createMachFilePort, openMachFilePort, listenMachService, lookupMachService } from "@oma/native/mach-message";
import { cleanupAll, withAsyncCleanup } from "@oma/native/cleanup";
import { observeDarwinAuditOrigin } from "@oma/native/audit-origin";
import { bindMachSender } from "@oma/platform-mac/audit-peer";
import { createMachBrokerTransport, dialMachChannel } from "@oma/platform-mac/mach-transport";
import { launchDarwinJobScope, launchSeatbeltJobScope, peerFromMachReceiver } from "@oma/platform-mac/job-scope";
import { ExecutionCoordinator } from "@oma/process/owned-execution";
import { spawnWithPrivateInputs } from "@oma/process/async";
import { prepareSeatbelt } from "@oma/platform-mac/seatbelt";
import { identifyDarwinCoalition, pinInheritedDarwinPeer } from "@oma/native/audit-session";

assert.equal(process.platform, "darwin", "this probe requires an actual Darwin kernel");
const OPEN = 0x4f4d4101, OPENED = 0x4f4d4104, DATA = 0x4f4d4102, HANDOFF = 0x4f4d4110;
const self = fileURLToPath(import.meta.url), mode = process.argv[2];
const serviceFor = path => `com.oma.rpc.${createHash("sha256").update(path).digest("hex")}`;
const unique = () => `com.oma.probe.${process.pid}.${randomBytes(12).toString("hex")}`;
const address = () => `/oma-probe-${process.pid}-${randomBytes(12).toString("hex")}`;
const payload = () => Buffer.from(Array.from({ length: 393217 }, (_, at) => (at * 37 + 19) & 255));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
// A case has one shared observation budget and then a separate cleanup
// budget. The driver's 120-second process ceiling stays outside both.
let deadline = performance.now() + 45000;
async function bounded(promise, label, milliseconds = 20000) {
  let timer;
  const remaining = Math.max(1, Math.min(milliseconds, deadline - performance.now()));
  try {
    const result = await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} deadline exceeded`)), remaining); })]);
    if (performance.now() > deadline) throw new Error(`${label} exceeded the case deadline`);
    return result;
  }
  finally { clearTimeout(timer); }
}
async function receive(owner) {
  const end = Math.min(deadline, performance.now() + 20000);
  while (performance.now() < end) { const message = owner.receive(); if (message.kind === "data") return message; await delay(2); }
  throw new Error("Mach receive deadline exceeded");
}
async function send(owner, id, bytes, reply) {
  const end = Math.min(deadline, performance.now() + 20000);
  while (performance.now() < end) { if (owner.send(id, bytes, reply) === "sent") return; await delay(2); }
  throw new Error("Mach send deadline exceeded");
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); void promise.catch(() => {}); return { promise, resolve, reject }; }
function mailbox(source) {
  const pending = [], waiting = [];
  source.on("message", value => { const waiter = waiting.shift(); if (waiter) waiter.resolve(value); else pending.push(value); });
  const end = error => { for (const waiter of waiting.splice(0)) waiter.reject(error); };
  source.on("disconnect", () => end(new Error("probe IPC disconnected")));
  source.on("error", end);
  return async kind => {
    const next = deferred();
    if (pending.length) next.resolve(pending.shift()); else waiting.push(next);
    const value = await bounded(next.promise, `IPC ${kind}`);
    assert.equal(value?.kind, kind, JSON.stringify(value)); return value;
  };
}
const children = [], returns = [];
function child(role, ...args) {
  const process = fork(self, [role, ...args], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const record = { process, stderr: "", closed: deferred(), message: mailbox(process), terminal: false };
  process.stderr.on("data", bytes => { record.stderr += bytes.toString(); });
  process.once("error", error => record.closed.reject(error));
  process.once("close", (code, signal) => { record.terminal = true; record.closed.resolve({ code, signal }); });
  children.push(record); return record;
}
async function joined(record) {
  const status = await bounded(record.closed.promise, "probe child close");
  assert.deepEqual(status, { code: 0, signal: null }, record.stderr); return status;
}
async function cleanup() {
  deadline = performance.now() + 30000;
  const failures = [];
  // Stop all actual probe children before returning their receiving endpoints.
  for (const record of children) if (!record.terminal) {
    try { record.process.kill("SIGKILL"); } catch (error) { failures.push(error); }
  }
  for (const record of children) {
    try { await bounded(record.closed.promise, "probe child cleanup", 10000); } catch (error) { failures.push(error); }
  }
  for (const release of returns.reverse()) { try { await release(); } catch (error) { failures.push(error); } }
  if (failures.length) throw new AggregateError(failures, "Darwin probe resource return failed");
}
async function listener(path, accept) {
  const transport = createMachBrokerTransport(15), faults = [];
  const { listener } = transport.openListener(socket => accept(socket, transport), 16);
  listener.on("error", error => faults.push(error));
  returns.push(async () => { await bounded(new Promise((resolve, reject) => { try { listener.close(resolve); } catch (error) { reject(error); } }), "listener close"); assert.deepEqual(faults, []); });
  const ready = once(listener, "listening"); listener.listen(path); await bounded(ready, "listener readiness");
  const peer = listener.peerSource(); returns.push(() => peer.close());
  return { transport, peer };
}
function claim(socket, transport) {
  const pin = transport.pinPeer(socket); assert.ok(pin);
  returns.push(() => pin.close());
  assert.equal(pin.alive(), true);
  transport.peerStream(socket, sender => pin.sameSender(sender) && pin.alive());
  returns.push(async () => {
    if (!socket.closed) { const closed = new Promise(resolve => socket.once("close", resolve)); socket.destroy(); await bounded(closed, "stream resource return"); }
    assert.equal(socket.resourcesReturned, true);
  });
  return pin;
}
async function roundtrip(descendant = false) {
  const path = address(), expected = payload(), done = deferred(); let sender, observed;
  const { peer } = await listener(path, (socket, transport) => {
    const pin = claim(socket, transport); sender = pin.pid;
    const bytes = [];
    socket.on("data", chunk => bytes.push(chunk)); socket.on("error", done.reject);
    socket.on("end", () => {
      try { observed = Buffer.concat(bytes); assert.deepEqual(observed, expected); socket.end(observed); }
      catch (error) { done.reject(error); socket.destroy(error); }
    });
    socket.on("close", () => { try { assert.equal(socket.resourcesReturned, true); done.resolve(); } catch (error) { done.reject(error); } });
  });
  await joined(child("child-no-source", path));
  const client = runConfined(descendant ? "child-runner" : "child-roundtrip", path, peer);
  const [, result] = await Promise.all([bounded(done.promise, "server byte stream close"), client]);
  const report = descendant ? JSON.parse(result.stdout) : undefined;
  if (report) {
    assert.equal(report.workerPid, sender); assert.notEqual(report.runnerPid, sender);
    assert.equal(report.sameCoalition, true); assert.equal(report.originalPeer, true);
  }
  return { machStream: { sentBytes: expected.length, receivedBytes: observed.length, sha256: sha256(observed), sender,
    childJoined: true, authenticatedEof: true, resourcesReturned: true, inheritedPeer: true, noSourceRefused: true,
    ...(report === undefined ? {} : { descendant: report }) } };
}
async function runConfined(role, path, peer) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oma-mach-client-"))), rows = [];
  const owner = new ExecutionCoordinator({ entries: () => rows.map(row => ({ ...row })), reserve(slot) {
    const row = { slot, execution: "probe", witness: null }; rows.push(row);
    return { execution: row.execution, publish(witness) { row.witness = witness; }, retire() { rows.splice(rows.indexOf(row), 1); } };
  }, retire() { throw new Error("unexpected recovery"); } }, () => ({ kind: "unavailable" }));
  let returned = false, stderrLogged = 0;
  returns.push(async () => { await owner.drain(); if (returned) rmSync(root, { recursive: true }); });
  const node = realpathSync(process.execPath), library = realpathSync(fileURLToPath(new URL("../../", import.meta.url)));
  const command = { executable: node, argv: [self, role, path], env: { HOME: root, TMPDIR: root }, cwd: root,
    timeoutMs: 20000, stdoutBytes: 8192, stderrBytes: 16384 };
  const policy = { readable: [{ path: library, kind: "directory" }], mapped: [{ path: library, kind: "directory" }],
    writable: [{ path: root, kind: "directory" }], denied: [], executable: [{ path: node, kind: "file" }],
    unixSockets: [], machServices: [], environmentKeys: ["HOME", "TMPDIR"] };
  const launch = options => role === "child-runner" ? launchDarwinJobScope(command, options) : launchSeatbeltJobScope(command, policy, options);
  const result = await owner.run({ slot: "client", launch: () => launch({ peer, stderrSink(bytes) {
    const retained = bytes.subarray(0, Math.max(0, 16384 - stderrLogged)); stderrLogged += retained.length;
    if (retained.length) process.stderr.write(retained);
  } }), authorize() {} });
  returned = true;
  const diagnostic = JSON.stringify({ ...result, stdout: result.stdout.toString(), stderr: result.stderr.toString(),
    ...(result.error === undefined ? {} : { error: String(result.error) }) });
  assert.equal(result.kind, "exited", diagnostic); assert.equal(result.exitCode, 0, diagnostic);
  assert.deepEqual(rows, []); return result;
}
async function wrongPeer() {
  const path = address(), receiver = listenMachService(serviceFor(path)); returns.push(() => receiver.close());
  const peer = peerFromMachReceiver(receiver); returns.push(() => peer.close());
  const impostor = child("child-impostor", unique()); const ready = await impostor.message("ready");
  const client = runConfined("child-refuse-peer", path, peer);
  const request = await Promise.race([receive(receiver), client.then(() => { throw new Error("client ended before OPEN"); })]);
  assert.equal(request.id, OPEN); assert.equal(request.bytes.length, 48);
  assert.ok(request.reply); returns.push(() => request.reply.close());
  const remote = lookupMachService(ready.name); returns.push(() => remote.close());
  await send(remote, HANDOFF, request.bytes, request.reply);
  const sent = await impostor.message("sent");
  assert.equal(sent.pid, impostor.process.pid); assert.notEqual(sent.pid, process.pid);
  const result = await client;
  assert.match(result.stdout.toString(), /expected-peer-refused/);
  impostor.process.send({ kind: "finish" }); await joined(impostor);
  return { expectedPeer: { originalAlive: true, impostorPid: sent.pid, clientRefused: true, resourcesReturned: true } };
}
async function stale() {
  const name = unique(), receiver = listenMachService(name); returns.push(() => receiver.close());
  const client = child("child-stale", name); await joined(client);
  const message = await receive(receiver); returns.push(() => message.reply?.close());
  assert.equal(message.id, HANDOFF); assert.equal(message.sender.pid, client.process.pid);
  let binding;
  try { binding = bindMachSender(message.sender); }
  catch (error) { if (error instanceof AggregateError) throw error; }
  if (binding !== undefined) {
    // A failed resource return must fail the case, rather than satisfy the
    // negative identity assertion as though it were an ordinary refusal.
    await withAsyncCleanup(() => assert.rejects(binding.ready), () => binding.close());
  }
  return { machStaleOrigin: { queuedSender: message.sender.pid, childJoinedBeforeReceive: true, auditBindingRefused: true } };
}
async function asyncAudit() {
  const endpoint = createMachEndpoint();
  returns.push(() => cleanupAll([() => endpoint.send.close(), () => endpoint.receive.close()]));
  await send(endpoint.send, HANDOFF, Buffer.alloc(4)); const message = await receive(endpoint.receive);
  returns.push(() => message.reply?.close()); assert.equal(message.sender.pid, process.pid);
  const observation = observeDarwinAuditOrigin(message.sender.token); returns.push(() => observation.returned);
  let settled = false; void observation.result.then(() => { settled = true; }, () => { settled = true; });
  await new Promise(resolve => process.nextTick(resolve));
  assert.equal(settled, false, "the native callback must be asynchronous");
  assert.deepEqual(await bounded(observation.result, "actual Security validation"), { kind: "matched" });
  await bounded(observation.returned, "actual CF return");
  const cdhash = path => {
    const result = spawnSync("/usr/bin/codesign", ["--display", "--verbose=4", path], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0, result.stderr);
    const hash = /^CDHash=([0-9a-f]{40})$/m.exec(result.stderr)?.[1]; assert.ok(hash, result.stderr); return hash;
  };
  const ownHash = cdhash(process.execPath), otherHash = cdhash("/bin/sh"); assert.notEqual(ownHash, otherHash);
  const hashes = [ownHash], selected = observeDarwinAuditOrigin(message.sender.token, hashes);
  returns.push(() => selected.returned); hashes[0] = otherHash;
  assert.deepEqual(await bounded(selected.result, "selected main image"), { kind: "matched" });
  await bounded(selected.returned, "selected requirement CF return");
  const wrong = observeDarwinAuditOrigin(message.sender.token, [otherHash]); returns.push(() => wrong.returned);
  const refused = await bounded(wrong.result, "different signed image");
  assert.equal(refused.kind, "unavailable"); assert.notEqual(refused.osStatus, 0);
  await bounded(wrong.returned, "mismatched requirement CF return");
  const path = join(process.cwd(), `fileport-${randomBytes(12).toString("hex")}`);
  writeFileSync(path, "FILEPORT_BYTES\n", { flag: "wx", mode: 0o600 }); returns.push(() => unlinkSync(path));
  const source = openSync(path, "r"), expected = fstatSync(source); let file;
  try { file = createMachFilePort(source); } finally { closeSync(source); }
  returns.push(() => file.close());
  await send(endpoint.send, HANDOFF, Buffer.alloc(4), file);
  const transferred = await receive(endpoint.receive); assert.ok(transferred.reply); returns.push(() => transferred.reply.close());
  const fd = openMachFilePort(transferred.reply);
  try {
    const actual = fstatSync(fd); assert.equal(actual.dev, expected.dev); assert.equal(actual.ino, expected.ino);
    assert.equal(readFileSync(fd, "utf8"), "FILEPORT_BYTES\n");
  } finally { closeSync(fd); }
  const shared = openMachFilePort(file);
  try { assert.equal(readFileSync(shared, "utf8"), ""); } finally { closeSync(shared); }
  assert.throws(() => openMachFilePort(endpoint.send), /file descriptor/);
  const cancelled = bindMachSender(message.sender); returns.push(() => cancelled.close());
  const closing = cancelled.close(); let returned = false; void closing.then(() => { returned = true; }, () => {});
  assert.equal(returned, false); assert.throws(() => cancelled.take(), { code: "AUTH_FAILED" });
  await assert.rejects(cancelled.ready, { code: "AUTH_FAILED" }); await bounded(closing, "cancelled native binding return");
  assert.throws(() => cancelled.take(), { code: "AUTH_FAILED" });
  const acquired = bindMachSender(message.sender); returns.push(() => acquired.close());
  await bounded(acquired.ready, "live native binding"); const pin = acquired.take(); returns.push(() => pin.close());
  assert.equal(pin.sameSender(message.sender), true); assert.equal(pin.sameSender({ ...message.sender }), false);
  assert.throws(() => acquired.take(), { code: "AUTH_FAILED" });
  await acquired.close(); assert.equal(pin.alive(), true, "a transferred pin has its own resource owner");
  pin.close(); assert.equal(pin.alive(), false);
  return { machAsyncAudit: { sender: process.pid, matched: true, callbackAsynchronous: true, cancelledBindingRefused: true,
    claimedPinRetainedUntilExplicitClose: true, nativeCompletionJoined: true,
    selectedImage: { ownHash, otherHash, requirementFrozenBeforeAwait: true, matched: true, mismatch: refused },
    fileport: { sourceClosedBeforeSend: true, sameInode: true, exactBytes: true, sharedCursor: true, ordinaryPortRefused: true } } };
}
async function handoff() {
  const path = address(), holder = child("child-holder", unique()), ready = await holder.message("ready");
  const accepted = deferred(), positive = deferred(), refused = deferred(); let pin, total = 0;
  await listener(path, (socket, transport) => {
    pin = claim(socket, transport); accepted.resolve();
    socket.on("data", bytes => {
      try { total += bytes.length; assert.equal(total, 4); assert.equal(bytes.readUInt32LE(0), pin.pid); positive.resolve(); }
      catch (error) { positive.reject(error); refused.reject(error); socket.destroy(error); }
    });
    socket.on("error", error => { try { assert.equal(error.code, "AUTH_FAILED"); refused.resolve(); } catch (wrong) { refused.reject(wrong); } });
  });
  const connector = child("child-connector", path, ready.name);
  await bounded(accepted.promise, "server peer pin"); await bounded(positive.promise, "original sender positive control");
  const transferred = await holder.message("transferred"); assert.equal(transferred.claimedPid, connector.process.pid);
  assert.equal(pin.pid, connector.process.pid); assert.equal(pin.alive(), true);
  assert.equal(connector.process.exitCode, null); assert.equal(holder.process.exitCode, null);
  holder.process.send({ kind: "send" }); await holder.message("sent"); await bounded(refused.promise, "foreign packet refusal");
  assert.equal(total, 4, "the foreign packet must expose no bytes"); assert.equal(pin.alive(), true, "the original connector remains alive after refusal");
  connector.process.send({ kind: "finish" }); holder.process.send({ kind: "finish" }); await joined(connector); await joined(holder);
  return { machLiveHandoff: { connector: connector.process.pid, holder: holder.process.pid, positiveBytes: total, foreignBytes: 0, originalAliveAtRefusal: true, auditBindingRefused: true, childrenJoined: true } };
}
async function runChild() {
  const commands = mailbox(process);
  if (mode === "child-no-source") {
    assert.throws(() => dialMachChannel(process.argv[3], 15), { code: "AUTH_FAILED" }); return;
  }
  if (mode === "child-refuse-peer") {
    const { socket, ready } = dialMachChannel(process.argv[3], 15), closed = deferred();
    returns.push(() => socket.destroy()); socket.on("error", () => {}); socket.once("close", closed.resolve);
    await assert.rejects(ready, { code: "AUTH_FAILED" }); await bounded(closed.promise, "refused client close");
    assert.equal(socket.resourcesReturned, true); console.log("expected-peer-refused"); return;
  }
  if (mode === "child-impostor") {
    const name = process.argv[3], receiver = listenMachService(name), endpoint = createMachEndpoint();
    returns.push(() => cleanupAll([() => receiver.close(), () => endpoint.receive.close(), () => endpoint.send.close()]));
    process.send({ kind: "ready", name }); const message = await receive(receiver);
    assert.equal(message.id, HANDOFF); assert.ok(message.reply); returns.push(() => message.reply.close());
    await send(message.reply, OPENED, message.bytes, endpoint.send);
    process.send({ kind: "sent", pid: process.pid }); await commands("finish"); return;
  }
  if (mode === "child-runner") {
    // Production topology: one trusted Runner's outer scope, then a direct
    // private-profile Worker spawn. No second launchd job or public lookup.
    const node = realpathSync(process.execPath), library = realpathSync(fileURLToPath(new URL("../../", import.meta.url)));
    const root = realpathSync(process.cwd()), inherited = pinInheritedDarwinPeer(); returns.push(() => inherited.close());
    const coalition = identifyDarwinCoalition(process.pid); assert.ok(coalition);
    const recipe = prepareSeatbelt({ executable: node, argv: [self, "child-roundtrip", process.argv[3], "report"],
      env: { HOME: root, TMPDIR: root }, cwd: root, timeoutMs: 20000, stdoutBytes: 8192, stderrBytes: 16384 }, {
      readable: [{ path: library, kind: "directory" }], mapped: [{ path: library, kind: "directory" }],
      writable: [{ path: root, kind: "directory" }], denied: [], executable: [{ path: node, kind: "file" }],
      unixSockets: [], machServices: [], environmentKeys: ["HOME", "TMPDIR"] });
    const child = spawnWithPrivateInputs(recipe.command.executable, recipe.command.argv, root,
      Object.fromEntries(Object.entries(recipe.command.env).filter(([, value]) => value !== undefined)), recipe.privateInputs);
    const output = [], errors = [];
    child.stdout.on("data", bytes => output.push(bytes)); child.stderr.on("data", bytes => errors.push(bytes));
    const closed = new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal })); });
    void closed.catch(() => {});
    returns.push(async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); await bounded(closed, "Worker cleanup", 10000); });
    child.stdin.end(); const status = await bounded(closed, "direct Worker return");
    assert.deepEqual(status, { code: 0, signal: null }, Buffer.concat(errors).toString());
    const report = JSON.parse(Buffer.concat(output));
    assert.deepEqual(report.coalition, coalition); assert.deepEqual(report.peer, inherited.token);
    assert.equal(inherited.alive(), true); assert.notEqual(report.pid, process.pid);
    console.log(JSON.stringify({ runnerPid: process.pid, workerPid: report.pid, sameCoalition: true, originalPeer: true })); return;
  }
  if (mode === "child-roundtrip") {
    const { socket, ready } = dialMachChannel(process.argv[3], 15), received = [], ended = deferred(), closed = deferred();
    returns.push(() => socket.destroy()); socket.on("error", ended.reject); socket.on("data", bytes => received.push(bytes));
    socket.on("end", ended.resolve); socket.on("close", closed.resolve); await ready;
    const expected = payload();
    for (let offset = 0; offset < expected.length; offset += 7001)
      await new Promise((resolve, reject) => socket.write(expected.subarray(offset, offset + 7001), error => error ? reject(error) : resolve()));
    socket.end(); await bounded(ended.promise, "client authenticated EOF"); await bounded(closed.promise, "client stream close");
    assert.deepEqual(Buffer.concat(received), expected); assert.equal(socket.resourcesReturned, true);
    if (process.argv[4] === "report") {
      const inherited = pinInheritedDarwinPeer(); returns.push(() => inherited.close());
      console.log(JSON.stringify({ pid: process.pid, coalition: identifyDarwinCoalition(process.pid), peer: inherited.token }));
    }
    return;
  }
  if (mode === "child-stale") {
    const remote = lookupMachService(process.argv[3]); returns.push(() => remote.close()); await send(remote, HANDOFF, Buffer.alloc(4)); return;
  }
  if (mode === "child-holder") {
    const name = process.argv[3], receiver = listenMachService(name); returns.push(() => receiver.close()); process.send({ kind: "ready", name });
    const message = await receive(receiver); assert.equal(message.id, HANDOFF); assert.ok(message.reply); returns.push(() => message.reply.close());
    const claimedPid = message.bytes.readUInt32LE(0); process.send({ kind: "transferred", claimedPid }); await commands("send");
    const packet = Buffer.alloc(8); packet.writeUInt32LE(4, 0); packet.writeUInt32LE(claimedPid, 4);
    await send(message.reply, DATA, packet); process.send({ kind: "sent" }); await commands("finish"); return;
  }
  if (mode === "child-connector") {
    const remote = lookupMachService(serviceFor(process.argv[3])), local = createMachEndpoint();
    const nonce = Buffer.concat([randomBytes(16), createHash("sha256").update(serviceFor(process.argv[3])).digest()]);
    returns.push(() => cleanupAll([() => remote.close(), () => local.send.close(), () => local.receive.close()]));
    await send(remote, OPEN, nonce, local.send); const ack = await receive(local.receive);
    assert.equal(ack.id, OPENED); assert.deepEqual(ack.bytes, nonce); assert.ok(ack.reply); returns.push(() => ack.reply.close());
    const packet = Buffer.alloc(8); packet.writeUInt32LE(4, 0); packet.writeUInt32LE(process.pid, 4); await send(ack.reply, DATA, packet);
    const holder = lookupMachService(process.argv[4]); returns.push(() => holder.close());
    const identity = Buffer.alloc(4); identity.writeUInt32LE(process.pid); await send(holder, HANDOFF, identity, ack.reply);
    await commands("finish"); return;
  }
  throw new Error(`unknown child role ${mode}`);
}
try {
  const observation = await withAsyncCleanup(async () => {
    if (mode?.startsWith("child-")) { await runChild(); return null; }
    if (mode === "mach-stream-roundtrip") return roundtrip();
    if (mode === "mach-stream-descendant") return roundtrip(true);
    if (mode === "mach-stream-wrong-peer") return wrongPeer();
    if (mode === "mach-stream-stale") return stale();
    if (mode === "mach-stream-handoff") return handoff();
    if (mode === "mach-audit-async") return asyncAudit();
    throw new Error(`unknown Darwin transport case ${mode}`);
  }, cleanup);
  if (observation !== null) console.log(JSON.stringify({ case: mode, ...observation }));
} catch (error) { console.error((await import("node:util")).inspect(error, { depth: 12, maxArrayLength: 24 })); process.exitCode = 1; }
finally { if (process.connected) process.disconnect(); }
