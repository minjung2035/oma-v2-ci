/** macos-platform §2.1, MAC-303, MAC-320, MAC-211: omahostd's parts put
 * together, over a driver that runs the real guest services here. */
import test from "node:test";
import assert from "node:assert/strict";
import { connect, type Server } from "node:net";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { encodeFrame } from "@oma/protocol/frame";
import { readLeadingFrame, type FramedPeer } from "#oma-test/app/platform/rpc";
import type { SessionLauncher } from "#oma-test/app/platform/guest/host";
import { archiveKey, HostService, type HostServiceOptions } from "#oma-test/app/platform/host/service";
import { ProcessLock } from "@oma/native/process-lock";
import { StoreError } from "@oma/domain/errors";
import { newHostRecord, readHostRecord, writeHostRecord } from "@oma/platform-mac/record";
import { HOST_GUEST_PROTOCOL, PLATFORM_FRAME_BYTES } from "@oma/protocol/host-guest";
import { HOST_API_VERSION } from "@oma/protocol/host-api";
import { LocalDriver, listenSilently } from "./fixtures/local-guest.js";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import { newSessionBirth, publishSessionBirth } from "#oma-test/app/runtime/session-mode";
import { publishProjectBinding } from "#oma-test/app/runtime/provision";
import { modelWorkspacePathAt } from "@oma/domain/paths";
import { inspectMacGuestHistory, listMacGuestHistories } from "#oma-test/app/platform/host/guest-histories";

function memoryKeychain() {
  const items = new Map<string, string>();
  return { items, get: async (account: string) => items.get(account), put: async (account: string, value: string) => { items.set(account, value); } };
}

async function world(t: import("node:test").TestContext, before?: (dir: string, runDir: string) => void,
  mutate?: (peer: FramedPeer) => void, git?: () => string, extra?: (dir: string) => Partial<HostServiceOptions>) {
  const dir = mkdtempSync(join(tmpdir(), "oma-hostsvc-"));
  const runDir = join(dir, "run"); mkdirSync(runDir);
  before?.(dir, runDir);
  const recordPath = join(dir, "host-record.json");
  const record = newHostRecord();
  writeHostRecord(recordPath, record);
  const societiesDir = join(dir, "data", "oma");
  mkdirSync(join(societiesDir, "demo", "state"), { recursive: true });
  const holderPath = join(dir, "demo.sock");
  let holder: Server | null = await listenSilently(holderPath);
  const launcher: SessionLauncher = { socketPath: () => holderPath, start: async () => {},
    stop: async () => { await new Promise(r => holder?.close(r)); holder = null; return "stopped"; } };
  const driver = new LocalDriver(dir, { dir: societiesDir, launcher, ...(mutate === undefined ? {} : { mutate }) }, record.instanceId);
  const service = await HostService.start({
    runDir, recordPath, driver, uid: process.getuid!(), git: git?.() ?? "/usr/bin/git", archivesDir: join(dir, "archives"), storageFloorBytes: 0, keychain: memoryKeychain(),
    identity: { hostVersion: "1.0.0", installationId: record.installationId, instanceId: record.instanceId, expectImage: "2026.09.1",
      protocol: { min: HOST_GUEST_PROTOCOL, max: HOST_GUEST_PROTOCOL } },
    resolve: async () => ({ provider: "anthropic", model: "m", origin: "https://provider.invalid", apiKey: "sk-ant-api03-" + "r".repeat(40), headers: {} }),
    timings: { handshakeDeadlineMs: 2000, handshakeRetryMs: 20, drainDeadlineMs: 800, healthEveryMs: 1000, hungAfterMs: 2000,
      restarts: { max: 3, windowMs: 60_000, backoffMs: 20 } },
    // Controlled bookmark boundary; this is not native NSURL evidence.
    bookmarks: { create: async path => Buffer.from(path).toString("base64"),
      resolve: async bookmark => Buffer.from(bookmark, "base64").toString("utf8") },
    ...(extra === undefined ? {} : extra(dir)),
  });
  let shut = false;
  t.after(async () => {
    if (!shut) await service.shutdown().catch(() => undefined);
    await driver.dispose();
    await new Promise(r => holder === null ? r(null) : holder.close(r));
    rmSync(dir, { recursive: true, force: true });
  });
  const token = readFileSync(join(runDir, "token"), "utf8").trim();
  const call = async (method: string, params: Record<string, unknown> = {}, key?: string): Promise<Record<string, unknown>> => {
    const socket = connect(join(runDir, "hostapi.sock"));
    await new Promise<void>((ok, fail) => { socket.once("connect", ok); socket.once("error", fail); });
    socket.write(encodeFrame({ v: 1, id: "h", method: "hello", params: { api: { min: 1, max: HOST_API_VERSION }, token, client: "oma-cli" } }));
    const hello = await readLeadingFrame(socket, PLATFORM_FRAME_BYTES, 3000);
    if (hello.rest.length > 0) socket.unshift(hello.rest);
    socket.write(encodeFrame({ v: 1, id: "r", method, params, ...(key === undefined ? {} : { key }) }));
    const answer = await readLeadingFrame(socket, PLATFORM_FRAME_BYTES, 10_000);
    socket.destroy();
    return answer.frame;
  };
  const until = async (condition: () => boolean, what: string): Promise<void> => {
    for (let i = 0; i < 300 && !condition(); i++) await new Promise(r => setTimeout(r, 10));
    assert.ok(condition(), what);
  };
  return { service, driver, recordPath, call, until, dir, runDir, record, markShut: () => { shut = true; } };
}

