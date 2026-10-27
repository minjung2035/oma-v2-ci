import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { generateOperationId } from "@oma/native/identity";
import { messageIdForOperation as generateMessageId } from "@oma/domain/derived";
import { RequestCache } from "#oma-test/app/request-cache";
import { sha256Hex } from "@oma/domain/canonical-json";
import { runCliWithPeer } from "./fixtures/cli-peer.js";

const git = (cwd: string, args: string[]) => execFileSync("/usr/bin/git", args, {
  cwd, encoding: "utf8", env: { ...process.env, HOME: cwd, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
}).trim();
const frame = async (request: Record<string, unknown>, result: unknown) => ({ v: 1, id: request.id, ok: true, result });
const succeeded = (result: unknown) => ({ operation: generateOperationId(), state: "succeeded", result });

for (const kind of ["merge", "challenge"] as const) {
  for (const interruption of ["pending", "unknown", "failed", "lookup-failure", "submit-failure", "unrecorded"] as const) {
    test(`NB-17: ${kind} ${interruption} guides the parent key and preserves intent across restart`, async t => {
      const home = mkdtempSync(join(tmpdir(), "oma-nb17-"));
      t.after(() => rmSync(home, { recursive: true, force: true }));
      git(home, ["init", "-q"]);
      git(home, ["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", "base", "--allow-empty"]);
      const base = git(home, ["rev-parse", "HEAD"]);
      git(home, ["update-ref", "refs/remotes/origin/main", base]);
      git(home, ["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", "candidate", "--allow-empty"]);
      const candidate = git(home, ["rev-parse", "HEAD"]);
      const file = join(home, "reason.md");
      writeFileSync(file, "original reason\n");
      const key = "original-open";
      const args = [kind, "open", "--tier", "LOW", "--title", "title", "--file", file, "--request", key,
        ...(kind === "challenge" ? ["--merge", "merge-abcd1234-0000-4000-8000-000000000000", "--candidate", "HEAD", "--base", "origin/main"] : [])];
      const submit = succeeded({ kind: "git.submit", candidate, publishedRef: `refs/oma/published/alice/${generateOperationId()}`,
        message: generateMessageId(generateOperationId(), 0), recipientCount: 1 });
      const first = await runCliWithPeer(home, home, args, async request => {
        if (request.method === "git.known") {
          if (interruption === "lookup-failure") return { v: 1, id: request.id, ok: false,
            error: { code: "REF_STATE_UNKNOWN", message: "lookup unavailable", retry: "same-key" } };
          return frame(request, { hasCandidate: false, prerequisites: [base] });
        }
        assert.equal(request.method, "git.submit");
        assert.equal(request.request, `${key}.submit`);
        if (interruption === "submit-failure") return { v: 1, id: request.id, ok: false,
          error: { code: "REF_STATE_UNKNOWN", message: "publication unknown", retry: "same-key" } };
        if (interruption === "unrecorded") {
          writeFileSync(join(home, ".local/state/oma/requests", `${key}.submit.json`), "broken");
          return frame(request, { operation: submit.operation, state: "pending" });
        }
        return frame(request, { operation: submit.operation, state: interruption,
          ...(interruption === "failed" ? { error: { code: "CHECK_FAILED", message: "CHECK_FAILED", retry: "never" } } : {}) });
      });
      assert.equal(first.status, interruption === "pending" ? 0 : interruption === "failed" ? 2 : 3, first.stderr);
      if (interruption === "failed") assert.match(first.stdout + first.stderr, /--request original-open\b/);
      else assert.match(first.stdout + first.stderr, /--request original-open with the same command/);
      assert.doesNotMatch(first.stdout + first.stderr, /--request original-open\.submit/);
      const cache = new RequestCache(home);
      const frozen = cache.read(key);
      assert.equal(frozen.kind, "present", "the parent must freeze before publication can interrupt it");
      if (frozen.kind !== "present") assert.fail("parent missing");
      const original = { kind: `${kind}.open`, tier: "LOW", title: "title", reason: "original reason\n", candidate, base,
        ...(kind === "challenge" ? { merge: "merge-abcd1234-0000-4000-8000-000000000000" } : {}) };
      assert.deepEqual(frozen.value.params, original);
      if (interruption === "failed" || interruption === "unrecorded") return;
      git(home, ["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", "moved", "--allow-empty"]);
      git(home, ["update-ref", "-d", "refs/remotes/origin/main"]);
      unlinkSync(file);
      const opened = succeeded({ kind: "attest.record", request: `${kind}-1234abcd-0000-4000-8000-000000000000`,
        messages: [generateMessageId(generateOperationId(), 0)], recipientCount: 1 });
      const retry = await runCliWithPeer(home, home, args, async request => {
        if (request.method === "operation.get") return frame(request,
          (request.params as { key: string }).key === key
            ? { operation: "", state: "failed", error: { code: "REQUEST_NOT_FOUND", message: "absent", retry: "same-key" } } : submit);
        if (request.method === "git.known") {
          assert.deepEqual(request.params, { candidate });
          return frame(request, { hasCandidate: false, prerequisites: [base] });
        }
        if (request.method === "git.submit") return frame(request, submit);
        assert.equal(request.method, "attest.record");
        assert.equal(request.request, key);
        assert.deepEqual(request.params, original);
        return frame(request, opened);
      });
      assert.equal(retry.status, 0, retry.stderr);
      assert.equal(retry.requests.filter(request => request.method === "attest.record").length, 1);
      const completed = await runCliWithPeer(home, home, args, request => frame(request, opened));
      assert.equal(completed.status, 0, completed.stderr);
      assert.deepEqual(completed.requests.map(request => request.method), ["operation.get"]);
    });
  }
}

for (const suffix of ["", ":2,", ":2,S", ".eml"]) {
  test(`NB-19: bare and path ack spelling ${JSON.stringify(suffix)} replay one message identity`, async t => {
    const home = mkdtempSync(join(tmpdir(), "oma-nb19-"));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const message = generateMessageId(generateOperationId(), 0);
    const result = succeeded({ kind: "mail.ack", message, acknowledged: true });
    const handle = async (request: Record<string, unknown>) => {
      if (request.method === "mail.ack") assert.deepEqual(request.params, { message });
      else assert.equal(request.method, "operation.get");
      return frame(request, result);
    };
    const first = await runCliWithPeer(home, home, ["ack", message + suffix, "--request", "ack-spelling"], handle);
    assert.equal(first.status, 0, first.stderr);
    const second = await runCliWithPeer(home, home, ["ack", join(home, "cur", message + suffix), "--request", "ack-spelling"], handle);
    assert.equal(second.status, 0, second.stderr);
    assert.deepEqual(second.requests.map(request => request.method), ["operation.get"]);
  });
}

test("NB-19: malformed filename and unsafe ordinal are not coerced to an ID", async t => {
  const home = mkdtempSync(join(tmpdir(), "oma-nb19-invalid-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const message = generateMessageId(generateOperationId(), 0);
  for (const value of [message + ".eml.extra", message + ":2,?", message.replace(/-0$/, "-9007199254740992")]) {
    const run = await runCliWithPeer(home, home, ["ack", value], async () => assert.fail("invalid IDs cannot send"));
    assert.equal(run.status, 2, run.stderr);
    assert.deepEqual(run.requests, []);
  }
});

for (const args of [
  ["agent", "--request", "position", "start", "alice"],
  ["agent", "--note", "continue", "continue", "--request", "position"],
  ["merge", "--request", "position", "review", "merge-abcd1234-0000-4000-8000-000000000000", "--file", "body.md"],
  ["challenge", "--file", "review", "cancel", "challenge-abcd1234-0000-4000-8000-000000000000", "--request", "position"],
  ["context", "--expect", "none", "publish", "context", "--request", "position"],
]) {
  test(`NB-28: options before subcommand retain value slots (${args[0]})`, async t => {
    const home = mkdtempSync(join(tmpdir(), "oma-nb28-position-"));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    const cache = new RequestCache(home);
    const sha256 = sha256Hex(Buffer.from("x"));
    const params = args[0] === "agent" ? args.includes("start") ? { agent: "alice" } : { note: "continue" }
      : args[0] === "context" ? { expected: null, entries: [{ path: "GOAL.md", bytes: 1, sha256 }],
        content: { bytes: 1, sha256, mediaType: "application/vnd.oma.context-v1" } }
      : { kind: args[0] === "merge" ? "review" : "cancel", name: `${args[0]}-abcd1234-0000-4000-8000-000000000000`,
        ...(args[0] === "merge" ? { body: "frozen" } : { reason: "frozen" }) };
    const method = args[0] === "agent" ? args.includes("start") ? "agent.start" : "agent.continue"
      : args[0] === "context" ? "context.publish" : "attest.record";
    const digest = args[0] === "context" ? { bytes: 1, sha256 } : undefined;
    cache.freeze({ key: "position", method, params, createdAtMs: 1, ...(digest ? { digest } : {}) }, digest ? Buffer.from("x") : undefined);
    const run = await runCliWithPeer(home, home, args, request => frame(request, { operation: generateOperationId(), state: "pending" }));
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(run.requests.map(request => request.method), ["operation.get"]);
  });
}

test("NB-28 decision guard: changed or missing source paths never reinterpret a frozen mail", async t => {
  const home = mkdtempSync(join(tmpdir(), "oma-nb28-frozen-mail-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const key = "frozen-mail", message = generateMessageId(generateOperationId(), 0);
  const params = { to: ["bob"], subject: "subject", kind: "message", body: "original", replyToMessage: message };
  new RequestCache(home).freeze({ key, method: "mail.send", params, createdAtMs: 1 });
  const path = join(home, ".local/state/oma/requests", `${key}.json`), before = readFileSync(path);
  const receipt = { operation: generateOperationId(), state: "pending" };
  const run = await runCliWithPeer(home, home, ["send", "bob", "--subject", "subject", "--file", "changed-body",
    "--reply", "deleted-reply", "--request", key], request => frame(request, receipt));
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(run.requests.map(request => request.method), ["operation.get"]);
  const after = new RequestCache(home).read(key);
  assert.equal(after.kind, "present");
  if (after.kind === "present") assert.deepEqual(after.value.params, params);
  assert.equal(JSON.parse(before.toString()).createdAtMs, 1);
});

for (const kind of ["merge", "challenge"] as const) {
  test(`NB-17: SIGKILL after ${kind} parent freeze resumes its exact intent`, async t => {
    const home = mkdtempSync(join(tmpdir(), "oma-nb17-kill-"));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    git(home, ["init", "-q"]);
    git(home, ["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", "base", "--allow-empty"]);
    const base = git(home, ["rev-parse", "HEAD"]);
    git(home, ["update-ref", "refs/remotes/origin/main", base]);
    git(home, ["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", "candidate", "--allow-empty"]);
    const candidate = git(home, ["rev-parse", "HEAD"]);
    const file = join(home, "reason.md"), key = "kill-parent";
    writeFileSync(file, "before kill\n");
    const args = [kind, "open", "--tier", "LOW", "--title", "kill", "--file", file, "--request", key,
      ...(kind === "challenge" ? ["--merge", "merge-abcd1234-0000-4000-8000-000000000000", "--candidate", "HEAD", "--base", "origin/main"] : [])];
    const preload = join(home, "kill.mjs");
    writeFileSync(preload, `import { RequestCache } from ${JSON.stringify(new URL(import.meta.resolve("#oma-test/app/request-cache")).href)};
      const freeze = RequestCache.prototype.freeze;
      RequestCache.prototype.freeze = function(input, body) {
        const result = freeze.call(this, input, body);
        if (input.key === ${JSON.stringify(key)}) process.kill(process.pid, 'SIGKILL');
        return result;
      };`);
    const killed = await runCliWithPeer(home, home, args, request => frame(request, { hasCandidate: true, prerequisites: [] }), preload);
    assert.equal(killed.signal, "SIGKILL");
    assert.deepEqual(killed.requests, [], "candidate publication cannot precede the durable parent freeze");
    const frozen = new RequestCache(home).read(key);
    assert.equal(frozen.kind, "present");
    if (frozen.kind !== "present") assert.fail("kill lost the parent freeze");
    assert.equal((frozen.value.params as { candidate: string }).candidate, candidate);
    git(home, ["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", "moved", "--allow-empty"]);
    git(home, ["update-ref", "-d", "refs/remotes/origin/main"]);
    unlinkSync(file);
    const resumed = await runCliWithPeer(home, home, args, request => {
      if (request.method === "operation.get") return frame(request, { operation: "", state: "failed",
        error: { code: "REQUEST_NOT_FOUND", message: "absent", retry: "same-key" } });
      if (request.method === "git.known") {
        assert.deepEqual(request.params, { candidate });
        return frame(request, { hasCandidate: true, prerequisites: [] });
      }
      assert.equal(request.method, "attest.record");
      assert.deepEqual(request.params, frozen.value.params);
      return frame(request, { operation: generateOperationId(), state: "pending" });
    });
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.deepEqual(resumed.requests.map(request => request.method), ["operation.get", "git.known", "attest.record"]);
  });
}

test("NB-17: concurrent same-key opens preserve one frozen parent identity", async t => {
  const home = mkdtempSync(join(tmpdir(), "oma-nb17-concurrent-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  git(home, ["init", "-q"]);
  git(home, ["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-qm", "base", "--allow-empty"]);
  const candidate = git(home, ["rev-parse", "HEAD"]);
  git(home, ["update-ref", "refs/remotes/origin/main", candidate]);
  const file = join(home, "reason.md"), preload = join(home, "home.mjs");
  writeFileSync(file, "one intent\n");
  writeFileSync(preload, `process.env.HOME=${JSON.stringify(home)};`);
  const receipt = succeeded({ kind: "attest.record", request: "merge-abcd1234-0000-4000-8000-000000000000",
    messages: [generateMessageId(generateOperationId(), 0)], recipientCount: 1 });
  const params = { kind: "merge.open", tier: "LOW", title: "same", reason: "one intent\n", candidate, base: candidate };
  let accepted = false;
  const handler = (request: Record<string, unknown>) => {
    if (request.method === "operation.get") return frame(request, accepted ? receipt
      : { operation: "", state: "failed", error: { code: "REQUEST_NOT_FOUND", message: "absent", retry: "same-key" } });
    if (request.method === "git.known") return frame(request, { hasCandidate: true, prerequisites: [] });
    assert.equal(request.method, "attest.record");
    assert.equal(request.request, "concurrent");
    assert.deepEqual(request.params, params);
    accepted = true;
    return frame(request, receipt);
  };
  const runs = await Promise.all(["one", "two"].map(name => {
    const runner = join(home, name); mkdirSync(runner);
    return runCliWithPeer(runner, home, ["merge", "open", "--tier", "LOW", "--title", "same", "--file", file,
      "--request", "concurrent"], handler, preload);
  }));
  for (const run of runs) assert.equal(run.status, 0, run.stderr);
  assert.equal(accepted, true);
  const frozen = new RequestCache(home).read("concurrent");
  assert.equal(frozen.kind, "present");
  if (frozen.kind === "present") {
    assert.deepEqual(frozen.value.params, params);
    assert.deepEqual(frozen.value.lastReceipt, receipt);
  }
});
