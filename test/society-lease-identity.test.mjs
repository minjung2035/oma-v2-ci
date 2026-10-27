/** TUI-004/REC-007/AUTH-003: what a process must show before it may act for a
 * society, and why showing the right *shape* is not showing the right thing.
 *
 * The society lease is a name in the abstract AF_UNIX namespace. The kernel
 * lets one open file description hold a name at a time, so holding the name IS
 * owning the society -- no claim by the process presenting it has to be
 * trusted. Recognising an inherited lease used to be written as a predicate at
 * the entrypoint, though: read the declared descriptor, `fstat` it, accept it
 * if it is a socket. A socketpair is a socket. So descriptor 4 of any process
 * started by hand, carrying any AF_UNIX socket and one environment variable,
 * was accepted as proof of owning a society another `oma` was holding -- and
 * the broker then skipped taking the lease at all.
 *
 * These tests ask the question the product now asks: which name does this
 * descriptor hold. The last one asks it across an `execve`, because inheriting
 * a descriptor into a new process is the only place the property has to be
 * true.
 */
import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { abstractNameHeld, holdAbstractName, lockFileDescriptor } from "@oma/native/linux";
import { inheritedFence, societyLeaseName, tryHoldSociety, claimSocietyFence } from "#oma-test/app/runtime/society-lease";

const LEASE_MODULE = fileURLToPath(new URL(import.meta.resolve("#oma-test/app/runtime/society-lease")));

function stateRoot(tag) {
  const base = mkdtempSync(join(tmpdir(), `oma-lease-${tag}-`));
  return { base, path: join(base, "state"), cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

/** A connected AF_UNIX socket: bound to no name, and indistinguishable from the
 * lease by `fstat`. This is the exploit the old predicate accepted. */
function namelessSocket(connectTo) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(connectTo);
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

test("AUTH-003: a socket holding no name is not a lease, however much it looks like one", async () => {
  const a = stateRoot("shape");
  const lease = tryHoldSociety(a.path);
  assert.notEqual(lease, null);
  try {
    const client = await namelessSocket(lease.name);
    try {
      const held = abstractNameHeld(client._handle.fd);
      assert.equal(held.kind, "other", `a nameless socket answered ${held.kind}`);
      assert.match(held.why, /holds no name/);
      assert.equal(inheritedFence(client._handle.fd, a.path).kind, "not-a-lease",
        "a connected socket was accepted as this society's lease");
    } finally { client.destroy(); }
  } finally { lease.release(); a.cleanup(); }
});

test("AUTH-003: the descriptor that holds the society's name is recognised as its lease", () => {
  const a = stateRoot("self");
  const lease = tryHoldSociety(a.path);
  try {
    assert.equal(lease.name, societyLeaseName(a.path));
    const held = abstractNameHeld(lease.fence);
    assert.equal(held.kind, "holding");
    assert.equal(held.name, lease.name);
    assert.equal(inheritedFence(lease.fence, a.path).kind, "society");
  } finally { lease.release(); a.cleanup(); }
});

test("AUTH-003: society A's lease is not society B's lease", () => {
  const a = stateRoot("a"); const b = stateRoot("b");
  const lease = tryHoldSociety(a.path);
  try {
    const fence = inheritedFence(lease.fence, b.path);
    assert.equal(fence.kind, "other-society",
      "a lease of another society was accepted for this one");
    assert.equal(fence.name, societyLeaseName(a.path));
  } finally { lease.release(); a.cleanup(); b.cleanup(); }
});

test("AUTH-003: a socket bound to a pathname is not a lease, because a pathname can be replaced", async () => {
  // The lease lives in the abstract namespace precisely because that namespace
  // has no directory entry: nothing to unlink, rename, or point at another
  // object. A listening AF_UNIX socket on a filesystem path has all three, so
  // it is not the same evidence even though `fstat` cannot tell them apart and
  // both are bound, listening unix sockets.
  const base = mkdtempSync(join(tmpdir(), "oma-pathsock-"));
  const path = join(base, "s.sock");
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(path, resolve); });
  try {
    const held = abstractNameHeld(server._handle.fd);
    assert.equal(held.kind, "other", `a pathname socket answered ${held.kind}`);
    assert.match(held.why, /pathname/);
    assert.equal(inheritedFence(server._handle.fd, join(base, "state")).kind, "not-a-lease");
  } finally {
    await new Promise(resolve => server.close(resolve));
    rmSync(base, { recursive: true, force: true });
  }
});

