/** DR42: actual owners, real Git/ledger/archive/socket effects; no native Mac. */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, connect, Socket } from "node:net";
import { copyFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { GuestProjects, sha256File } from "#oma-test/app/platform/guest/project";
import { GuestHost } from "#oma-test/app/platform/guest/host";
import { GuestArchives } from "#oma-test/app/platform/guest/archive";
import { GuestPackages } from "#oma-test/app/platform/guest/packages";
import { RequestLedger } from "#oma-test/app/platform/guest/requests";
import { EgressHost } from "#oma-test/app/platform/host/egress";
import { NativeChannel } from "@oma/platform-mac/native-channel";
import { FramedPeer } from "#oma-test/app/platform/rpc";
import { PLATFORM_FRAME_BYTES } from "@oma/protocol/host-guest";
import { publishProjectBinding } from "#oma-test/app/runtime/provision";
import { ProcessLock } from "@oma/native/process-lock";
import { keychainCredentials } from "#oma-test/app/runtime/keychain-credentials";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(t: import("node:test").TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "oma-dr42-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const git = (cwd: string, ...argv: string[]): string => {
  const result = spawnSync("/usr/bin/git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", ...argv], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
};
async function projectWorld(t: import("node:test").TestContext) {
  const dir = fixture(t), societiesDir = join(dir, "oma"), projectsDir = join(dir, "projects"), repo = join(dir, "repo");
  for (const path of [societiesDir, projectsDir, repo]) mkdirSync(path);
  git(repo, "init", "-q", "-b", "main");
  const ledger = new RequestLedger(join(dir, "requests")), projects = new GuestProjects(projectsDir, societiesDir, ledger);
  const bundle = async (key: string, projectId: string) => {
    writeFileSync(join(repo, "file"), key); git(repo, "add", "."); git(repo, "commit", "-qm", key);
    const head = git(repo, "rev-parse", "HEAD"), file = ledger.staging(key, "bundle");
    git(repo, "bundle", "create", file, "main");
    return { head, params: { projectId, branch: "main", bundle: { bytes: statSync(file).size, sha256: await sha256File(file) } } };
  };
  return { dir, societiesDir, projectsDir, ledger, projects, bundle };
}

test("DR42: different request keys on a mirror serialize through durable outcome; other projects proceed", async t => {
  const w = await projectWorld(t), projectId = randomUUID(), otherId = randomUUID();
  const a = await w.bundle("first", projectId), b = await w.bundle("second", projectId), c = await w.bundle("other", otherId);
  const entered = deferred(), release = deferred(), calls: unknown[] = [];
  const run = w.ledger.run.bind(w.ledger);
  t.mock.method(w.ledger, "run", async (...args: Parameters<RequestLedger["run"]>) => {
    const [key, method, params, effect] = args;
    return run(key, method, params, async () => {
      calls.push(key);
      if (key === "first") { entered.resolve(); await release.promise; }
      if (key === "second") assert.equal(w.ledger.status("first").state, "done", "writer passed before outcome publication");
      return effect();
    }, args[4]);
  });
  const first = w.projects.import("first", a.params), second = w.projects.import("second", b.params);
  await entered.promise;
  const host = new GuestHost({ societiesDir: w.societiesDir, projectsDir: w.projectsDir, projects: w.projects,
    launcher: { socketPath: society => join(w.dir, `${society}.sock`), start: async () => {}, stop: async () => "stopped" }, stopDeadlineMs: 100 });
  try {
    assert.throws(() => host.maintenanceBegin("snapshot"), { code: "BROKER_UNAVAILABLE" });
    assert.equal((await w.projects.import("other", c.params)).head, c.head);
    assert.deepEqual(calls, ["first", "other"]);
  } finally { release.resolve(); }
  assert.equal((await first).head, a.head); assert.equal((await second).head, b.head);
  assert.equal(git(w.projects.mirrorOf(projectId), "rev-parse", "HEAD"), b.head);
  host.maintenanceBegin("snapshot");
  assert.equal((await w.projects.import("first", a.params)).head, a.head, "maintenance cannot reinterpret a completed receipt");
  await assert.rejects(w.projects.import("first", { ...a.params, projectId: "invalid" }), { code: "REQUEST_KEY_REUSED" });
  await assert.rejects(w.projects.import("blocked", b.params), { code: "BROKER_UNAVAILABLE" });
  assert.deepEqual(w.ledger.status("blocked"), { state: "pending", method: "project.import" });
  host.maintenanceEnd("snapshot");
  assert.equal((await w.projects.import("first", a.params)).head, a.head, "same key remains its historical outcome");
  assert.equal(git(w.projects.mirrorOf(projectId), "rev-parse", "HEAD"), b.head, "replay must not move HEAD back");
});

test("DR42: session start waits for the project's import, and maintenance sees that reservation", async t => {
  const w = await projectWorld(t), projectId = randomUUID(), data = await w.bundle("import", projectId);
  const entered = deferred(), release = deferred(), run = w.ledger.run.bind(w.ledger);
  t.mock.method(w.ledger, "run", async (...args: Parameters<RequestLedger["run"]>) =>
    run(args[0], args[1], args[2], async () => { entered.resolve(); await release.promise; return args[3](); }, args[4]));
  let started = false;
  const host = new GuestHost({ societiesDir: w.societiesDir, projectsDir: w.projectsDir, projects: w.projects,
    launcher: { socketPath: () => join(w.dir, "absent.sock"), stop: async () => "stopped", start: async () => {
      assert.equal(w.ledger.status("import").state, "done");
      assert.equal(git(w.projects.mirrorOf(projectId), "rev-parse", "HEAD"), data.head); started = true;
    } }, stopDeadlineMs: 100 });
  const imported = w.projects.import("import", data.params); await entered.promise;
  const opened = host.open("demo", projectId);
  assert.equal(started, false); assert.throws(() => host.maintenanceBegin("snapshot"), { code: "BROKER_UNAVAILABLE" });
  release.resolve(); await imported; await opened; assert.equal(started, true);
});

test("DR42: archive requires confirmed stop; its fence bars session start, mirror mutation and maintenance", async t => {
  const w = await projectWorld(t), projectId = randomUUID(), data = await w.bundle("seed", projectId);
  await w.projects.import("seed", data.params);
  const root = join(w.societiesDir, "demo"); mkdirSync(root);
  publishProjectBinding(root, { society: "demo", canonicalProjectPath: w.projects.mirrorOf(projectId) });
  writeFileSync(join(root, "store.db"), "fixture");
  const entered = deferred(), release = deferred(); let stopped = false;
  const archives = new GuestArchives(w.societiesDir, w.ledger, async () => { entered.resolve(); await release.promise; return stopped ? "stopped" : "unknown"; });
  const host = new GuestHost({ societiesDir: w.societiesDir, projectsDir: w.projectsDir, projects: w.projects, archives,
    launcher: { socketPath: () => join(w.dir, "absent.sock"), start: async () => assert.fail("start crossed archive fence"), stop: async () => "unknown" }, stopDeadlineMs: 100 });
  const path = join(w.dir, "rpc.sock"), sockets = new Set<Socket>();
  const server = createServer(socket => { sockets.add(socket); host.serve(new FramedPeer(socket, { frameBytes: PLATFORM_FRAME_BYTES, requestTimeoutMs: 2000 })); });
  await new Promise<void>(done => server.listen(path, done));
  const socket = connect(path); await new Promise<void>(done => socket.once("connect", done));
  const peer = new FramedPeer(socket, { frameBytes: PLATFORM_FRAME_BYTES, requestTimeoutMs: 2000 });
  t.after(async () => { peer.close(); for (const socket of sockets) socket.destroy(); await new Promise<void>(done => server.close(() => done())); });
  const archived = assert.rejects(peer.request("archive.create", { society: "demo" }, "archive"), error =>
    (error as { failure: { code: string } }).failure.code === "BROKER_UNAVAILABLE");
  await entered.promise;
  await assert.rejects(host.open("demo", projectId), { code: "BROKER_UNAVAILABLE" });
  assert.throws(() => host.maintenanceBegin("snapshot"), { code: "BROKER_UNAVAILABLE" });
  await assert.rejects(w.projects.mutations.runGlobal(async () => assert.fail("package write crossed archive fence")), { code: "BROKER_UNAVAILABLE" });
  let moved = false;
  copyFileSync(w.ledger.staging("seed", "bundle"), w.ledger.staging("after-archive", "bundle"));
  const imported = w.projects.import("after-archive", data.params).then(() => { moved = true; });
  await Promise.resolve(); assert.equal(moved, false);
  release.resolve(); await archived; await imported;
  assert.deepEqual(w.ledger.status("archive"), { state: "pending", method: "archive.create" });
  stopped = true;
  const result = await peer.request("archive.create", { society: "demo" }, "archive");
  assert.ok((result.bytes as number) > 0); assert.equal(w.ledger.status("archive").state, "done");
});

test("DR42: credential contention expires without a caller signal and performs no credential effect", { timeout: 3000 }, async t => {
  const dir = fixture(t), path = join(dir, "writer.lock"), held = ProcessLock.acquire(path);
  let effects = 0;
  const credentials = keychainCredentials({ get: async () => { effects++; return "{}"; }, put: async () => { effects++; } }, "fixture", path, { waitMs: 35 });
  try {
    await assert.rejects(credentials.modify("fixture", async () => { effects++; return undefined; }), { code: "BROKER_UNAVAILABLE" });
    assert.equal(effects, 0); assert.equal(ProcessLock.tryAcquire(path), null);
  } finally { held.close(); }
  await credentials.modify("fixture", async () => undefined); assert.equal(effects, 1);
});

test("DR42: global package publication participates in maintenance and project/archive admission", async t => {
  const w = await projectWorld(t), projectId = randomUUID(), data = await w.bundle("seed", projectId);
  const packages = new GuestPackages({ ledger: w.ledger, projects: w.projects, dataDir: w.societiesDir,
    libdir: w.dir, node: process.execPath, entry: "/unused", env: {}, timeoutMs: 100 });
  w.projects.mutations.setMaintenance(true);
  await assert.rejects(packages.replace("packages", { archive: { bytes: 7, sha256: "0".repeat(64) } }), { code: "BROKER_UNAVAILABLE" });
  assert.deepEqual(w.ledger.status("packages"), { state: "pending", method: "packages.replace" });
  w.projects.mutations.setMaintenance(false);
  const entered = deferred(), release = deferred();
  const global = w.projects.mutations.runGlobal(async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  try {
    await assert.rejects(w.projects.import("seed", data.params), { code: "BROKER_UNAVAILABLE" });
    await assert.rejects(w.projects.mutations.run("archive/unbound", async () => assert.fail("archive crossed global package writer")), { code: "BROKER_UNAVAILABLE" });
  } finally { release.resolve(); await global; }
  assert.equal((await w.projects.import("seed", data.params)).head, data.head);
});

test("DR42: a credential writer in the same process cannot hide a second caller's contention budget", { timeout: 3000 }, async t => {
  const dir = fixture(t), path = join(dir, "writer.lock"), entered = deferred(), release = deferred();
  let effects = 0;
  const credentials = keychainCredentials({ get: async () => { effects++; return "{}"; }, put: async () => { effects++; } }, "fixture", path, { waitMs: 35 });
  const first = credentials.modify("fixture", async () => { entered.resolve(); await release.promise; return undefined; });
  await entered.promise;
  try {
    await assert.rejects(credentials.modify("other", async () => { effects++; return undefined; }), { code: "BROKER_UNAVAILABLE" });
    assert.equal(effects, 1); assert.equal(ProcessLock.tryAcquire(path), null, "an acquired writer still owns its full effect");
  } finally { release.resolve(); await first; }
});

test("DR42: initial egress opens all fail, then the owned retry fills without other traffic", { timeout: 5000 }, async t => {
  const dir = fixture(t), path = join(dir, "egress.sock"), peers = new Set<Socket>();
  const server = createServer(socket => { peers.add(socket); socket.on("error", () => {}); });
  await new Promise<void>(done => server.listen(path, done));
  const filled = deferred(); let attempts = 0;
  const host = new EgressHost({ open: async () => {
        attempts++;
        if (attempts <= 3)
            throw new Error("transient");
        const socket = connect(path);
        await new Promise<void>(done => socket.once("connect", done));
        if (attempts === 5)
            filled.resolve();
        return { socket, rest: Buffer.alloc(0) };
    }, resolve: async () => { throw new Error("unused"); }, frameBytes: PLATFORM_FRAME_BYTES, maxPool: 2, concurrent: 4, retry: { initialMs: 10, maxMs: 20 } });
  t.after(async () => { await host.stop(); for (const socket of peers) socket.destroy(); await new Promise<void>(done => server.close(() => done())); });
  await host.fill(); assert.equal(host.pooled, 0);
  await filled.promise; await new Promise<void>(done => setImmediate(done)); assert.equal(host.pooled, 2); assert.equal(attempts, 5);
  await host.stop(); await new Promise(done => setTimeout(done, 50)); assert.equal(attempts, 5);
});

test("DR42: reboot/shutdown cancel the old egress generation and discard an opening socket", async () => {
  const opened = deferred<{ socket: Socket; rest: Buffer }>(); let signal: AbortSignal | undefined, attempts = 0;
  const host = new EgressHost({ open: async (owner) => { signal = owner; attempts++; return opened.promise; },
    resolve: async () => { throw new Error("unused"); }, frameBytes: PLATFORM_FRAME_BYTES, maxPool: 2, concurrent: 4 });
  const filling = host.fill(); await host.pause(); assert.equal(signal?.aborted, true);
  const socket = new Socket(); opened.resolve({ socket, rest: Buffer.alloc(0) }); await filling;
  assert.equal(socket.destroyed, true); assert.equal(host.pooled, 0); assert.equal(attempts, 1);
  await host.stop(); host.resume(); await host.fill(); assert.equal(attempts, 1);
});

test("DR42: native framing counts UTF-8 per line and consumes batched responses before dispatch", async t => {
  const dir = fixture(t), path = join(dir, "helper.sock"); let remote!: Socket;
  const connected = deferred();
  const server = createServer(socket => { remote = socket; remote.on("error", () => {}); connected.resolve(); });
  await new Promise<void>(done => server.listen(path, done));
  const socket = connect(path); await connected.promise;
  const channel = new NativeChannel(socket, { helper: "VM", endedMessage: "fixture ended", strictResponses: false, timeoutEndsChannel: false, refusal: () => new Error("refused") });
  t.after(async () => { channel.close(); remote.destroy(); await new Promise<void>(done => server.close(() => done())); });
  const first = channel.request("get", {}, 1000), second = channel.request("get", {}, 1000);
  const line = JSON.stringify({ id: 1, ok: true, value: "한".repeat(250_000) });
  // Each line fits 1 MiB, while this read exceeds it. UTF-8 is split across writes.
  const batch = Buffer.from(`${line}\n${line.replace('"id":1', '"id":2')}\n`);
  remote.write(batch.subarray(0, 32)); remote.write(batch.subarray(32));
  assert.equal((await first).value, "한".repeat(250_000)); assert.equal((await second).value, "한".repeat(250_000));
  const invalid = assert.rejects(channel.request("get", {}, 1000), { code: "BROKER_UNAVAILABLE" });
  remote.write(JSON.stringify({ id: 3, ok: true, value: "한".repeat(350_000) }) + "\n"); await invalid;
  assert.equal(socket.destroyed, true);
});
