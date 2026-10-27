import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import type { Json, MutationMethod } from "@oma/contracts";
import { RequestCache } from "#oma-test/app/request-cache";
import { generateOperationId } from "@oma/native/identity";
import { FrameParser, encodeFrame } from "@oma/protocol/frame";
import { explicitFullOid, requestIntentConflict } from "#oma-test/app/cli/request-intent";
import { StoreError, publicFailure } from "@oma/domain/errors";

const oid = "a".repeat(40);
const otherOid = "b".repeat(40);
const cli = fileURLToPath(new URL("../../apps/oma/dist/cli.js", import.meta.url));

function invoke(home: string, args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: home, env: { ...process.env, HOME: home, OMA_SOCKET: join(home, "never.sock") },
    encoding: "utf8", timeout: 15_000,
  });
}

test("method is compared before projecting current arguments", () => {
  let called = false;
  const conflict = requestIntentConflict({
    expectedMethod: "route.unfollow",
    explicitParams: () => { called = true; throw new Error("must not read arguments"); },
  }, { method: "route.follow", params: { topic: "work" } });
  assert.equal(conflict, "method");
  assert.equal(called, false);
});

test("direct full OIDs compare while aliases contribute no invented provenance", () => {
  assert.deepEqual(explicitFullOid("from", oid), { from: oid });
  assert.deepEqual(explicitFullOid("candidate", "c".repeat(64)), { candidate: "c".repeat(64) });
  for (const alias of ["HEAD", "main", "v1", "HEAD~1", "a".repeat(12)])
    assert.deepEqual(explicitFullOid("from", alias), {});
  assert.equal(requestIntentConflict({
    expectedMethod: "agent.create", explicitParams: () => ({ name: "alice", ...explicitFullOid("from", otherOid) }),
  }, { method: "agent.create", params: { name: "alice", from: oid, brief: "frozen" } }), "from");
  assert.equal(requestIntentConflict({
    expectedMethod: "git.submit", explicitParams: () => ({ to: ["alice", "bob"], paths: ["a", "z", "a"] }),
  }, { method: "git.submit", params: { to: ["bob", "alice", "bob"], paths: ["z", "a"], candidate: oid } }), null);
});

test("actual CLI refuses another method/full OID before network, files or Git effects", () => {
  const cases: Array<{ method: MutationMethod; params: Json; args: string[] }> = [
    { method: "route.follow", params: { topic: "work" }, args: ["unfollow", "work"] },
    { method: "agent.start", params: { agent: "alice" }, args: ["agent", "stop", "alice"] },
    { method: "route.follow", params: { topic: "work" }, args: ["send", "bob", "--subject", "subject", "--file", "missing-source"] },
    { method: "agent.create", params: { name: "alice", from: oid, brief: "frozen" },
      args: ["agent", "create", "alice", "--from", otherOid, "--file", "missing-source"] },
    { method: "git.submit", params: {
      candidate: oid, exportRef: "refs/oma/export/example", prerequisites: [], to: ["commons"],
      subject: "Re: submit", body: "frozen", paths: [],
    }, args: ["submit", otherOid] },
  ];
  for (const entry of cases) {
    const home = mkdtempSync(join(tmpdir(), "oma-r06-conflict-"));
    try {
      const key = "r06-request";
      const cache = new RequestCache(home);
      cache.freeze({ key, method: entry.method, params: entry.params, createdAtMs: 1 });
      assert.equal(cache.read(key).kind, "present", "the control fixture must be valid");
      const cachePath = join(home, ".local/state/oma/requests", `${key}.json`);
      const before = readFileSync(cachePath);
      const output = invoke(home, [...entry.args, "--request", key]);
      assert.equal(output.error, undefined);
      assert.equal(output.status, 2, `${entry.method}: ${output.stderr}`);
      assert.match(output.stderr, /REQUEST_KEY_REUSED/);
      assert.deepEqual(readFileSync(cachePath), before);
    } finally { rmSync(home, { recursive: true, force: true }); }
  }
});