test("AUTH-003: a regular file is not a lease", () => {
  const a = stateRoot("file");
  mkdirSync(a.path, { recursive: true });
  const path = join(a.path, "not-a-lease");
  writeFileSync(path, "");
  const fd = openSync(path, "r");
  try {
    // ENOTSOCK is a definite answer, so a regular file must come back as "not
    // this", not as "could not be evaluated": the two are different reasons to
    // refuse, and only one of them is a reason to suspect the environment.
    const held = abstractNameHeld(fd);
    assert.equal(held.kind, "other", `a regular file answered ${held.kind}`);
    assert.match(held.why, /not a socket/);
    assert.equal(inheritedFence(fd, a.path).kind, "not-a-lease");
  } finally { closeSync(fd); a.cleanup(); }
});

test("AUTH-003: a descriptor that is not open is unreadable, which is not the same as not a lease", () => {
  // "I could not establish this" must never be reported as "someone else owns
  // it" or as "this is fine": both readings start an engine on a society whose
  // ownership nothing is holding.
  const held = abstractNameHeld(4096);
  assert.equal(held.kind, "unreadable");
  assert.equal(held.errno, 9, "a closed descriptor did not answer EBADF");
});

/** The regression the fourteenth audit asked for, across a real `execve`. */
test("AUTH-003: a broker handed society A's lease on descriptor 4 refuses to serve society B", () => {
  const a = stateRoot("proc-a"); const b = stateRoot("proc-b");
  const lease = tryHoldSociety(a.path);
  try {
    const run = (root) => spawnSync(process.execPath, ["--input-type=module", "-e", `
      const { claimSocietyFence } = await import(${JSON.stringify(LEASE_MODULE)});
      try { console.log(JSON.stringify({ ok: true, claim: claimSocietyFence(${JSON.stringify(root)}) })); }
      catch (error) { console.log(JSON.stringify({ ok: false, message: String(error && error.message) })); }
    `], {
      stdio: ["ignore", "pipe", "pipe", "ignore", lease.fence],
      env: { ...process.env, OMA_SOCIETY_FENCE_FD: "4" },
      encoding: "utf8",
    });

    const foreign = run(b.path);
    assert.equal(foreign.status, 0, `child did not run: ${foreign.stderr}`);
    const refused = JSON.parse(foreign.stdout);
    assert.equal(refused.ok, false,
      "a process holding another society's lease was allowed to serve this one");
    assert.match(refused.message, /lease of another society/);

    // The control for the control: the same descriptor, for the society it
    // really is the lease of, must be accepted -- otherwise this test would
    // pass just as well if the product refused everything.
    const own = run(a.path);
    assert.equal(own.status, 0, `child did not run: ${own.stderr}`);
    const accepted = JSON.parse(own.stdout);
    assert.equal(accepted.ok, true, `the genuine lease was refused: ${accepted.message}`);
    assert.equal(accepted.claim.kind, "inherited");
  } finally { lease.release(); a.cleanup(); b.cleanup(); }
});

test("AUTH-003: a process that declares a lease it does not have fails to start rather than serving", () => {
  const a = stateRoot("declared");
  const previous = process.env.OMA_SOCIETY_FENCE_FD;
  process.env.OMA_SOCIETY_FENCE_FD = "7";
  try {
    assert.throws(() => claimSocietyFence(a.path), /names descriptor 7/);
  } finally {
    if (previous === undefined) delete process.env.OMA_SOCIETY_FENCE_FD;
    else process.env.OMA_SOCIETY_FENCE_FD = previous;
    a.cleanup();
  }
});

/** LOC-003: taking a lock has three answers, and the missing one was dangerous. */
test("LOC-003: a lock that could not be evaluated is not reported as another owner", () => {
  const base = mkdtempSync(join(tmpdir(), "oma-flock-"));
  const path = join(base, "broker.lock");
  writeFileSync(path, "");
  const first = openSync(path, "r+");
  const second = openSync(path, "r+");
  try {
    assert.equal(lockFileDescriptor(first).kind, "held");
    assert.equal(lockFileDescriptor(second).kind, "contended",
      "a second open file description was not reported as contention");
    const broken = lockFileDescriptor(4096);
    assert.equal(broken.kind, "failed",
      "a descriptor that cannot be locked at all was reported as an owner");
    assert.equal(broken.errno, 9);
  } finally { closeSync(first); closeSync(second); rmSync(base, { recursive: true, force: true }); }
});

test("LOC-003: a name nothing holds is free, and holding it twice is refused", () => {
  const name = `\0oma.test.${process.pid}.${Date.now()}`;
  const first = holdAbstractName(name);
  assert.equal(first.kind, "held");
  try {
    assert.equal(holdAbstractName(name).kind, "taken",
      "the kernel allowed two holders of one abstract name");
  } finally { closeSync(first.fd); }
});