test("§2.1/MAC-303: starting through the Host API readies the engine, fills the egress pool, and records the disk as made", async t => {
  const { driver, recordPath, call, until } = await world(t);
  assert.equal(readHostRecord(recordPath)!.provisioning, "pending");
  assert.deepEqual((await call("engine.start")).result, { state: "ready" });
  await until(() => driver.pool.size >= 2, "the egress pool is filled once the engine is ready");
  assert.equal(readHostRecord(recordPath)!.provisioning, "done");
});

test("MAC-320: the service's end drains and powers off, and how it ended is recorded", async t => {
  const clean = await world(t);
  await clean.call("engine.start");
  clean.markShut();
  assert.equal(await clean.service.shutdown(), "stopped");
  assert.equal(readHostRecord(clean.recordPath)!.lastStop, "clean");
  assert.ok(clean.driver.calls.includes("power.off"));

  const forced = await world(t);
  await forced.call("engine.start");
  forced.driver.ignorePowerOff = true;
  forced.markShut();
  assert.equal(await forced.service.shutdown(), "forced");
  assert.equal(readHostRecord(forced.recordPath)!.lastStop, "forced");
});

for (const failed of ["egress", "stop"] as const) test(`DR38: shutdown ${failed} failure still closes the API and releases its lock`, async t => {
  const { service, call, driver, runDir, markShut } = await world(t);
  await call("engine.start");
  const socket = connect(join(runDir, "hostapi.sock"));
  await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
  const closed = new Promise<void>(resolve => socket.once("close", () => resolve()));
  t.after(() => socket.destroy());
  // The test owns leaked resources even when running the failing old code.
  t.after(() => {
    const api = Reflect.get(service, "api") as Server;
    if (api.listening) api.close();
    (Reflect.get(service, "lock") as ProcessLock).close();
  });
  if (failed === "egress") t.mock.method(service.egress, "stop", async () => { throw new Error("egress stop failed"); });
  else t.mock.method(service.lifecycle, "stop", async () => { throw new Error("VM stop unknown"); });
  markShut();
  await assert.rejects(service.shutdown(), failed === "egress" ? /egress stop failed/ : /VM stop unknown/);
  await Promise.race([closed, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("API client leaked")), 300); timer.unref(); })]);
  const lock = ProcessLock.tryAcquire(join(runDir, "omahostd.lock"));
  assert.notEqual(lock, null, "shutdown leaked its process lock");
  lock!.close();
  if (failed === "egress") assert.equal(driver.running, null, "egress failure skipped VM stop");
});

test("DR38: missing mandatory host record rejects ready and stops the running VM", async t => {
  const { service, recordPath, driver } = await world(t);
  rmSync(recordPath);
  await assert.rejects(service.lifecycle.start());
  assert.equal(service.lifecycle.state, "failed");
  assert.equal(driver.running, null);
  assert.equal(driver.forced, 1);
});

