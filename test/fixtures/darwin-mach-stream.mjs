/** Real Darwin/Node transport observations. Never a substitute for execution
 * scope, filesystem, actor-membership or full G-AUTH qualification. Children
 * are trusted probe processes; joining them proves only their own exit.
 */
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createMachEndpoint, listenMachService, lookupMachService } from "@oma/native/mach-message";
import { cleanupAll, withAsyncCleanup } from "@oma/native/cleanup";
import { observeDarwinAuditOrigin } from "@oma/native/audit-origin";
import { bindMachSender } from "@oma/platform-mac/audit-peer";
import { createMachBrokerTransport, dialMachChannel } from "@oma/platform-mac/mach-transport";

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
  return transport;
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
async function roundtrip() {
  const path = address(), expected = payload(), done = deferred(); let sender, observed;
  await listener(path, (socket, transport) => {
    const pin = claim(socket, transport); sender = pin.pid;
    const bytes = [];
    socket.on("data", chunk => bytes.push(chunk)); socket.on("error", done.reject);
    socket.on("end", () => {
      try { observed = Buffer.concat(bytes); assert.deepEqual(observed, expected); socket.end(observed); }
      catch (error) { done.reject(error); socket.destroy(error); }
    });
    socket.on("close", () => { try { assert.equal(socket.resourcesReturned, true); done.resolve(); } catch (error) { done.reject(error); } });
  });
  const client = child("child-roundtrip", path);
  await bounded(done.promise, "server byte stream close"); await joined(client);
  assert.equal(sender, client.process.pid);
  return { machStream: { sentBytes: expected.length, receivedBytes: observed.length, sha256: sha256(observed), sender, childJoined: true, authenticatedEof: true, resourcesReturned: true } };
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
  return { machAsyncAudit: { sender: process.pid, matched: true, callbackAsynchronous: true, cancelledBindingRefused: true, claimedPinRetainedUntilExplicitClose: true, nativeCompletionJoined: true } };
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
  if (mode === "child-roundtrip") {
    const { socket, ready } = dialMachChannel(process.argv[3], 15), received = [], ended = deferred(), closed = deferred();
    returns.push(() => socket.destroy()); socket.on("error", ended.reject); socket.on("data", bytes => received.push(bytes));
    socket.on("end", ended.resolve); socket.on("close", closed.resolve); await ready;
    const expected = payload();
    for (let offset = 0; offset < expected.length; offset += 7001)
      await new Promise((resolve, reject) => socket.write(expected.subarray(offset, offset + 7001), error => error ? reject(error) : resolve()));
    socket.end(); await bounded(ended.promise, "client authenticated EOF"); await bounded(closed.promise, "client stream close");
    assert.deepEqual(Buffer.concat(received), expected); assert.equal(socket.resourcesReturned, true); return;
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
    const remote = lookupMachService(serviceFor(process.argv[3])), local = createMachEndpoint(), nonce = randomBytes(16);
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
    if (mode === "mach-stream-stale") return stale();
    if (mode === "mach-stream-handoff") return handoff();
    if (mode === "mach-audit-async") return asyncAudit();
    throw new Error(`unknown Darwin transport case ${mode}`);
  }, cleanup);
  if (observation !== null) console.log(JSON.stringify({ case: mode, ...observation }));
} catch (error) { console.error(error); process.exitCode = 1; }
finally { if (process.connected) process.disconnect(); }
