import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readlinkSync, lstatSync, rmSync, readdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { Store } from "../src/store.js";
import { MailModule } from "../src/mail.js";
import { GitModule } from "../src/git.js";
import type { AuthContext } from "../implementation/contracts.js";
import type { ContextInput } from "../src/git/context.js";
import { makeValidAgent } from "./fixtures/spec.js";

const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const auth: AuthContext = { actor: "alice", incarnation: 1, role: "resident", channel: "actor", capabilities: new Set(["context.publish"]),
  peer: { pid: process.pid, uid: process.getuid!(), gid: process.getgid!(), cgroup: null } };
async function* once(bytes: Uint8Array): AsyncIterable<Uint8Array> { yield bytes; }
function input(text: string, expected: string | null): { request: ContextInput; bytes: Buffer } {
  const bytes = Buffer.from(text);
  return { bytes, request: { expected, entries: [{ path: "GOAL.md", bytes: bytes.length, sha256: digest(bytes) }],
    content: { bytes: bytes.length, sha256: digest(bytes), mediaType: "application/vnd.oma.context-v1" } } };
}
function cleanup(root: string): void {
  const walk = (path: string): void => {
    const stat = lstatSync(path);
    if (!stat.isDirectory()) return;
    chmodSync(path, 0o700);
    for (const name of readdirSync(path)) walk(join(path, name));
  };
  walk(root); rmSync(root, { recursive: true, force: true });
}
function fixture(format: "sha1" | "sha256") {
  const root = mkdtempSync(join(tmpdir(), "oma-r21-context-"));
  const contextGit = join(root, "repos/context.git");
  mkdirSync(join(root, "repos"));
  const env = { ...process.env, HOME: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
  const command = (args: string[], overrides: NodeJS.ProcessEnv = {}): string => {
    const result = spawnSync("/usr/bin/git", args, { env: { ...env, ...overrides }, timeout: 10000, maxBuffer: 1024 * 1024, killSignal: "SIGKILL", encoding: "utf8" });
    assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  command(["init", "--bare", `--object-format=${format}`, contextGit]);
  const store = new Store(join(root, "runtime.sqlite"));
  store.transaction(tx => { tx.insertAgent(makeValidAgent("alice")); tx.insertAgent(makeValidAgent("bob", { desired: "stopped" })); });
  const mail = new MailModule({ stateRoot: root, society: "demo" }, store, 64);
  const git = new GitModule({ stateRoot: root, projectGit: join(root, "repos/project.git"), contextGit,
    worldDir: join(root, "world"), society: "demo", quarantineTmpBytes: 1024, checkTimeoutSeconds: 30 }, store, mail, null);
  return { root, store, mail, git, command, contextGit, close() { store.close(); cleanup(root); } };
}

for (const format of ["sha1", "sha256"] as const) {
  test(`R21 ${format}: acceptance precedes no activation and holds the exact canonical candidate`, async () => {
    const f = fixture(format);
    try {
      assert.equal(f.git.hasCommittedContext(), false);
      const publish = f.mail.publishGated.bind(f.mail);
      let checked = false;
      f.mail.publishGated = async (id, proof) => {
        assert.ok(proof, "the real context facade must supply a new canonical observation");
        const operation = f.store.getOperationById(id);
        assert.ok(operation?.kind === "context.publish");
        assert.equal(operation.state, "pending");
        assert.equal(f.command(["--git-dir", f.contextGit, "rev-parse", "refs/heads/main"]), operation.plan.candidate);
        assert.equal(f.command(["--git-dir", f.contextGit, "cat-file", "-t", operation.plan.candidate]), "commit");
        assert.equal(f.git.hasCommittedContext(), false, "current link and C alone must not activate the first GOAL");
        assert.equal(readlinkSync(join(f.root, "world/context/current")), `revisions/${operation.plan.candidate}`);
        checked = true;
        await publish(id, proof);
      };
      const first = input("# first 한글 GOAL\r\n", null);
      const receipt = await f.git.publishContext(auth, "first", first.request, once(first.bytes));
      assert.equal(checked, true); assert.equal(receipt.state, "succeeded");
      assert.equal(f.git.hasCommittedContext(), true);
      assert.equal(f.store.getAgent("bob")?.desired, "stopped", "context publication never enables a stopped resident");
      const operation = f.store.getOperationById(receipt.operation);
      assert.ok(operation?.kind === "context.publish");
      assert.equal(operation.plan.candidate.length, format === "sha1" ? 40 : 64);
      assert.equal(lstatSync(join(operation.plan.stagingPath, "commit-work/GOAL.md")).mode & 0o777, 0o644);
      assert.equal(lstatSync(join(f.root, `world/context/revisions/${operation.plan.candidate}/GOAL.md`)).mode & 0o777, 0o644);
      assert.deepEqual(readFileSync(f.mail.archivePath(operation.plan.message.id)), readFileSync(f.mail.objectPath(operation.plan.message.id)));
      assert.throws(() => f.store.transaction(() => f.git.hasCommittedContext()), { code: "INTERNAL_ERROR" }, "activation proof must not perform I/O inside a transaction");
    } finally { f.close(); }
  });

  test(`R21 ${format}: lost notification blocks the next writer and recovers C without recreating a commit`, async () => {
    const f = fixture(format);
    try {
      const publish = f.mail.publishGated.bind(f.mail);
      f.mail.publishGated = async () => { throw new Error("injected loss before notification"); };
      const first = input("# frozen candidate\n", null);
      await assert.rejects(f.git.publishContext(auth, "first", first.request, once(first.bytes)));
      const accepted = f.store.getOperation("alice", "first");
      assert.ok(accepted?.kind === "context.publish");
      assert.equal(accepted.state, "unknown");
      const candidate = accepted.plan.candidate;
      const canonical = f.command(["--git-dir", f.contextGit, "cat-file", "-p", candidate]);
      assert.equal(f.git.hasCommittedContext(), false);
      const next = input("# must not run\n", candidate);
      let reads = 0;
      async function* counted(): AsyncIterable<Uint8Array> { reads++; yield next.bytes; }
      await assert.rejects(f.git.publishContext(auth, "next", next.request, counted()), { code: "REF_STATE_UNKNOWN" });
      assert.equal(reads, 0); assert.equal(f.store.getOperation("alice", "next"), null);
      const work = join(accepted.plan.stagingPath, "commit-work");
      rmSync(work, { recursive: true });
      const originalMethod = Reflect.get(f.git, "prepareContextCandidate");
      assert.equal(typeof originalMethod, "function");
      Object.defineProperty(f.git, "prepareContextCandidate", { configurable: true, value: () => assert.fail("recovery must not prepare another candidate") });
      f.mail.publishGated = publish;
      await f.git.reconcile(accepted.id);
      Reflect.deleteProperty(f.git, "prepareContextCandidate");
      const settled = f.store.getOperationById(accepted.id);
      assert.ok(settled?.kind === "context.publish");
      assert.equal(settled.state, "succeeded"); assert.equal(settled.planJson, accepted.planJson);
      assert.equal(f.command(["--git-dir", f.contextGit, "cat-file", "-p", candidate]), canonical);
      assert.deepEqual(readFileSync(join(work, "GOAL.md")), first.bytes);
      assert.equal(f.git.hasCommittedContext(), true);
      await f.git.reconcile(accepted.id);
      assert.equal(f.store.getOperationById(accepted.id)?.resultJson, settled.resultJson);
    } finally { f.close(); }
  });

  test(`R21 ${format}: candidate author, date, tree and parent retain the original porcelain identity`, async () => {
    const f = fixture(format);
    try {
      const first = input("# same immutable identity\n", null);
      const receipt = await f.git.publishContext(auth, "identity", first.request, once(first.bytes));
      const operation = f.store.getOperationById(receipt.operation);
      assert.ok(operation?.kind === "context.publish");
      const work = join(f.root, "independent-oracle"); mkdirSync(work);
      // Independent old-path porcelain oracle, not ContextRepository or its env.
      f.command(["-C", work, "init", "-q", `--object-format=${format}`]);
      writeFileSync(join(work, "GOAL.md"), first.bytes, { mode: 0o644 });
      f.command(["-C", work, "add", "-f", "-A"]);
      f.command(["-C", work, "-c", "core.hooksPath=/dev/null", "-c", "core.autocrlf=false", "commit", "-q", "--no-gpg-sign", "-m", "context"], {
        GIT_AUTHOR_NAME: "OMA", GIT_AUTHOR_EMAIL: "broker@oma.invalid", GIT_COMMITTER_NAME: "OMA", GIT_COMMITTER_EMAIL: "broker@oma.invalid",
        GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
      });
      assert.equal(operation.plan.candidate, f.command(["-C", work, "rev-parse", "HEAD"]));
      const second = input("# second full snapshot\n", operation.plan.candidate);
      const updated = await f.git.publishContext(auth, "second", second.request, once(second.bytes));
      const next = f.store.getOperationById(updated.operation);
      assert.ok(next?.kind === "context.publish");
      assert.equal(f.command(["--git-dir", f.contextGit, "rev-parse", `${next.plan.candidate}^`]), operation.plan.candidate);
      assert.equal(f.command(["--git-dir", f.contextGit, "show", `${next.plan.candidate}:GOAL.md`]), "# second full snapshot");
    } finally { f.close(); }
  });
}