test("DR38: same-name snapshots on different Host API connections are serialized through thaw and lease return", async t => {
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  let held = false;
  const mutate = (peer: FramedPeer): void => {
    const methods = new Map<string, string>();
    peer.onFrame(frame => { if (typeof frame.id === "string" && typeof frame.method === "string") methods.set(frame.id, frame.method); });
    const answer = peer.answer.bind(peer);
    peer.answer = (id, result) => {
      if (methods.get(id) === "society.list" && !held) {
        held = true; release = () => answer(id, result); entered();
      } else answer(id, result);
    };
  };
  const { call, dir, driver } = await world(t, d => writeFileSync(join(d, "state.img"), "disk"), mutate, undefined,
    d => ({ snapshotsDir: join(d, "snapshots"), statePath: join(d, "state.img"), snapshotClone: copyFileSync }));
  await call("engine.start");
  const first = call("snapshot.create", { id: "same" });
  await started;
  const second = call("snapshot.create", { id: "same" });
  try {
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(driver.calls.filter(method => method === "maintenance.begin").length, 1);
  } finally { release(); }
  const answers = await Promise.all([first, second]);
  assert.ok(answers.every(answer => answer.ok === true), JSON.stringify(answers));
  assert.deepEqual(readdirSync(join(dir, "snapshots")).sort(), ["00000000-same.img", "00000001-same.img"]);
  assert.deepEqual(driver.calls.filter(method => method === "maintenance.begin" || method === "maintenance.end"),
    ["maintenance.begin", "maintenance.end", "maintenance.begin", "maintenance.end"]);
});

test("MAC-211/MAC-712: after the guest reboots, no placeholder of the last boot is kept", async t => {
  const { service, driver, call, until } = await world(t);
  await call("engine.start");
  await until(() => driver.pool.size >= 2, "the pool");
  // What the guest's egress service does for a runner: one placeholder.
  const pooled = driver.pool.take()!;
  pooled.write(encodeFrame({ v: 1, id: "p", method: "egress.placeholder",
    params: { credentialRef: "engine-managed", provider: "anthropic", model: "m", run: { society: "demo", actor: "alice", incarnation: 1 }, inferenceSeconds: 5 } }));
  assert.equal((await readLeadingFrame(pooled, PLATFORM_FRAME_BYTES, 5000)).frame.ok, true);
  assert.equal(service.egress.activeRuns, 1);
  await driver.crash();
  await until(() => service.lifecycle.state === "ready" && service.egress.activeRuns === 0, "restarted, and the old boot's placeholder dropped");
});

