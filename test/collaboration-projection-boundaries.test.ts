/** Actual publication child SIGKILL and fresh-process projection recovery.
 * Original Store/Mail/Git facts stay authoritative. Supplied authentication and
 * process death are not kernel containment, whole-broker crash or power loss. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Store } from "@oma/storage";
import type { AuthContext } from "@oma/contracts";
import { batchViewPathAt, runnerViewPathAt, collaborationRecordRootPathAt } from "@oma/domain/paths";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { fixture as reviewFixture } from "./fixtures/review-fixture.js";
import { TEST_PROTOCOL_LIMITS } from "./fixtures/limits.js";
import { ALL_CAPS, makeValidAgent } from "./fixtures/spec.js";
import { removeTree } from "./fixtures/cleanup.js";

const deliveryChild = `
import fs from "node:fs"; import { join, dirname } from "node:path"; import { syncBuiltinESMExports } from "node:module";
import { Store } from "@oma/storage";
import { batchViewPathAt, runnerViewPathAt } from "@oma/domain/paths";
import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { createGitModule } from "#oma-test/app/broker/git-composition";
import { lifecycleLedger } from "#oma-test/app/broker/lifecycle-ledger";
import { LifecyclePolicy } from "@oma/lifecycle/policy";
import { ViewsModule } from "#oma-test/app/views";
const [root, point] = process.argv.slice(1), { auth, batch, limits } = JSON.parse(fs.readFileSync(join(root, "delivery-input.json"), "utf8"));
auth.capabilities = new Set(auth.capabilities);
const store = new Store(join(root, "runtime.sqlite"));
try {
  const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 16, 24, limits);
  const git = createGitModule({ stateRoot: root, projectGit: join(root, "repos/project.git"), contextGit: join(root, "repos/context.git"), worldDir: join(root, "world"), society: "demo" }, store, mail, null);
  const policy = new LifecyclePolicy(lifecycleLedger(store), Object.assign(() => null, {
    maxWorkers: () => 6, observe: () => ({ profile: "p", modelProfile: "md", capabilities: [...auth.capabilities] }) }));
  const views = new ViewsModule(store, root, "demo", "p", limits);
  views.bindCollaborationRecords({ mail, git, lifecycle: { creation: a => policy.observeCreation(a) } });
  const refreshed = views.refreshCollaborationRecords(auth, undefined, batch);
  const batchPath = batchViewPathAt(root, auth.actor, batch.id), indexPath = join(runnerViewPathAt(root, auth.actor), "inbox.md");
  const fsync = fs.fsyncSync;
  if (point) { fs.fsyncSync = fd => {
    fsync(fd); const stat = fs.fstatSync(fd), target = point === "batch-json" ? batchPath : indexPath;
    if (!stat.isDirectory() || !fs.existsSync(target)) return;
    const parent = fs.statSync(dirname(target)); if (stat.ino !== parent.ino || stat.dev !== parent.dev) return;
    if (!fs.readFileSync(target, "utf8").includes(refreshed.inbox.generation)) return;
    fs.writeSync(1, point); process.kill(process.pid, "SIGKILL");
  }; syncBuiltinESMExports(); }
  const result = views.publishCollaborationDelivery(auth, batch, refreshed.inbox);
  fs.writeSync(1, JSON.stringify({ result, inbox: refreshed.inbox }));
} finally { store.close(); }
`;

for (const point of ["batch-json", "delivery-index"] as const) test(`001. Delivery presentation: actual SIGKILL at ${point} retains the exact prepared batch and links its immutable inbox generation`, async t => {
  const root = fs.mkdtempSync(join(tmpdir(), "oma-delivery-projection-")), store = new Store(join(root, "runtime.sqlite"));
  t.after(() => { store.close(); removeTree(root); });
  store.transaction(tx => { for (const actor of ["alice", "bob", "principal"]) tx.insertAgent(makeValidAgent(actor)); });
  const auth: AuthContext = { actor: "alice", incarnation: 1, role: "resident", channel: "actor", capabilities: new Set(ALL_CAPS),
    peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!() } };
  const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 16, 24, TEST_PROTOCOL_LIMITS);
  await mail.send({ ...auth, actor: "bob" }, "original-delivery", { to: ["alice"], kind: "message", subject: "Original navigation", body: "\ufeffexact delivered body\r\n" });
  const batch = await mail.prepare(auth); assert.ok(batch);
  const accepted = store.acceptedOperationPage(), batchRow = store.getBatch(batch.id), deliveries = store.deliveriesForOperation(accepted.items[0]!.operation.id);
  fs.writeFileSync(join(root, "delivery-input.json"), JSON.stringify({ auth: { ...auth, capabilities: [...auth.capabilities] }, batch, limits: TEST_PROTOCOL_LIMITS }));
  const run = (stop: string) => spawnSync(process.execPath, ["--input-type=module", "--eval", deliveryChild, root, stop], { encoding: "utf8", timeout: 30000 });
  const killed = run(point); assert.ifError(killed.error); assert.equal(killed.status, null, killed.stderr); assert.equal(killed.signal, "SIGKILL", killed.stderr); assert.equal(killed.stdout, point);
  const previousInboxes = new Map<string, Buffer>();
  for (let retry = 0; retry < 2; retry++) {
    const child = run(""); assert.ifError(child.error); assert.equal(child.status, 0, child.stderr); assert.equal(child.signal, null);
    const observed = JSON.parse(child.stdout); const { notice, ...unchanged } = observed.result;
    assert.deepEqual(unchanged, (({ notice: _notice, ...rest }) => rest)(batch));
    const generation: string = observed.inbox.generation; assert.match(generation, /^[a-f0-9]{64}$/u);
    assert.match(notice, /not understanding or task completion/); assert.ok(notice.includes(generation!));
    assert.equal(notice.includes("exact delivered body"), false, "navigation does not inject the body into model input");
    const physical = join(collaborationRecordRootPathAt(root, auth.actor), observed.inbox.indexPath.slice("/oma/".length));
    assert.equal(fs.existsSync(physical), true, "the advertised exact inbox generation exists");
    for (const [path, bytes] of previousInboxes) assert.deepEqual(fs.readFileSync(path), bytes, "a later timed observation cannot mutate an earlier inbox generation");
    previousInboxes.set(physical, fs.readFileSync(physical));
    const saved = JSON.parse(fs.readFileSync(batchViewPathAt(root, auth.actor, batch.id), "utf8"));
    assert.deepEqual(saved.messageIds, batch.messageIds); assert.equal(saved.notice, notice);
    assert.ok(fs.readFileSync(join(runnerViewPathAt(root, auth.actor), "inbox.md"), "utf8").includes(generation!));
    assert.deepEqual(store.getBatch(batch.id), batchRow); assert.deepEqual(store.acceptedOperationPage(), accepted);
    assert.deepEqual(store.deliveriesForOperation(accepted.items[0]!.operation.id), deliveries);
  }
});

const materialChild = `
import fs from "node:fs"; import { join, dirname } from "node:path"; import { syncBuiltinESMExports } from "node:module";
import { Store } from "@oma/storage"; import { ensureOwnedDirectory } from "@oma/storage/directory";
import { publishNoReplace } from "@oma/storage/durable-fs"; import { readImmutableBytes } from "@oma/storage/immutable-file";
import { createGitModule } from "#oma-test/app/broker/git-composition"; import { createMailModule } from "#oma-test/app/broker/mail-composition";
import { CollaborationReviewMaterials } from "#oma-test/app/views/collaboration-review-materials";
const [root, point] = process.argv.slice(1), input = JSON.parse(fs.readFileSync(join(root, "material-input.json"), "utf8"));
const store = new Store(join(root, "runtime.sqlite"), 0, { society: "demo" });
try {
  const mail = createMailModule({ stateRoot: root, society: "demo" }, store, 64);
  const git = createGitModule({ stateRoot: root, projectGit: join(root, "repos/project.git"), contextGit: join(root, "context.git"), worldDir: join(root, "world"), society: "demo" }, store, mail, null);
  const target = join(input.directory, point === "patch-copy" ? "proposal.patch" : point === "blob-copy" ? "objects/" + input.blob + ".bin" : "manifest.json");
  const fsync = fs.fsyncSync;
  if (point) { fs.fsyncSync = fd => {
    fsync(fd); const stat = fs.fstatSync(fd); if (!stat.isDirectory() || !fs.existsSync(target)) return;
    const parent = fs.statSync(dirname(target)); if (stat.dev !== parent.dev || stat.ino !== parent.ino) return;
    fs.writeSync(1, point); process.kill(process.pid, "SIGKILL");
  }; syncBuiltinESMExports(); }
  const materials = new CollaborationReviewMaterials(store, git, root, (path, bytes) => {
    ensureOwnedDirectory(dirname(path), root); publishNoReplace(path, bytes, 0o444);
  }, (path, hash, bytes) => { if (!fs.existsSync(path)) return false; readImmutableBytes(path, hash, bytes); return true; });
  const hash = materials.publish(input.directory, input.base, input.candidate, input.identity);
  fs.writeSync(1, hash);
} finally { store.close(); }
`;

for (const point of ["patch-copy", "blob-copy", "material-manifest"] as const) test(`002. Review materials: actual SIGKILL at ${point} preserves recorded bytes and original Review facts`, async t => {
  const f = reviewFixture(); t.after(() => f.close());
  const binary = Buffer.from([0, 1, 2, 255, 13, 10]), candidate = f.candidateWith({ "text.txt": "\ufeffexact endpoint\r\n", "binary.bin": binary.toString("latin1") });
  await f.submit("alice", candidate, "source"); await f.open("alice", { tier: "MEDIUM", candidate }, "original-review");
  const request = f.store.getOperation("alice", "original-review")!, accepted = f.store.acceptedOperationPage(), refs = f.git(["for-each-ref", "--format=%(refname) %(objectname)"]);
  const directory = join(collaborationRecordRootPathAt(f.root, "bob"), "reviews", request.id, "new-endpoints-v1");
  const blob = f.git(["rev-parse", `${candidate}:binary.bin`]), scratch = join(f.root, "source-scratch"); fs.mkdirSync(scratch);
  fs.writeFileSync(join(f.root, "material-input.json"), JSON.stringify({ directory, base: f.base, candidate, blob,
    identity: { request: request.id, sourceOperation: f.store.getOperation("alice", "source")!.id, origin: "recorded immutable endpoints" } }));
  const run = (stop: string) => spawnSync(process.execPath, ["--input-type=module", "--eval", materialChild, f.root, stop],
    { encoding: "utf8", timeout: 30000, env: { ...process.env, TMPDIR: scratch } });
  const killed = run(point); assert.ifError(killed.error); assert.equal(killed.status, null, killed.stderr); assert.equal(killed.signal, "SIGKILL", killed.stderr); assert.equal(killed.stdout, point);
  const retained = () => fs.readdirSync(scratch).sort().map(name => ({ name, files: fs.readdirSync(join(scratch, name)).sort().map(file => ({ file, bytes: fs.readFileSync(join(scratch, name, file)) })) }));
  const earlierScratch = retained(), patch = fs.existsSync(join(directory, "proposal.patch")) ? fs.readFileSync(join(directory, "proposal.patch")) : null;
  let hash: string | undefined;
  for (let retry = 0; retry < 2; retry++) {
    f.reopen(); const child = run(""); assert.ifError(child.error); assert.equal(child.status, 0, child.stderr); assert.equal(child.signal, null);
    hash ??= child.stdout; assert.equal(child.stdout, hash);
    const manifest = JSON.parse(fs.readFileSync(join(directory, "manifest.json"), "utf8"));
    assert.equal(manifest.base, f.base); assert.equal(manifest.candidate, candidate);
    assert.equal(manifest.patch.origin, "new-observation-from-recorded-immutable-oids; not an originally stored patch");
    assert.deepEqual(fs.readFileSync(join(directory, "objects", `${blob}.bin`)), Buffer.from(binary.toString("latin1"), "utf8"));
    if (patch !== null) assert.deepEqual(fs.readFileSync(join(directory, "proposal.patch")), patch);
    assert.deepEqual(retained(), earlierScratch, "a new observation cannot collect an earlier observation's scratch");
    assert.deepEqual(f.store.getOperation("alice", "original-review"), request); assert.deepEqual(f.store.acceptedOperationPage(), accepted);
    assert.equal(f.git(["for-each-ref", "--format=%(refname) %(objectname)"]), refs);
  }
});
