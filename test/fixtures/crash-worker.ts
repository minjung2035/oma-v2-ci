// Isolated primitive crash worker: never imported by production.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join, dirname } from "node:path";
import { Store } from "../../src/store.js";
import { MailModule, publishImmutableFile, parseEmlHeaders } from "../../src/mail.js";
import type { AuthContext, MailInput } from "../../implementation/contracts.js";
import { isValidFullOid } from "../../src/ids.js";
import { sha256Hex } from "../../src/hash.js";
import cp from "node:child_process";
import { gitFixture, gitAuth, gitCommand, submitFixture, contextFixture } from "./git-crash.js";
import { lifecycleFixture } from "./lifecycle-crash.js";
import { TEST_VIEW_LIMITS } from "./limits.js";
import { assertGlobalInvariants } from "../invariants/index.js";

const [root, rawPoint] = process.argv.slice(2);
if (!root || !rawPoint) throw new Error("crash worker requires its owned root and requested boundary");
const point = rawPoint.replace(/^create-/, "boot-");
if (point.startsWith("ctx-accepted")) process.umask(0o077);
const store = new Store(join(root, "runtime.sqlite"));
const lifecycle = point.startsWith("boot-") ? lifecycleFixture(root, store) : null;
const mail = lifecycle?.mail ?? new MailModule({ stateRoot: root, society: "crash" }, store, 64, 24, TEST_VIEW_LIMITS);
const checkpoint = () => {
  if (!process.send) throw new Error("parent IPC observation channel is missing");
  assertGlobalInvariants(store, { stateRoot: root, society: lifecycle?.society ?? "crash",
    phase: "partial-materialization", viewLimits: TEST_VIEW_LIMITS });
  process.send({ point: rawPoint });
  process.kill(process.pid, "SIGSTOP");
  throw new Error("crash worker resumed unexpectedly");
};
let inTransaction = false;
const synced = new Set<string>();
const fsync = fs.fsyncSync;
fs.fsyncSync = fd => {
  if (inTransaction) throw new Error("M-004: fsync inside Store.transaction callback");
  const path = fs.readlinkSync(`/proc/self/fd/${fd}`);
  const faultTarget = point.startsWith("error-stage-") ? path.includes("/staging/") && path.endsWith(".eml")
    : /^error-(archive|recovery)-/.test(point) && path === join(root, "mail/archive/cur");
  const fail = () => { throw Object.assign(new Error(`injected ${point}`), { code: point.endsWith("before") ? "ENOSPC" : "EIO" }); };
  if (faultTarget && point.endsWith("before")) fail();
  fsync(fd); synced.add(path);
  if (faultTarget) fail();
  if (point === "stage" && path.includes("/staging/") && path.endsWith(".eml")) checkpoint();
  if (point === "object" && path === join(root, "mail", "objects")) checkpoint();
  if (point === "submit-stage" && path.endsWith("/upload.bundle") && path.startsWith(join(root, "staging") + "/")) checkpoint();
  if (point === "ctx-snapshot" && /\/world\/context\/revisions\/[0-9a-f]{40,64}$/.test(path)) checkpoint();
  if (point === "boot-stage" && path.includes("/staging/") && path.endsWith(".eml")) checkpoint();
  if (point === "boot-object" && path === join(root, "mail/objects")) checkpoint();
};
const link = fs.linkSync;
fs.linkSync = (source, destination) => {
  link(source, destination); const path = String(destination);
  if (point === "archive" && path.includes("/archive/cur/")) checkpoint();
  if (point === "boot-mail" && path.includes("/archive/cur/")) checkpoint();
  if (["submit-mail", "ctx-mail"].includes(point) && path.includes("/archive/cur/")) checkpoint();
  if (point === "inbox-a" && path.includes("/inboxes/a/new/")) checkpoint();
  if (point === "inbox-b" && path.includes("/inboxes/b/new/")) checkpoint();
};
const rename = fs.renameSync;
fs.renameSync = (source, destination) => {
  rename(source, destination);
  if (point === "cur" && String(destination).includes("/inboxes/a/cur/")) checkpoint();
  if (point === "ctx-link" && String(destination) === join(root, "world/context/current")) checkpoint();
  if (point === "boot-workspace" && String(destination).endsWith("/workspace")) checkpoint();
};
const copy = fs.copyFileSync;
fs.copyFileSync = (source, destination, mode) => {
  if (point === "copy") { fs.writeFileSync(destination, "partial", { flag: "wx" }); checkpoint(); }
  copy(source, destination, mode);
};
const spawn = cp.spawnSync;
cp.spawnSync = new Proxy(spawn, {
  apply(target, receiver, args) {
    if (inTransaction) throw new Error("M-004: subprocess inside Store.transaction callback");
    const argv: string[] = Array.isArray(args[1]) ? args[1] : [];
    if (args[0] === "git" || args[0] === "/usr/bin/git") {
      const env = args[2]?.env;
      if (env?.GIT_CONFIG_KEY_1 !== "core.fsync" || env.GIT_CONFIG_VALUE_1 !== "all" || env.GIT_CONFIG_KEY_2 !== "core.fsyncMethod" || env.GIT_CONFIG_VALUE_2 !== "fsync")
        throw new Error("Git effect lacks explicit object/ref fsync configuration");
    }
    const main = argv.includes("update-ref") && argv.includes("refs/heads/main");
    const project = argv.includes(join(root, "repos/project.git"));
    const context = argv.includes(join(root, "repos/context.git"));
    if (point === "int-before" && main && project) checkpoint();
    const result = Reflect.apply(target, receiver, args);
    if (result.status === 0 && !result.error && !result.signal) {
      if (point === "boot-unit" && argv.includes("daemon-reload")) checkpoint();
      if (point === "int-cas" && main && project) checkpoint();
      if (point === "ctx-cas" && main && context) checkpoint();
      if (point === "submit-ref" && argv.includes("update-ref") && argv.some(arg => arg.startsWith("refs/oma/published/"))) checkpoint();
      if (point === "submit-import" && args[0] === "/usr/bin/prlimit" && argv.includes("oma-quarantine")) checkpoint();
    }
    return result;
  },
});
syncBuiltinESMExports();
const transaction = store.transaction.bind(store);
store.transaction = body => {
  const beforeSync = new Set(synced);
  const result = transaction(tx => {
    inTransaction = true;
    try { return body(tx); } finally { inTransaction = false; }
  });
  if (point === "accepted" && store.getOperation("a", "crash-send")) checkpoint();
  if (point === "prepared" && store.preparedBatches("a").length) checkpoint();
  const operation = store.getOperation("a", "git-crash");
  if (point === "submit-accepted" && operation?.kind === "git.submit") {
    const bundle = operation.plan.bundle;
    if (!bundle || ![bundle.path, dirname(bundle.path), join(root, "staging")].every(path => beforeSync.has(path)))
      throw new Error("submit accepted before bundle/file/parent fsync");
    if (sha256Hex(fs.readFileSync(bundle.path)) !== bundle.sha256) throw new Error("accepted submit bundle digest differs from frozen bytes");
    if (fs.existsSync(mail.archivePath(operation.plan.message.id))) throw new Error("submit result mail was exposed before ref publication");
    checkpoint();
  }
  if (point === "submit-done" && operation?.kind === "git.submit" && operation.state === "succeeded") checkpoint();
  if (point.startsWith("ctx-accepted") && operation?.kind === "context.publish") {
    const plan = operation.plan;
    if (!isValidFullOid(plan.candidate) || plan.message.contextRevision !== plan.candidate) throw new Error("context candidate/message not frozen at acceptance");
    const commitWork = join(plan.stagingPath, "commit-work");
    const required = [join(root, "staging"), plan.stagingPath, commitWork, join(commitWork, ".git")];
    if (required.some(path => !beforeSync.has(path))) throw new Error("context accepted before candidate staging fsync");
    for (const entry of plan.entries) {
      const file = fs.lstatSync(join(commitWork, entry.path));
      if (!file.isFile() || (file.mode & 0o777) !== 0o644) throw new Error("context candidate mode is not fixed regular 0644");
    }
    const headers = parseEmlHeaders(fs.readFileSync(mail.objectPath(plan.message.id), "utf8"));
    if (headers.omaContext !== plan.candidate) throw new Error("context EML candidate mismatch at acceptance");
    checkpoint();
  }
  if (point === "int-done" && operation?.kind === "git.integrate" && operation.state === "succeeded") checkpoint();
  if (point === "boot-intent" && (store.getOperation("principal", "bootstrap-child") || store.getOperation("a", "create-child"))) checkpoint();
  if (point === "boot-ready" && store.listAgents().some(agent => ["child", "peer"].includes(agent.name) && agent.desired === "enabled")) checkpoint();
  return result;
};
const auth: AuthContext = { actor: "a", incarnation: 1, role: "resident", channel: "trusted-runner", capabilities: new Set(["mail.send"]),
  peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), cgroup: null } };