test("§6/MAC-241 through the Host API: an import runs end to end under the UI's key, and the key's outcome can be asked for", async t => {
  const { call, dir, driver, recordPath } = await world(t);
  const mac = join(dir, "mac"); mkdirSync(mac);
  const git = (...args: string[]) => spawnSync("git", ["-C", mac, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8" });
  git("init", "-q", "-b", "main"); writeFileSync(join(mac, "a"), "a\n"); git("add", "a"); git("commit", "-qm", "a");
  const head = git("rev-parse", "HEAD").stdout.trim();
  const bound = await call("project.bind", { macRepo: mac, society: "demo" });
  const projectId = (bound.result as { projectId: string }).projectId;
  assert.equal(driver.starts, 0, "binding must not start the VM");
  const unobserved = await call("project.extensions", { projectId });
  assert.equal(unobserved.ok, false);
  assert.equal((unobserved.error as { code: string }).code, "BROKER_UNAVAILABLE");
  assert.equal(driver.starts, 0, "an absent settings observation must not start the VM");
  assert.deepEqual((await call("project.bind", { macRepo: mac, society: "demo" })).result, bound.result);
  assert.equal(readHostRecord(recordPath)!.projects.length, 1);
  const imported = await call("project.import", { projectId, macRepo: mac, branch: "main" }, "ui-import-1");
  assert.equal((imported.result as { head: string }).head, head, JSON.stringify(imported));
  const status = await call("request.status", { key: "ui-import-1" });
  assert.equal((status.result as { state: string }).state, "done");
  const again = await call("project.import", { projectId, macRepo: mac, branch: "main" }, "ui-import-1");
  assert.deepEqual(again.result, imported.result, "the same key is answered with the same outcome");
  assert.deepEqual((await call("project.extensions", { projectId })).result, { extensions: [] });
  assert.equal(readHostRecord(recordPath)!.projects[0]!.lastImport!.head, head);
  const unrelated = join(dir, "unrelated"); mkdirSync(unrelated);
  const wrong = await call("project.import", { projectId, macRepo: unrelated, branch: "main" }, "wrong-location");
  assert.equal(wrong.ok, false);
  const missing = await call("request.status", { key: "wrong-location" });
  assert.equal(missing.ok, false);
  assert.equal((missing.error as { code: string }).code, "REQUEST_NOT_FOUND");
  // Host/guest history bridge with controlled native assets, not a Mac build.
  const root = join(dir, "data", "oma", "demo"), mirror = join(dir, "projects", projectId);
  publishProjectBinding(root, { society: "demo", canonicalProjectPath: mirror });
  const birth = publishSessionBirth(root, newSessionBirth(root, "society", mirror));
  mkdirSync(birth.history, { recursive: true });
  const sessionId = randomUUID(), file = "saved.jsonl";
  writeFileSync(join(birth.history, file), JSON.stringify({ type: "session", version: CURRENT_SESSION_VERSION,
    id: sessionId, timestamp: "2026-10-02T00:00:00.000Z", cwd: modelWorkspacePathAt(root, "principal") }) + "\n", { mode: 0o600 });
  const resources = join(dir, "OMA.app", "Contents", "Resources"), helperDir = join(resources, "..", "MacOS");
  mkdirSync(join(resources, "git", "bin"), { recursive: true }); mkdirSync(helperDir);
  symlinkSync("/usr/bin/git", join(resources, "git", "bin", "git"));
  writeFileSync(join(helperDir, "oma-vmhelper"), `#!/bin/sh\ncat >/dev/null\ncat <<'OMA_JSON'\n${JSON.stringify({ path: mac })}\nOMA_JSON\n`, { mode: 0o700 });
  const histories = await listMacGuestHistories(dir, resources);
  assert.equal(histories.length, 1); assert.equal(histories[0]!.id, sessionId);
  assert.equal(histories[0]!.cwd, mac); assert.match(histories[0]!.name!, /Society/);
  assert.match(histories[0]!.path, /^oma-guest-history:/);
  await inspectMacGuestHistory(dir, histories[0]!.path);
  assert.equal(driver.starts, 1, "catalog and inspection must not start or reopen the engine");
  const conflict = await call("session.resume", { projectId, society: "demo", sessionId, file });
  assert.equal(conflict.ok, false); assert.equal((conflict.error as { code: string }).code, "ATTACH_CONFLICT");
});

test("P0V-105 (F-09): one host service per support directory -- a second is refused while the first runs, and may start once it has ended", async t => {
  const { dir, runDir, recordPath, driver, record, service, markShut } = await world(t);
  const options = { runDir, recordPath, driver, uid: process.getuid!(), git: "/usr/bin/git", archivesDir: join(dir, "archives"), storageFloorBytes: 0,
    keychain: memoryKeychain(), resolve: async () => { throw new Error("unused"); },
    identity: { hostVersion: "1.0.0", installationId: record.installationId, instanceId: record.instanceId, expectImage: "2026.09.1",
      protocol: { min: HOST_GUEST_PROTOCOL, max: HOST_GUEST_PROTOCOL } } };
  await assert.rejects(HostService.start(options), /another OMA host service is running/);
  await service.shutdown();
  markShut();
  const second = await HostService.start(options);
  await second.shutdown();
});

test("P0V-103, P0V-104: at start the service removes what a dead one left -- unfinished publications and transfer files -- and nothing finished", async t => {
  const leftover = `.demo-0123456789abcdef.omaarchive.${randomUUID()}.partial`;
  await world(t, (dir, runDir) => {
    mkdirSync(join(dir, "archives")); mkdirSync(join(runDir, "transfer"));
    writeFileSync(join(dir, "archives", leftover), "half an archive");
    writeFileSync(join(dir, "archives", "demo-fedcba9876543210.omaarchive"), "a finished archive");
    writeFileSync(join(runDir, "transfer", "k.archive.tar"), "PRIVATE plain bytes a dead service was receiving");
    writeFileSync(join(dir, `.host-record.json.${randomUUID()}.partial`), "{");
  }).then(({ dir, runDir }) => {
    assert.deepEqual(readdirSync(join(dir, "archives")), ["demo-fedcba9876543210.omaarchive"]);
    assert.deepEqual(readdirSync(join(runDir, "transfer")), []);
    assert.equal(readdirSync(dir).some(name => name.endsWith(".partial")), false);
  });
});

/** The guest answers every request but reports a `project.import` head that
 * is not an object id. */
const badImportHead = (peer: FramedPeer): void => {
  const methods = new Map<string, string>();
  peer.onFrame(frame => { if (typeof frame.id === "string" && typeof frame.method === "string") methods.set(frame.id, frame.method); });
  const answer = peer.answer.bind(peer);
  peer.answer = (id, result) => { answer(id, methods.get(id) === "project.import" ? { ...result, head: "not-an-object-id" } : result); };
};

test("NB-22/P0-2: a guest answer that is not a head is an observation failure, never a durable one -- import and export", async t => {
  // The guest's own answer is untrusted: a malformed `head` must not land in
  // host-record.json as lastImport.
  const bad = await world(t, undefined, badImportHead);
  const mac = join(bad.dir, "mac"); mkdirSync(mac);
  const git = (...args: string[]) => spawnSync("git", ["-C", mac, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8" });
  git("init", "-q", "-b", "main"); writeFileSync(join(mac, "a"), "a\n"); git("add", "a"); git("commit", "-qm", "a");
  const bound = await bad.call("project.bind", { macRepo: mac, society: "demo" });
  const projectId = (bound.result as { projectId: string }).projectId;
  const imported = await bad.call("project.import", { projectId, macRepo: mac, branch: "main" }, "ui-import-bad");
  assert.equal(imported.ok, false, JSON.stringify(imported));
  assert.equal((imported.error as { code: string }).code, "BROKER_UNAVAILABLE");
  assert.equal(readHostRecord(bad.recordPath)!.projects[0]!.lastImport, undefined, "a malformed head was not recorded");

  // Export: the head comes from what the guest's bundle fetched, observed by
  // the host's own git -- a git that answers a non-head is refused the same way.
  let stubGit = "/usr/bin/git";
  const good = await world(t, dir => {
    stubGit = join(dir, "stubgit");
    writeFileSync(stubGit, "#!/bin/sh\ncase \" $* \" in *\" rev-parse --verify refs/remotes/oma/main\"*) echo bogus-head; exit 0;; esac\nexec /usr/bin/git \"$@\"\n", { mode: 0o700 });
  }, undefined, () => stubGit);
  const mac2 = join(good.dir, "mac"); mkdirSync(mac2);
  const git2 = (...args: string[]) => spawnSync("git", ["-C", mac2, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8" });
  git2("init", "-q", "-b", "main"); writeFileSync(join(mac2, "a"), "a\n"); git2("add", "a"); git2("commit", "-qm", "a");
  const bound2 = await good.call("project.bind", { macRepo: mac2, society: "demo" });
  const projectId2 = (bound2.result as { projectId: string }).projectId;
  const imported2 = await good.call("project.import", { projectId: projectId2, macRepo: mac2, branch: "main" }, "ui-import-good");
  assert.equal(imported2.ok, true, JSON.stringify(imported2), "the same git observing a real head is let through");
  // The engine's canonical main, which project.export bundles for the host.
  const canonical = join(good.dir, "data", "oma", "demo", "repos", "project.git");
  mkdirSync(join(good.dir, "data", "oma", "demo", "repos"), { recursive: true });
  spawnSync("git", ["init", "-q", "--bare", canonical]);
  git2("push", "-q", canonical, "main");
  const exported = await good.call("project.export", { society: "demo", macRepo: mac2, since: null }, "ui-export-bad");
  assert.equal(exported.ok, false, JSON.stringify(exported));
  assert.equal((exported.error as { code: string }).code, "BROKER_UNAVAILABLE");
  assert.equal(readHostRecord(good.recordPath)!.projects[0]!.lastExport, undefined, "a malformed fetched head was not recorded");
  assert.notEqual(readHostRecord(good.recordPath)!.projects[0]!.lastImport, undefined, "the earlier good import stands");
});

test("§8.4/NB-27: snapshots are part of the service -- the update's own before a new image's first boot, snapshot.create through the Host API at each quiescent point, and pruning that keeps the newest plus the unsettled update's", async t => {
  const { call, dir, recordPath, driver } = await world(t,
    d => { writeFileSync(join(d, "state.img"), "the state disk"); },
    undefined, undefined,
    d => ({ snapshotsDir: join(d, "snapshots"), statePath: join(d, "state.img"),
      snapshotClone: (from, to) => { copyFileSync(from, to); } }));
  const snaps = join(dir, "snapshots");

  // A stopped engine's disk is quiescent as it is; asking for a snapshot must
  // not boot it.
  const first = await call("snapshot.create", { id: "first" });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal((first.result as { path: string }).path, join(snaps, "00000000-first.img"));
  assert.deepEqual((first.result as { stopped: string[] }).stopped, []);
  assert.equal(driver.starts, 0, "a snapshot is an observation, not a boot");

  // The update's own: the record names the image that last wrote this disk;
  // a new image's first start keeps that disk before the boot can write it.
  writeHostRecord(recordPath, { ...readHostRecord(recordPath)!, image: { current: "2026.08.0", previous: null } });
  assert.deepEqual((await call("engine.start")).result, { state: "ready" });
  assert.equal(readFileSync(join(snaps, "00000001-update-2026.09.1.img"), "utf8"), "the state disk",
    "the pre-update disk was kept before the new image's first boot");

  // A running engine: every society stopped, the file system frozen for the
  // clone; the answer says which societies the UI should reopen.
  const running = await call("snapshot.create", { id: "while-running" });
  assert.equal(running.ok, true, JSON.stringify(running));
  assert.match(basename((running.result as { path: string }).path), /^00000002-while-running\.img$/);
  assert.deepEqual((running.result as { stopped: string[] }).stopped, ["demo"]);
  // Society channel recorded; the fs.freeze/fs.thaw exchange rides the
  // control channel -- the published clone is itself the proof a thaw found
  // the freeze in place (MAC-622).
  for (const step of ["maintenance.begin", "society.list", "society.close", "maintenance.end"])
    assert.ok(driver.calls.includes(step), `the running clone went through ${step}`);

  // MAC-661: past the keep count the oldest go first -- but not the snapshot
  // of the update the record has not settled.
  await call("snapshot.create", { id: "p1" });
  await call("snapshot.create", { id: "p2" });
  assert.deepEqual(readdirSync(snaps).sort(), [
    "00000001-update-2026.09.1.img", "00000002-while-running.img", "00000003-p1.img", "00000004-p2.img"],
    "the newest three plus the unsettled update's own stay; 00000000-first went first");
});

test("§8.4/REC-005: an update whose rollback snapshot cannot be made does not get its first boot", async t => {
  const { call, dir, recordPath, driver } = await world(t,
    d => { writeFileSync(join(d, "state.img"), "the state disk"); },
    undefined, undefined,
    d => ({ snapshotsDir: join(d, "snapshots"), statePath: join(d, "state.img"),
      snapshotClone: () => { throw new Error("the disk had no room for the clone"); } }));
  writeHostRecord(recordPath, { ...readHostRecord(recordPath)!, image: { current: "2026.08.0", previous: null } });
  const started = await call("engine.start");
  assert.equal(started.ok, false);
  assert.equal((started.error as { code: string }).code, "BROKER_UNAVAILABLE");
  assert.equal(driver.starts, 0, "the new image did not boot without its rollback point");
  assert.deepEqual(readdirSync(join(dir, "snapshots")), [], "no half-made snapshot left behind");
  // And once the update's marker exists, a later start never re-makes it over
  // a disk this image may already have touched.
});

test("snapshot.create takes only an id, no replay key, and is unavailable where this OMA keeps no snapshots", async t => {
  const { call } = await world(t, d => { writeFileSync(join(d, "state.img"), "x"); }, undefined, undefined,
    d => ({ snapshotsDir: join(d, "snapshots"), statePath: join(d, "state.img") }));
  // The update- namespace is the service's own pre-update marker: a user id
  // squatting there would win permanent prune protection and satisfy the
  // update's already-made check so the real rollback point is never taken.
  for (const bad of [{ id: "../escape" }, { id: 7 }, { id: "a", extra: true }, { unexpected: 1 },
    { id: "update-2026.09.1" }, { id: "update-anything" }]) {
    const answer = await call("snapshot.create", bad);
    assert.equal(answer.ok, false);
    assert.equal((answer.error as { code: string }).code, "INVALID_REQUEST", JSON.stringify(bad));
  }
  const keyed = await call("snapshot.create", {}, "a-key");
  assert.equal((keyed.error as { code: string }).code, "INVALID_REQUEST");

  const bare = await world(t);
  const answer = await bare.call("snapshot.create", {});
  assert.equal(answer.ok, false);
  assert.equal((answer.error as { code: string }).code, "UNSUPPORTED_PROFILE");
});

test("§8.4: a user id that merely ENDS in the update marker's bytes squats on nothing -- the rollback snapshot is still taken and the squatter's copy decays", async t => {
  const { call, dir, recordPath, driver } = await world(t,
    d => { writeFileSync(join(d, "state.img"), "the state disk"); },
    undefined, undefined,
    d => ({ snapshotsDir: join(d, "snapshots"), statePath: join(d, "state.img"),
      snapshotClone: (from, to) => { copyFileSync(from, to); } }));
  const snaps = join(dir, "snapshots");
  // `x-update-2026.09.1` is a legal id (alnum first, the rest inside the
  // alphabet) but its published name ends in the update marker's bytes. The
  // marker checks once ran on that tail: the squatter's file read as the
  // already-made marker AND won the update's permanent prune protection.
  const squat = await call("snapshot.create", { id: "x-update-2026.09.1" });
  assert.equal(squat.ok, true, JSON.stringify(squat));
  assert.deepEqual(readdirSync(snaps), ["00000000-x-update-2026.09.1.img"]);

  writeHostRecord(recordPath, { ...readHostRecord(recordPath)!, image: { current: "2026.08.0", previous: null } });
  let atBoot: string[] | undefined;
  const realStart = driver.start.bind(driver);
  driver.start = async () => { atBoot = readdirSync(snaps).sort(); await realStart(); };
  assert.deepEqual((await call("engine.start")).result, { state: "ready" });
  assert.deepEqual(atBoot, ["00000000-x-update-2026.09.1.img", "00000001-update-2026.09.1.img"],
    "the squatter's id is not the marker id: the real rollback snapshot was taken before the boot could write the disk");

  // And it keeps no protection: the keep count still sends the oldest off,
  // while the update's own stays.
  for (const id of ["p1", "p2", "p3"]) await call("snapshot.create", { id });
  assert.deepEqual(readdirSync(snaps).sort(),
    ["00000001-update-2026.09.1.img", "00000002-p1.img", "00000003-p2.img", "00000004-p3.img"],
    "the squatter's copy pruned like any user's; the unsettled update's stayed");
});

test("§8.4/UX-24: a resume as the first interaction after an update keeps the pre-update disk before the boot writes it", async t => {
  const { call, dir, recordPath, driver } = await world(t,
    d => { writeFileSync(join(d, "state.img"), "the state disk"); },
    undefined, undefined,
    d => ({ snapshotsDir: join(d, "snapshots"), statePath: join(d, "state.img"),
      snapshotClone: (from, to) => { copyFileSync(from, to); } }));
  const snaps = join(dir, "snapshots");
  // A bound project to resume into, and the previous image's record: this
  // boot is the update's first.
  const mac = join(dir, "mac"); mkdirSync(mac);
  const project = { projectId: "11111111-2222-4333-8444-555555555555", displayName: "demo-proj",
    bookmark: Buffer.from(mac).toString("base64"), gitCommonDir: "/x", objectFormat: "sha1" as const,
    rootCommits: ["0".repeat(40)], society: "demo" };
  writeHostRecord(recordPath, { ...readHostRecord(recordPath)!, image: { current: "2026.08.0", previous: null }, projects: [project] });
  let atBoot: string[] | undefined;
  const realStart = driver.start.bind(driver);
  driver.start = async () => { atBoot = readdirSync(snaps); await realStart(); };
  // The resume itself may not finish (no saved history, no real repository):
  // what is pinned is the disk state at the instant the driver booted.
  await call("session.resume", { projectId: project.projectId, society: "demo", sessionId: "sess-1", file: "saved.jsonl" });
  assert.equal(driver.starts, 1, "the resume booted the engine");
  assert.deepEqual(atBoot, ["00000000-update-2026.09.1.img"],
    "the update marker existed before lifecycle.start ran");
  assert.equal(readFileSync(join(snaps, "00000000-update-2026.09.1.img"), "utf8"), "the state disk");
});

test("§8.4: an image version with a +build suffix is a legal snapshot id -- the update marker is made and the boot proceeds", async t => {
  const expectImage = "2026.09.1+build7";
  const { call, dir, recordPath, driver } = await world(t,
    d => { writeFileSync(join(d, "state.img"), "the state disk"); },
    undefined, undefined,
    d => {
      const written = readHostRecord(join(d, "host-record.json"))!;
      return { snapshotsDir: join(d, "snapshots"), statePath: join(d, "state.img"),
        snapshotClone: (from, to) => { copyFileSync(from, to); },
        identity: { hostVersion: "1.0.0", installationId: written.installationId, instanceId: written.instanceId,
          expectImage, protocol: { min: HOST_GUEST_PROTOCOL, max: HOST_GUEST_PROTOCOL } } };
    });
  // manifest.version (image.ts) and expectImage (host-guest.ts) accept "+";
  // the snapshot id rule did not, so `update-<version>` was refused and the
  // update's first boot could never be taken.
  driver.image = expectImage;
  writeHostRecord(recordPath, { ...readHostRecord(recordPath)!, image: { current: "2026.08.0", previous: null } });
  assert.deepEqual((await call("engine.start")).result, { state: "ready" });
  assert.deepEqual(readdirSync(join(dir, "snapshots")), ["00000000-update-2026.09.1+build7.img"],
    "the pre-update snapshot was taken, '+' and all");
  // The user-facing rule is the same one: a '+' id is accepted at the wire.
  const named = await call("snapshot.create", { id: "pre-9.2+rc1" });
  assert.equal(named.ok, true, JSON.stringify(named));
});

test("AV-22/P0-2: two archive-key asks on an empty store make one key, not two winners", async t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-archivekey-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const items = new Map<string, string>();
  const keychain = {
    // A slow write widens the get->put window to what two processes see.
    get: async (account: string) => items.get(account),
    put: async (account: string, value: string) => { await new Promise(r => setTimeout(r, 30)); items.set(account, value); },
  };
  const lockPath = join(dir, "archive-key.lock");
  const [first, second, third] = await Promise.all([archiveKey(keychain, lockPath), archiveKey(keychain, lockPath), archiveKey(keychain, lockPath)]);
  assert.equal(first.length, 32);
  assert.ok(first.equals(second) && second.equals(third), "every ask got the one stored key, not its own");
  assert.equal(items.size, 1, "one archive key was written");
  assert.equal(items.get("archive"), first.toString("base64"));
});

test("P0-2: an archive-key ask against a held writer lock refuses in bounded time", async t => {
  // The audited code waited on ProcessLock.tryAcquire in an unbounded loop:
  // a live holder that never releases spun forever and the ask never came
  // back. The wait is now deadline-bounded like every other wait this
  // service makes; on expiry it reports the honest unavailable.
  const dir = mkdtempSync(join(tmpdir(), "oma-archivekey-lock-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const lockPath = join(dir, "archive-key.lock");
  const held = ProcessLock.acquire(lockPath);
  t.after(() => held.close());
  const keychain = memoryKeychain();
  const started = Date.now();
  await assert.rejects(archiveKey(keychain, lockPath, 100),
    (error: unknown) => error instanceof StoreError && error.code === "BROKER_UNAVAILABLE",
    "a still-held lock is a bounded refusal, not a forever wait");
  assert.ok(Date.now() - started < 10_000, "the refusal returned promptly");
  assert.equal(keychain.items.size, 0, "no key was generated behind a held lock");
});

test("FJ-6: the archive-key wait refuses a non-finite or non-positive deadline instead of spinning", async t => {
  // waitMs feeds only `deadline = now + waitMs`. With NaN the comparison
  // `now >= deadline` is always false and the audited loop spun forever --
  // the exact unbounded wait the deadline exists to bound. The deadline must
  // be validated before the first try, and a stored key does not excuse an
  // invalid wait either: the argument is still a lie.
  const dir = mkdtempSync(join(tmpdir(), "oma-archivekey-wait-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const lockPath = join(dir, "archive-key.lock");
  // A lock a live process holds: every try is a miss, so a non-finite wait
  // would never return -- the refusal is the only honest answer.
  const held = ProcessLock.acquire(lockPath);
  t.after(() => held.close());
  const keychain = memoryKeychain();
  for (const waitMs of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])
    await assert.rejects(archiveKey(keychain, lockPath, waitMs),
      (error: unknown) => error instanceof StoreError,
      `waitMs=${waitMs} is an invalid wait, refused before the first try`);
  keychain.items.set("archive", randomBytes(32).toString("base64"));
  await assert.rejects(archiveKey(keychain, lockPath, Number.NaN),
    (error: unknown) => error instanceof StoreError, "an invalid wait is refused even when the key is already stored");
});

test("FJ-6: a transient lock-acquire errno is an unavailable, not an environment error", async t => {
  // EMFILE/ENFILE/EAGAIN from tryAcquire mean "try later", not "someone else
  // owns this" and not a raw syscall failure reaching the caller: the audited
  // loop let them escape as errno-coded Errors.
  const dir = mkdtempSync(join(tmpdir(), "oma-archivekey-errno-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const lockPath = join(dir, "archive-key.lock");
  const keychain = memoryKeychain();
  for (const code of ["EMFILE", "ENFILE", "EAGAIN"]) {
    const tryAcquire = t.mock.method(ProcessLock, "tryAcquire", (): ProcessLock | null => {
      throw Object.assign(new Error("injected descriptor exhaustion"), { code });
    });
    try {
      await assert.rejects(archiveKey(keychain, lockPath, 100),
        (error: unknown) => error instanceof StoreError && error.code === "BROKER_UNAVAILABLE",
        `a ${code} acquire is a transient unavailability`);
    } finally { tryAcquire.mock.restore(); }
  }
  assert.equal(keychain.items.size, 0, "no key was generated");
  // A non-transient error still surfaces as itself.
  const other = t.mock.method(ProcessLock, "tryAcquire", (): ProcessLock | null => {
    throw Object.assign(new Error("injected corrupt path"), { code: "ENOTDIR" });
  });
  try {
    await assert.rejects(archiveKey(keychain, lockPath, 100),
      (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOTDIR",
      "an unrelated acquire failure is not relabeled unavailable");
  } finally { other.mock.restore(); }
});
