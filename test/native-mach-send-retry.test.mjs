/** Actual bounded Mach queue and fileport return. This is no role, child or
 * complete execution-scope oracle. Linux executes only the platform refusal. */
import test from "node:test";
import assert from "node:assert/strict";
import { closeSync, readSync, writeSync } from "node:fs";
import { controlPipe } from "@oma/native/control-socket";
import { currentDarwinAuditToken } from "@oma/native/audit-session";
import { createMachEndpoint, createMachFilePort, openMachFilePort } from "@oma/native/mach-message";

test("001. A full actual Mach queue returns fileport send copies and permits bounded delivery retry", { timeout: 15000 }, t => {
  if (process.platform !== "darwin") {
    assert.throws(() => createMachEndpoint(), { code: "UNSUPPORTED_PROFILE" }); return;
  }
  const endpoint = createMachEndpoint(), pipe = controlPipe(), descriptors = new Set([pipe.read, pipe.write]), ports = [];
  const close = fd => { if (descriptors.delete(fd)) closeSync(fd); };
  t.after(() => {
    const failures = [];
    for (const cleanup of [...ports.map(port => () => port.close()), () => endpoint.receive.close(), () => endpoint.send.close(),
      ...[...descriptors].map(fd => () => close(fd))]) try { cleanup(); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures);
  });
  const token = currentDarwinAuditToken(), body = Buffer.from([1, 0, 0, 0]);
  const source = createMachFilePort(pipe.read); ports.push(source); close(pipe.read);
  let queued = 0;
  while (queued < 1024 && endpoint.send.send(100, body) === "sent") queued++;
  assert.ok(queued > 0 && queued < 1024, "observed bounded queue pressure");
  // Each failed send pseudo-receives its temporary SEND copy. Retrying must
  // keep the original usable and must not leave a hidden reader reference.
  for (let attempt = 0; attempt < 3; ++attempt) assert.equal(endpoint.send.send(101, body, source), "again");
  const receive = () => {
    const packet = endpoint.receive.receive(); assert.equal(packet.kind, "data");
    assert.deepEqual(packet.sender.token, token); assert.deepEqual(packet.bytes, body); return packet;
  };
  const first = receive(); assert.equal(first.id, 100); assert.equal(first.reply, null);
  assert.equal(endpoint.send.send(101, body, source), "sent");
  for (let index = 1; index < queued; ++index) {
    const packet = receive(); assert.equal(packet.id, 100); assert.equal(packet.reply, null);
  }
  const delivered = receive(); assert.equal(delivered.id, 101); assert.ok(delivered.reply); ports.push(delivered.reply);
  const received = openMachFilePort(delivered.reply); descriptors.add(received);
  writeSync(pipe.write, Buffer.from("same pipe"));
  const bytes = Buffer.alloc(9); assert.equal(readSync(received, bytes), 9); assert.equal(bytes.toString(), "same pipe");
  close(received); delivered.reply.close(); source.close();
  assert.equal(endpoint.receive.receive().kind, "again");
  assert.throws(() => writeSync(pipe.write, Buffer.from([1])), { code: "EPIPE" }, "every received and pseudo-received reader was returned");
});
