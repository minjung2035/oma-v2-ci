import { prepareHostProjectDirectory } from "@oma/platform-mac/files";
/** macos-platform §6 (MAC-404, MAC-411/412, MAC-420, MAC-240/241, §4.8,
 * MV-50/51/53/54): project sync end to end with real git -- the host's git on
 * a "Mac" repository, the stream channel, and guesthost's mirror, ledger and
 * export -- over the real guest server. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { connect, type Server } from "node:net";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { encodeFrame } from "@oma/protocol/frame";
import { PlatformError } from "@oma/protocol/host-errors";
import { readLeadingFrame } from "#oma-test/app/platform/rpc";
import { startGuestServer, type GuestIdentity } from "#oma-test/app/platform/guest/server";
import { GuestHost } from "#oma-test/app/platform/guest/host";
import { GuestProjects } from "#oma-test/app/platform/guest/project";
import { RequestLedger } from "#oma-test/app/platform/guest/requests";
import { serveStream } from "#oma-test/app/platform/guest/stream";
import { GuestLink } from "#oma-test/app/platform/host/guest-link";
import { MacGit } from "@oma/git/host-project";
import { fileSink, getStream, putStream } from "#oma-test/app/platform/host/project";
import { HOST_GUEST_PROTOCOL, PLATFORM_FRAME_BYTES } from "@oma/protocol/host-guest";
import { provisionSociety } from "#oma-test/app/runtime/provision";
import { ProjectSyncCoordinator } from "#oma-test/app/platform/host/project-sync";
import { newHostRecord, readHostRecord, writeHostRecord } from "@oma/platform-mac/record";

const INSTANCE = randomUUID();
const git = (cwd: string, ...args: string[]): string => {
  const run = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" });
  assert.equal(run.status, 0, `git ${args.join(" ")}: ${run.stderr}`);
  return run.stdout.trim();
};
const commit = (repo: string, name: string): string => { writeFileSync(join(repo, name), `${name}\n`); git(repo, "add", name); git(repo, "commit", "-qm", name); return git(repo, "rev-parse", "HEAD"); };

async function world(t: import("node:test").TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "oma-project-"));
  const societiesDir = join(dir, "data", "oma"); const projectsDir = join(dir, "projects");
  mkdirSync(societiesDir, { recursive: true }); mkdirSync(projectsDir);
  const ledger = new RequestLedger(join(dir, "requests"));
  const projects = new GuestProjects(projectsDir, societiesDir, ledger);
  const host = new GuestHost({ societiesDir, projectsDir, projects, ledger, stopDeadlineMs: 1000,
    launcher: { socketPath: s => join(dir, `${s}.sock`), start: async () => {}, stop: async () => "stopped" } });
  const identity = (): GuestIdentity => ({ instanceId: INSTANCE, guestImage: "2026.09.1", bootId: "8f14e45f-ceea-4e7a-9f6b-1b1a2c3d4e5f",
    stateSchema: { written: 1, readable: [1] }, capabilities: [] });
  const guestSocket = join(dir, "society.sock");
  const guest: Server = await startGuestServer({ socketPath: guestSocket, identity, bridge: { uid: process.getuid!(), gid: process.getgid!() },
    frameBytes: PLATFORM_FRAME_BYTES, helloDeadlineMs: 2000, requestTimeoutMs: 30_000, channels: {
      society: { kind: "json", serve: ({ peer }) => host.serve(peer) },
      stream: { kind: "bytes", serve: socket => { void serveStream(socket, { ledger, frameBytes: PLATFORM_FRAME_BYTES, deadlineMs: 5000, reserveBytes: 0, dataDir: dir }); } },
    } });
  const link = new GuestLink({ connect: async () => { const s = connect(guestSocket); await new Promise<void>((ok, f) => { s.once("connect", ok); s.once("error", f); }); return s; } },
    { hostVersion: "1.0.0", installationId: randomUUID(), instanceId: INSTANCE, expectImage: "2026.09.1", protocol: { min: HOST_GUEST_PROTOCOL, max: HOST_GUEST_PROTOCOL } },
    { frameBytes: PLATFORM_FRAME_BYTES, helloDeadlineMs: 2000, requestTimeoutMs: 30_000 });
  const peers: import("#oma-test/app/platform/rpc").FramedPeer[] = [];
  t.after(async () => { for (const peer of peers) peer.close(); await new Promise(r => guest.close(r)); rmSync(dir, { recursive: true, force: true }); });
  const request = async (method: string, params: Record<string, unknown>, key?: string) => {
    const peer = await link.json("society"); peers.push(peer);
    try { return await peer.request(method, params, key); } finally { peer.close(); }
  };

  // The Human's repository, set up to run things if anything lets it (MAC-404).
  const mac = join(dir, "mac"); mkdirSync(mac);
  git(mac, "init", "-q", "-b", "main");
  const marker = join(dir, "ran");
  const hooks = join(dir, "evil-hooks"); mkdirSync(hooks);
  for (const hook of ["reference-transaction", "post-checkout", "pre-auto-gc", "post-merge"]) {
    writeFileSync(join(hooks, hook), `#!/bin/sh\necho ${hook} >> ${marker}\n`); chmodSync(join(hooks, hook), 0o755);
  }
  writeFileSync(join(dir, "fsmonitor.sh"), `#!/bin/sh\necho fsmonitor >> ${marker}\n`); chmodSync(join(dir, "fsmonitor.sh"), 0o755);
  const first = commit(mac, "one");
  git(mac, "config", "core.hooksPath", hooks);
  git(mac, "config", "core.fsmonitor", join(dir, "fsmonitor.sh"));
  const transfer = (name: string) => join(dir, `${name}.bundle`);
  return { dir, mac, marker, first, link, request, projectsDir, societiesDir, ledger, transfer, macGit: new MacGit("/usr/bin/git", prepareHostProjectDirectory) };
}
const code = (expected: string) => (error: unknown) => error instanceof PlatformError && error.failure.code === expected;

test("§6.3/MAC-411/MV-50: import fills the mirror's refs/remotes/mac and HEAD, from the Mac's branch, incrementally", async t => {
  const w = await world(t);
  const projectId = randomUUID();
  const bundled = await w.macGit.bundle(w.mac, "main", null, w.transfer("i1"));
  await putStream(await w.link.bytes("stream"), "import-1", w.transfer("i1"), PLATFORM_FRAME_BYTES);
  const imported = await w.request("project.import", { projectId, branch: "main", bundle: { bytes: bundled.bytes, sha256: bundled.sha256 } }, "import-1");
  assert.deepEqual(imported, { head: w.first, ref: "refs/remotes/mac/main", objectFormat: "sha1", notCarried: [] });
  const mirror = join(w.projectsDir, projectId);
  assert.equal(git(mirror, "rev-parse", "HEAD"), w.first);
  assert.equal(git(mirror, "for-each-ref", "--format=%(refname)"), "refs/remotes/mac/main", "the mirror has the Mac's branch and nothing else");

  const second = commit(w.mac, "two");
  const incremental = await w.macGit.bundle(w.mac, "main", w.first, w.transfer("i2"));
  await putStream(await w.link.bytes("stream"), "import-2", w.transfer("i2"), PLATFORM_FRAME_BYTES);
  assert.equal((await w.request("project.import", { projectId, branch: "main", bundle: { bytes: incremental.bytes, sha256: incremental.sha256 } }, "import-2")).head, second);
  assert.equal(git(mirror, "rev-parse", "HEAD"), second);
});

for (const legacy of [false, true]) test(`first Society provisioning preserves the imported tree (legacy mirror: ${legacy})`, async t => {
  const w = await world(t), projectId = randomUUID();
  writeFileSync(join(w.mac, "one"), "dirty tracked bytes\n");
  writeFileSync(join(w.mac, "untracked"), "new bytes\n");
  const bundled = await w.macGit.bundle(w.mac, "main", null, w.transfer("seed"));
  const mirror = join(w.projectsDir, projectId);
  if (legacy) {
    mkdirSync(mirror); git(mirror, "init", "-q");
    git(mirror, "fetch", "-q", w.transfer("seed"), "+refs/heads/main:refs/remotes/mac/main");
    git(mirror, "update-ref", "--no-deref", "HEAD", bundled.head);
  } else {
    await putStream(await w.link.bytes("stream"), "seed", w.transfer("seed"), PLATFORM_FRAME_BYTES);
    await w.request("project.import", { projectId, branch: "main", bundle: { bytes: bundled.bytes, sha256: bundled.sha256 } }, "seed");
  }
  await w.request("society.open", { society: "demo", projectId });
  await provisionSociety(join(w.societiesDir, "demo"), { projectDir: mirror });
  const canonical = join(w.societiesDir, "demo", "repos", "project.git");
  assert.equal(git(canonical, "rev-parse", "main"), bundled.head);
  assert.equal(git(canonical, "show", "main:one"), "dirty tracked bytes");
  assert.equal(git(canonical, "show", "main:untracked"), "new bytes");
  assert.equal(git(w.mac, "rev-parse", "HEAD"), w.first);
});

test("unchanged import/export and a rewound branch still produce usable bundles", async t => {
  const w = await world(t);
  const same = await w.macGit.bundle(w.mac, "main", w.first, w.transfer("same"));
  assert.equal(same.head, w.first);
  git(w.mac, "bundle", "verify", w.transfer("same"));
  const newer = commit(w.mac, "later");
  git(w.mac, "update-ref", "refs/heads/main", w.first);
  assert.equal((await w.macGit.bundle(w.mac, "main", newer, w.transfer("rewound"))).head, w.first);
  const canonical = join(w.societiesDir, "demo", "repos", "project.git");
  mkdirSync(join(w.societiesDir, "demo", "repos"), { recursive: true });
  git(w.dir, "clone", "-q", "--bare", w.mac, canonical);
  assert.equal((await w.request("project.export", { society: "demo", since: w.first }, "same-export")).head, w.first);
  await getStream(await w.link.bytes("stream"), "same-export", () => fileSink(w.transfer("same-export")), PLATFORM_FRAME_BYTES);
  assert.equal((await w.macGit.fetchExport(w.mac, w.transfer("same-export"))).head, w.first);
});

test("overlapping same-key puts cannot remove or overwrite a completed retry", async t => {
  const w = await world(t), key = "overlapping-put", body = Buffer.from("complete bundle bytes");
  const sha256 = createHash("sha256").update(body).digest("hex");
  const first = (await w.link.bytes("stream")).socket;
  first.write(encodeFrame({ v: 1, id: "put", method: "stream.put", params: { key, bytes: body.length, sha256 } }));
  first.write(body.subarray(0, 1));
  const staged = w.ledger.staging(key, "bundle"), parent = join(staged, "..");
  const partials = () => readdirSync(parent).filter(name => name.endsWith(".partial"));
  for (let i = 0; i < 200 && !partials().some(name => statSync(join(parent, name)).size > 0); i++)
    await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(partials().length, 1);
  writeFileSync(w.transfer("put"), body);
  await putStream(await w.link.bytes("stream"), key, w.transfer("put"), PLATFORM_FRAME_BYTES);
  first.destroy();
  for (let i = 0; i < 200 && partials().length > 0; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(readFileSync(staged), body);
  assert.deepEqual(partials(), []);
  await putStream(await w.link.bytes("stream"), key, w.transfer("put"), PLATFORM_FRAME_BYTES);
  writeFileSync(w.transfer("put"), "conflicting bytes");
  await assert.rejects(putStream(await w.link.bytes("stream"), key, w.transfer("put"), PLATFORM_FRAME_BYTES), code("STREAM_INVALID"));
  assert.deepEqual(readFileSync(staged), body);
  const orphan = `.${staged.split("/").at(-1)!}.${randomUUID()}.partial`;
  writeFileSync(join(parent, orphan), "interrupted upload");
  w.ledger.collectStreamTemporaries();
  assert.equal(existsSync(join(parent, orphan)), false);
  assert.deepEqual(readFileSync(staged), body, "startup cleanup preserves the completed put");
});

for (const fault of ["before-upload", "lost-result", "permanent-refusal"] as const) test(`host retries the frozen dirty snapshot after restart: ${fault}`, async t => {
  const w = await world(t), recordPath = join(w.dir, "host-record.json"), projectId = randomUUID();
  const identity = await w.macGit.identity(w.mac);
  writeHostRecord(recordPath, { ...newHostRecord(), projects: [{ ...identity, projectId, society: "demo", displayName: "demo", bookmark: "YQ==" }] });
  const options = { link: w.link, git: "/usr/bin/git", recordPath,
    record: (update: (value: NonNullable<ReturnType<typeof readHostRecord>>) => NonNullable<ReturnType<typeof readHostRecord>>) =>
      writeHostRecord(recordPath, update(readHostRecord(recordPath)!)),
    bookmarks: { create: async () => "YQ==", resolve: async () => w.mac }, transfer: w.dir, room: () => {} };
  const bytes = w.link.bytes.bind(w.link), json = w.link.json.bind(w.link);
  if (fault === "before-upload") w.link.bytes = async () => { throw new Error("lost upload connection"); };
  else w.link.json = async (...args) => {
    const peer = await json(...args), request = peer.request.bind(peer);
    peer.request = async (...args) => {
      if (fault === "permanent-refusal") throw new PlatformError({ code: "BUNDLE_INVALID", message: "lost bundle prerequisites", retry: "never" });
      await request(...args); throw new Error("lost import result");
    };
    return peer;
  };
  writeFileSync(join(w.mac, "one"), "original dirty snapshot\n");
  const params = { projectId, macRepo: w.mac, branch: "main", since: null };
  await assert.rejects(new ProjectSyncCoordinator(options).importProject("frozen", params), /lost/);
  w.link.bytes = bytes; w.link.json = json;
  writeFileSync(join(w.mac, "one"), "changed while disconnected\n");
  const coordinator = new ProjectSyncCoordinator(options);
  if (fault === "permanent-refusal") {
    w.link.bytes = async () => { throw new Error("terminal retry must not connect"); };
    await assert.rejects(coordinator.importProject("frozen", params), code("BUNDLE_INVALID"));
    for (const name of readdirSync(join(w.dir, "imports")))
      assert.deepEqual(readdirSync(join(w.dir, "imports", name)), ["request.json"]);
    assert.equal(readHostRecord(recordPath)!.projects[0]!.lastImport, undefined);
    return;
  }
  const result = await coordinator.importProject("frozen", params);
  assert.equal(git(join(w.projectsDir, projectId), "show", `${result.head}:one`), "original dirty snapshot");
  assert.equal(readHostRecord(recordPath)!.projects[0]!.lastImport?.head, result.head);
  assert.deepEqual(await coordinator.importProject("frozen", params), result);
  await assert.rejects(coordinator.importProject("frozen", { ...params, branch: "other" }), { code: "REQUEST_KEY_REUSED" });
  const newer = await coordinator.importProject("new-import", params);
  assert.notEqual(newer.head, result.head);
  await coordinator.importProject("frozen", params);
  assert.equal(readHostRecord(recordPath)!.projects[0]!.lastImport?.head, newer.head);
  for (const name of readdirSync(join(w.dir, "imports")))
    assert.deepEqual(readdirSync(join(w.dir, "imports", name)), ["request.json"], "only the receipt remains after completion");
});

test("UX-09/MV-50: an incremental import names the gitlink paths a bundle cannot carry", async t => {
  const w = await world(t);
  const projectId = randomUUID();
  const bundled = await w.macGit.bundle(w.mac, "main", null, w.transfer("base"));
  await putStream(await w.link.bytes("stream"), "import-base", w.transfer("base"), PLATFORM_FRAME_BYTES);
  await w.request("project.import", { projectId, branch: "main", bundle: { bytes: bundled.bytes, sha256: bundled.sha256 } }, "import-base");
  // A gitlink has to be built in the index: `git add` of a real submodule needs
  // a checked-out one, but the tree entry is all the mirror (and the import's
  // ls-tree scan) ever sees. The initial snapshot materializes the working
  // tree and would drop it; an incremental bundle carries the real objects.
  git(w.mac, "update-index", "--add", "--cacheinfo", `160000,${w.first},dep`);
  git(w.mac, "commit", "-qm", "link dep");
  const head = git(w.mac, "rev-parse", "main");
  const incremental = await w.macGit.bundle(w.mac, "main", w.first, w.transfer("link"));
  await putStream(await w.link.bytes("stream"), "import-link", w.transfer("link"), PLATFORM_FRAME_BYTES);
  const imported = await w.request("project.import", { projectId, branch: "main", bundle: { bytes: incremental.bytes, sha256: incremental.sha256 } }, "import-link") as { head: string; notCarried: string[] };
  assert.equal(imported.head, head, "the mirror took the gitlink-bearing tip");
  assert.ok(git(join(w.projectsDir, projectId), "ls-tree", "-r", head).split("\n")
    .includes(`160000 commit ${w.first}\tdep`), "the mirror's tree carries the gitlink");
  assert.deepEqual(imported.notCarried, ["submodule contents (dep)"]);
});

test("MAC-240/241: a key's request is answered from its outcome, another request under it is refused, and its status is kept", async t => {
  const w = await world(t);
  const projectId = randomUUID();
  const bundled = await w.macGit.bundle(w.mac, "main", null, w.transfer("k"));
  await putStream(await w.link.bytes("stream"), "same-key", w.transfer("k"), PLATFORM_FRAME_BYTES);
  const params = { projectId, branch: "main", bundle: { bytes: bundled.bytes, sha256: bundled.sha256 } };
  const once = await w.request("project.import", params, "same-key");
  rmSync(join(w.projectsDir, projectId), { recursive: true });
  assert.deepEqual(await w.request("project.import", params, "same-key"), once, "answered from the outcome, not done twice");
  assert.equal(existsSync(join(w.projectsDir, projectId)), false);
  await assert.rejects(w.request("project.import", { ...params, branch: "other" }, "same-key"), code("REQUEST_KEY_REUSED"));
  assert.deepEqual(await w.request("request.status", { key: "same-key" }), { state: "done", method: "project.import", result: once });
  await assert.rejects(w.request("request.status", { key: "never-sent" }), code("REQUEST_NOT_FOUND"));
});

test("§4.8: a stream that is not what it declared is refused and nothing is imported from it", async t => {
  const w = await world(t);
  const bundled = await w.macGit.bundle(w.mac, "main", null, w.transfer("bad"));
  const { socket } = await w.link.bytes("stream");
  socket.write(encodeFrame({ v: 1, id: "put", method: "stream.put", params: { key: "bad-stream", bytes: bundled.bytes, sha256: "0".repeat(64) } }));
  socket.write(readFileSync(w.transfer("bad")));
  const answer = await readLeadingFrame(socket, PLATFORM_FRAME_BYTES, 5000);
  socket.destroy();
  assert.equal((answer.frame.error as { code: string }).code, "STREAM_INVALID");
  await assert.rejects(w.request("project.import", { projectId: randomUUID(), branch: "main", bundle: { bytes: bundled.bytes, sha256: bundled.sha256 } }, "bad-stream"),
    code("STREAM_INVALID"));
});

test("§6.4/MAC-420/MV-51: export brings the engine's main into refs/remotes/oma/main and changes nothing else in the Mac repository", async t => {
  const w = await world(t);
  // The society's canonical repository, with work on main.
  const canonical = join(w.societiesDir, "demo", "repos", "project.git");
  mkdirSync(join(w.societiesDir, "demo", "repos"), { recursive: true });
  git(w.dir, "clone", "-q", "--bare", w.mac, canonical);
  const work = join(w.dir, "work"); git(w.dir, "clone", "-q", canonical, work);
  const done = commit(work, "engine-work"); git(work, "push", "-q", "origin", "main");
  writeFileSync(join(w.mac, "uncommitted"), "the Human's\n");
  const before = { heads: git(w.mac, "for-each-ref", "refs/heads"), head: git(w.mac, "rev-parse", "HEAD"), status: git(w.mac, "--no-optional-locks", "status", "--porcelain") };

  const exported = await w.request("project.export", { society: "demo" }, "export-1");
  assert.equal(exported.head, done);
  await getStream(await w.link.bytes("stream"), "export-1", () => fileSink(w.transfer("e1")), PLATFORM_FRAME_BYTES);
  assert.deepEqual(await w.macGit.fetchExport(w.mac, w.transfer("e1")), { head: done });
  assert.equal(git(w.mac, "rev-parse", "refs/remotes/oma/main"), done);
  assert.deepEqual({ heads: git(w.mac, "for-each-ref", "refs/heads"), head: git(w.mac, "rev-parse", "HEAD"), status: git(w.mac, "--no-optional-locks", "status", "--porcelain") }, before,
    "branches, HEAD, index and working tree are byte for byte as they were");
});

test("MAC-404/MV-54: nothing the Mac repository configures to run is run by the host's git", async t => {
  const w = await world(t);
  await w.macGit.bundle(w.mac, "main", null, w.transfer("m1"));
  const canonical = join(w.dir, "canonical.git");
  git(w.dir, "clone", "-q", "--bare", w.mac, canonical);
  git(canonical, "bundle", "create", "-q", w.transfer("m2"), "refs/heads/main");
  await w.macGit.fetchExport(w.mac, w.transfer("m2"));
  assert.equal(existsSync(w.marker), false, "no hook and no fsmonitor ran");
  // The same repository does run them for a git that trusts it: the trap is armed.
  spawnSync("git", ["-C", w.mac, "update-ref", "refs/heads/probe", "HEAD"], { encoding: "utf8" });
  assert.equal(existsSync(w.marker), true);
});

test("MV-53: a sha256 project makes a sha256 mirror", async t => {
  const w = await world(t);
  const mac = join(w.dir, "mac256"); mkdirSync(mac);
  git(mac, "init", "-q", "-b", "main", "--object-format=sha256");
  const head = commit(mac, "one");
  const bundled = await w.macGit.bundle(mac, "main", null, w.transfer("s"));
  await putStream(await w.link.bytes("stream"), "sha256-import", w.transfer("s"), PLATFORM_FRAME_BYTES);
  const projectId = randomUUID();
  const imported = await w.request("project.import", { projectId, branch: "main", bundle: { bytes: bundled.bytes, sha256: bundled.sha256 } }, "sha256-import");
  assert.equal(imported.objectFormat, "sha256");
  assert.equal(imported.head, head);
  assert.equal(git(join(w.projectsDir, projectId), "rev-parse", "--show-object-format"), "sha256");
});