test("actual CLI cached create ignores missing brief and unresolvable HEAD while querying only its key", async t => {
  const home = mkdtempSync(join(tmpdir(), "oma-r06-replay-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const key = "r06-frozen";
  const cache = new RequestCache(home);
  cache.freeze({ key, method: "agent.create", params: { name: "alice", from: oid, brief: "frozen brief" }, createdAtMs: 1 });
  const receipt = {
    operation: generateOperationId(), state: "succeeded",
    result: { kind: "agent.create", agent: "alice", desired: "enabled", remainingOperations: [] },
  };
  cache.updateReceipt(key, receipt);
  const cachePath = join(home, ".local/state/oma/requests", `${key}.json`);
  const before = readFileSync(cachePath);
  const methods: unknown[] = [];
  const server = createServer(socket => {
    const parser = new FrameParser(256 * 1024);
    socket.on("error", () => {});
    socket.on("data", bytes => {
      assert.ok(Buffer.isBuffer(bytes), "fixture sockets must remain in byte mode");
      for (const frame of parser.feed(bytes)) {
        methods.push(frame.raw.method);
        assert.equal(frame.raw.method, "operation.get");
        assert.deepEqual(frame.raw.params, { key });
        socket.end(encodeFrame({ v: 1, id: frame.raw.id, ok: true, result: receipt }));
      }
    });
  });
  t.after(() => { server.close(); });
  const socketPath = join(home, "broker.sock");
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(socketPath, resolve); });
  const child = spawn(process.execPath, [cli, "agent", "create", "alice", "--from", "HEAD", "--file", "deleted-brief", "--request", key], {
    cwd: home, env: { ...process.env, HOME: home, OMA_SOCKET: socketPath }, stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => { child.kill(); });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", bytes => { stdout += String(bytes); });
  child.stderr.on("data", bytes => { stderr += String(bytes); });
  const status = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  assert.equal(status, 0, stderr);
  assert.equal(JSON.parse(stdout).state, "succeeded");
  assert.deepEqual(methods, ["operation.get"]);
  assert.deepEqual(readFileSync(cachePath), before);
});

test("actual CLI stops on corrupt metadata before source reads and wire sends", () => {
  const home = mkdtempSync(join(tmpdir(), "oma-r07-stop-"));
  try {
    const cache = new RequestCache(home);
    const key = "corrupt-create";
    cache.freeze({ key, method: "agent.create", params: { name: "alice", from: oid, brief: "frozen" }, createdAtMs: 1 });
    const path = join(home, ".local/state/oma/requests", `${key}.json`);
    writeFileSync(path, '{"key":');
    const corrupt = invoke(home, ["agent", "create", "alice", "--from", "HEAD", "--file", "deleted", "--request", key]);
    assert.equal(corrupt.status, 3, corrupt.stderr);
    assert.match(corrupt.stderr, /CACHE_CORRUPT/);
    assert.doesNotMatch(corrupt.stderr, /cannot resolve|file not found|broker unreachable/);
    assert.equal(readFileSync(path, "utf8"), '{"key":');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("P0V-38 / N15: a missing frozen body does not stop the lookup, and without it nothing is resent or rebuilt from source", async t => {
  const home = mkdtempSync(join(tmpdir(), "oma-r07-body-"));
  t.after(() => { rmSync(home, { recursive: true, force: true }); });
  const cache = new RequestCache(home);
  const sha256 = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
  cache.freeze({
    key: "body-missing", method: "context.publish", createdAtMs: 1,
    params: { expected: null, entries: [{ path: "GOAL.md", bytes: 5, sha256 }], content: { bytes: 5, sha256, mediaType: "application/vnd.oma.context-v1" } },
    digest: { bytes: 5, sha256 },
  }, Buffer.from("hello"));
  unlinkSync(cache.bodyPath("body-missing"));
  // The ledger has no such request: the only thing left would be a resend,
  // and that needs the frozen body, which is gone.
  const methods: unknown[] = [];
  const server = createServer(socket => {
    const parser = new FrameParser(256 * 1024);
    socket.on("error", () => {});
    socket.on("data", (bytes: Buffer) => {
      for (const frame of parser.feed(bytes)) {
        methods.push(frame.raw.method);
        socket.end(encodeFrame({ v: 1, id: frame.raw.id, ok: false, error: publicFailure(new StoreError("REQUEST_NOT_FOUND", "no such request")) }));
      }
    });
  });
  t.after(() => { server.close(); });
  const socketPath = join(home, "broker.sock");
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(socketPath, resolve); });
  const child = spawn(process.execPath, [cli, "context", "publish", "deleted-directory", "--expect", "none", "--request", "body-missing"], {
    cwd: home, env: { ...process.env, HOME: home, OMA_SOCKET: socketPath }, stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => { child.kill(); });
  let stderr = "";
  child.stderr.on("data", bytes => { stderr += String(bytes); });
  const status = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  assert.equal(status, 3, stderr);
  assert.match(stderr, /body absent/);
  assert.doesNotMatch(stderr, /not a directory/);
  assert.deepEqual(methods, ["operation.get"], "the request was sent again without its frozen body");
});

test("a CLI with no HOME names it; receipts are never cached in shared /tmp", () => {
  // A process-global guess of /tmp for the request cache wrote a caller's
  // receipts into shared space. With no HOME at all the request names that
  // instead of placing ~/.local/state/oma/requests under /tmp.
  const root = mkdtempSync(join(tmpdir(), "oma-cli-nohome-"));
  // Where the guess would have written: the shared /tmp the fallback named.
  // The assertion is that nothing new lands there, whatever a previous run
  // left behind.
  const sharedCache = "/tmp/.local/state/oma/requests";
  const before = existsSync(sharedCache) ? readdirSync(sharedCache).sort() : null;
  try {
    const env: Record<string, string | undefined> = { ...process.env, OMA_SOCKET: join(root, "never.sock") };
    delete env.HOME; delete env.XDG_DATA_HOME; delete env.XDG_STATE_HOME;
    const result = spawnSync(process.execPath, [cli, "unfollow", "work"], { cwd: root, env, encoding: "utf8", timeout: 15_000 });
    assert.equal(result.status, 4, JSON.stringify({ stdout: result.stdout, stderr: result.stderr }));
    assert.match(result.stderr, /oma: HOME is not set; the request cache has no root/);
    const after = existsSync(sharedCache) ? readdirSync(sharedCache).sort() : null;
    assert.deepEqual(after, before, "no request cache was written to shared space");
  } finally {
    if (before === null) rmSync("/tmp/.local", { recursive: true, force: true });
    else for (const name of readdirSync(sharedCache).filter(name => !before.includes(name))) rmSync(join(sharedCache, name), { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