const input: MailInput = { to: ["a", "b", "c"], subject: "crash", kind: "message", body: "immutable payload" };
if (point.startsWith("error-")) {
  let outcome: unknown;
  try { outcome = point.startsWith("error-recovery-") ? await mail.reconcilePending() : await mail.send(auth, "crash-send", input); }
  catch (error) { outcome = { code: error !== null && typeof error === "object" && "code" in error ? error.code : "UNKNOWN" }; }
  fs.writeFileSync(join(root, "failure.json"), JSON.stringify(outcome)); store.close(); process.exit(0);
}
if (rawPoint.startsWith("create-")) {
  if (!lifecycle) throw new Error("missing lifecycle fixture");
  await lifecycle.lifecycle.create(gitAuth, { name: "child", from: gitCommand(join(root, "seed"), ["rev-parse", "HEAD^"]), brief: "new child" }, "create-child");
} else if (point.startsWith("boot-")) {
  if (!lifecycle) throw new Error("missing lifecycle fixture");
  await lifecycle.lifecycle.bootstrap(lifecycle.config);
  for (const id of store.recoverableOperations()) await lifecycle.lifecycle.reconcileCreate(id, false);
} else if (point.startsWith("submit-")) await submitFixture(root, gitFixture(root, store).git);
else if (point.startsWith("int-")) {
  await gitFixture(root, store).git.integrate(gitAuth, "git-crash", { candidate: gitCommand(join(root, "seed"), ["rev-parse", "HEAD"]), expected: gitCommand(join(root, "seed"), ["rev-parse", "HEAD^"]) });
} else if (point.startsWith("ctx-")) await contextFixture(gitFixture(root, store).git);
else if (point === "copy") publishImmutableFile(fs.readFileSync(join(root, "source-path"), "utf8"), join(root, "destination"));
else if (point === "prepared" || point === "cur") await mail.prepare(auth);
else await mail.send(auth, "crash-send", input);
throw new Error(`checkpoint ${point} was not reached`);
