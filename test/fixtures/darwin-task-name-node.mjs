/** Runs inside the actual production Seatbelt recipe. This controlled actor
 * deliberately replaces its registered source; no role is granted here. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { decode, load } from "koffi";
import { pinInheritedDarwinPeer } from "@oma/native/audit-session";

const pin = pinInheritedDarwinPeer();
const nativeSource = { token: pin.token, coalitionId: pin.coalitionId, alive: pin.alive(), frozen: Object.isFrozen(pin.token) };
pin.close(); pin.close(); nativeSource.afterClose = pin.alive();
console.log(JSON.stringify({ nativeSource }));
for (const mode of ["--query", "--self", "--forged"]) {
  const result = spawnSync(process.argv[1], [mode, process.argv[2]], { encoding: "utf8" });
  assert.equal(result.status, 0, JSON.stringify(result)); process.stdout.write(result.stdout);
}

const library = load(null), task = decode.uint(library.symbol("mach_task_self_"));
const ownName = library.func("int task_name_for_pid(unsigned int task, int pid, void *output)");
const allocate = library.func("int mach_port_allocate(unsigned int task, unsigned int right, void *output)");
const insert = library.func("int mach_port_insert_right(unsigned int task, unsigned int name, unsigned int right, unsigned int disposition)");
const register = library.func("int mach_ports_register(unsigned int task, void *ports, unsigned int count)");
const deallocate = library.func("int mach_port_deallocate(unsigned int task, unsigned int name)");
const refs = library.func("int mach_port_mod_refs(unsigned int task, unsigned int name, unsigned int right, int delta)");

for (const mode of ["self", "fake"]) {
  const output = Buffer.alloc(4); let name, receive = false, send = false, unexpected;
  try {
    if (mode === "self") { assert.equal(ownName(task, process.pid, output), 0); name = output.readUInt32LE(); send = true; }
    else {
      assert.equal(allocate(task, 1 /* RECEIVE */, output), 0); name = output.readUInt32LE(); receive = true;
      assert.equal(insert(task, name, name, 20 /* MAKE_SEND */), 0); send = true;
    }
    const ports = Buffer.alloc(8); ports.writeUInt32LE(name, 4);
    assert.equal(register(task, ports, 2), 0);
    assert.throws(() => { unexpected = pinInheritedDarwinPeer(); },
      error => error.code === "AUTH_FAILED" && error.details.reason === (mode === "self" ? "source-coalition" : "source-type"));
    console.log(JSON.stringify({ nativeRefusal: mode }));
  } finally {
    try { unexpected?.close(); }
    finally {
      assert.equal(register(task, Buffer.alloc(8), 2), 0);
      if (receive) assert.equal(refs(task, name, 1 /* RECEIVE */, -1), 0);
      if (send) assert.equal(deallocate(task, name), 0);
    }
  }
}
