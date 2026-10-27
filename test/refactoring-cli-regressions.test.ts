// R01 regression oracles. NOT_RUN when authored; these are not historical PASS evidence.
// The CLI process is real. The socket peer below is a protocol fixture, NOT a broker/kernel E2E.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createServer, type Socket } from "node:net";
import { loadConfig } from "@oma/config";
import { StoreError } from "@oma/domain/errors";
import { RequestCache, type CachedRequest } from "#oma-test/app/request-cache";
import { encodeFrame } from "@oma/protocol/frame";
import type { Receipt, MutationMethod } from "@oma/contracts";

const CLI = fileURLToPath(new URL("../../apps/oma/dist/cli.js", import.meta.url));
const WORKER = fileURLToPath(new URL("./fixtures/lineage-regression.js", import.meta.url));
const OP = "op-00000000-0000-4000-8000-000000000091";
const succeeded: Receipt = { operation: OP, state: "succeeded", result: { kind: "route.follow", topic: "dev", subscribed: true } };
const temp = (): string => mkdtempSync(join(tmpdir(), "oma-r01-cli-"));
const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function validConfig() {
  const resources = { memoryBytes: 1024, tasks: 1, cpuQuotaPercent: 1, stagingBytes: 1024, checkTimeoutSeconds: 1 };
  return {
    schemaVersion: 4, society: "demo",
    installation: { node: "/usr/bin/node", libdir: "/usr/lib/oma",  deploymentDigest: "a".repeat(64) },
    modelProfiles: { m: { provider: "p", model: "m", inferenceTimeoutSeconds: 1 } },
    agentProfiles: { p: { modelProfile: "m", capabilities: ["mail.send"], delegable: [], childProfile: null } },
    principalProfile: "p", initialResidents: [{ name: "alice", profile: "p", brief: "work" }],
    integration: { policyRevision: "p1", protectedPaths: [], checks: [] },
    // mailBodyBytes clears the AV-07 floor for subjectBytes=128 (a maximal
    // thread revision, mail/review-bounds.ts); the valid half of this test
    // needs a configuration validation can accept.
    limits: { frameBytes: 1024, mailBodyBytes: 4096, subjectBytes: 128, addresses: 10, replyReferences: 10,
        contextFiles: 10, contextBytes: 1024, bundleBytes: 1024, logBytes: 1024, batchMaxMessages: 10,
        idleStreamSeconds: 1, receiptWaitSeconds: 1 }
};
}
function run(home: string, args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: home, env: { ...process.env, HOME: home, OMA_SOCKET: join(home, "absent.sock") },
    encoding: "utf8", timeout: 5000,
  });
}
function frozen(home: string, method: MutationMethod, params: CachedRequest["params"], receipt: Receipt = succeeded): RequestCache {
  const cache = new RequestCache(home);
  cache.freeze({ key: "same-key", method, params, createdAtMs: 1 });
  cache.updateReceipt("same-key", receipt);
  return cache;
}
async function withPeer(home: string, args: string[], receipt: Receipt): Promise<{
  code: number | null; stdout: string; stderr: string; methods: string[]; params: Record<string, unknown>[];
}> {
  const methods: string[] = []; const params: Record<string, unknown>[] = [];
  const sockets = new Set<Socket>(); const errors: unknown[] = [];
  const server = createServer(socket => {
    sockets.add(socket); socket.on("close", () => sockets.delete(socket));
    let pending = Buffer.alloc(0); let answered = false;
    socket.on("data", chunk => {
      if (answered) return;
      try {
        assert.ok(Buffer.isBuffer(chunk), "fixture sockets stay in byte mode");
        pending = Buffer.concat([pending, chunk.subarray(0, Math.max(0, 256 * 1024 + 4 - pending.length))]);
        if (pending.length < 4) return;
        const length = pending.readUInt32BE(0);
        if (length > 256 * 1024) throw new Error("fixture metadata exceeds bound");
        if (pending.length < 4 + length) return;
        // Independent one-frame parser: no production request parser as oracle.
        const request: unknown = JSON.parse(pending.subarray(4, 4 + length).toString("utf8"));
        assert.ok(record(request)); assert.equal(typeof request.id, "string");
        assert.ok(typeof request.method === "string"); assert.ok(record(request.params));
        answered = true; methods.push(request.method); params.push(request.params);
        const result = request.method === "git.known" ? { hasCandidate: false, prerequisites: [] } : receipt;
        socket.end(encodeFrame({ v: 1, id: request.id, ok: true, result }));
      } catch (error) { errors.push(error); socket.destroy(); }
    });
    socket.on("error", error => errors.push(error));
  });
  const socketPath = join(home, "peer.sock");
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(socketPath, resolve); });
  try {
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(resolve => {
      const child = spawn(process.execPath, [CLI, ...args], {
        cwd: home, env: { ...process.env, HOME: home, OMA_SOCKET: socketPath }, stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = ""; let stderr = ""; let count = 0;
      const timer = setTimeout(() => { errors.push(new Error("CLI fixture timed out")); child.kill("SIGKILL"); }, 10000);
      const capture = (bytes: Buffer, out: boolean): void => {
        count += bytes.length;
        if (count > 1024 * 1024) { errors.push(new Error("CLI fixture output overflow")); child.kill("SIGKILL"); return; }
        if (out) stdout += bytes.toString(); else stderr += bytes.toString();
      };
      child.stdout.on("data", (bytes: Buffer) => capture(bytes, true));
      child.stderr.on("data", (bytes: Buffer) => capture(bytes, false));
      child.once("error", error => { errors.push(error); });
      child.once("close", code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    });
    assert.deepEqual(errors, [], "the protocol fixture must not conceal transport failures");
    return { ...result, methods, params };
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

test("R01 CFG-005: valid config succeeds; one duplicate initialResident is rejected", () => {
  const home = temp();
  try {
    const path = join(home, "config.json"); const config = validConfig();
    writeFileSync(path, JSON.stringify(config)); assert.equal(loadConfig(path).initialResidents.length, 1);
    config.initialResidents.push({ ...config.initialResidents[0]! }); writeFileSync(path, JSON.stringify(config));
    assert.throws(() => loadConfig(path), (error: unknown) => error instanceof StoreError && error.code === "INVALID_REQUEST");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("R01 ID-002: valid lineage finishes; a disconnected created_by cycle fails closed", () => {
  for (const mode of ["valid", "cycle"]) {
    const home = temp();
    try {
      const result = spawnSync(process.execPath, [WORKER, home, mode], { encoding: "utf8", timeout: 5000 });
      assert.equal(result.error, undefined, `ancestry must not hang: ${String(result.error)}`);
      assert.equal(result.status, mode === "cycle" ? 42 : 0, result.stderr);
      assert.equal(result.stdout.trim(), mode === "cycle" ? "STORE_CORRUPT" : "OK");
    } finally { rmSync(home, { recursive: true, force: true }); }
  }
});

for (const [first, second, method, params, result] of [
  [["follow", "dev"], ["unfollow", "dev"], "route.follow", { topic: "dev" }, { kind: "route.follow", topic: "dev", subscribed: true }],
  [["agent", "start", "alice"], ["agent", "stop", "alice"], "agent.start", { agent: "alice" },
    { kind: "agent.start", agent: "alice", desired: "enabled", remainingOperations: [] }],
] as const) {
  test(`R01 IPC-006: real CLI ${first.join(" ")} cannot replay as ${second.join(" ")}`, async () => {
    const home = temp();
    try {
      const receipt: Receipt = { operation: OP, state: "succeeded", result: result.kind === "agent.start"
        ? { ...result, remainingOperations: [...result.remainingOperations] } : { ...result } };
      frozen(home, method, params, receipt);
      const positive = await withPeer(home, [...first, "--request", "same-key"], receipt);
      assert.equal(positive.code, 0, positive.stderr); assert.deepEqual(positive.methods, ["operation.get"]);
      const negative = run(home, [...second, "--request", "same-key"]);
      assert.equal(negative.status, 2, negative.stderr); assert.match(negative.stderr, /REQUEST_KEY_REUSED/);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
}

test("R01 IPC-005: recipient order and duplicates do not change request identity", async () => {
  const home = temp();
  try {
    const receipt: Receipt = { operation: OP, state: "succeeded", result: {
      kind: "mail.send", message: "m-00000000-0000-4000-8000-000000000091-0", recipientCount: 2,
      archivePath: "/mail/archive/cur/m-00000000-0000-4000-8000-000000000091-0:2,",
    } };
    frozen(home, "mail.send", { to: ["alice", "bob"], subject: "hello", kind: "message", body: "frozen" }, receipt);
    const same = await withPeer(home, ["send", "alice", "bob", "--subject", "hello", "--request", "same-key"], receipt);
    assert.equal(same.code, 0, same.stderr); assert.deepEqual(same.methods, ["operation.get"]);
    const reordered = await withPeer(home, ["send", "bob", "alice", "alice", "--subject", "hello", "--request", "same-key"], receipt);
    assert.equal(reordered.code, 0, reordered.stderr); assert.deepEqual(reordered.methods, ["operation.get"]);
    const changed = run(home, ["send", "alice", "--subject", "hello", "--request", "same-key"]);
    assert.equal(changed.status, 2, changed.stderr);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("R01 IPC-008: missing frozen body is not an empty body or successful cached request", async () => {
  const home = temp();
  try {
    const bytes = Buffer.from("# GOAL\nhello\n"); const cache = new RequestCache(home); const hash = digest(bytes);
    const receipt: Receipt = { operation: OP, state: "succeeded", result: { kind: "context.publish", previous: null, revision: "1".repeat(40),
      message: "m-00000000-0000-4000-8000-000000000091-0", recipientCount: 0 } };
    cache.freeze({ key: "same-key", method: "context.publish", params: {
      expected: null, entries: [{ path: "GOAL.md", bytes: bytes.length, sha256: hash }],
      content: { bytes: bytes.length, sha256: hash, mediaType: "application/vnd.oma.context-v1" },
    }, digest: { bytes: bytes.length, sha256: hash }, createdAtMs: 1 }, bytes);
    cache.updateReceipt("same-key", receipt);
    const args = ["context", "publish", "/not-read-on-replay", "--expect", "none", "--request", "same-key"];
    const positive = await withPeer(home, args, receipt);
    assert.equal(positive.code, 0, positive.stderr); assert.deepEqual(positive.methods, ["operation.get"]);
    unlinkSync(cache.bodyPath("same-key")); const result = run(home, args);
    assert.equal(result.status, 3, result.stderr); assert.match(result.stderr, /body|본문|복구|Recovery/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

for (const [state, expectedExit, extra] of [
  ["pending", 0, {}], ["unknown", 3, {}],
  ["failed", 2, { error: { code: "CHECK_FAILED", message: "check failed", retry: "never" } }],
] as const) {
  test(`R01 CLI-003: accepted ${state} receipt has exit ${expectedExit} and is never resent`, async () => {
    const home = temp();
    try {
      const cache = new RequestCache(home);
      cache.freeze({ key: "same-key", method: "route.follow", params: { topic: "dev" }, createdAtMs: 1 });
      const receipt: Receipt = { operation: OP, state, ...extra };
      const result = await withPeer(home, ["follow", "dev", "--request", "same-key"], receipt);
      assert.equal(result.code, expectedExit, result.stderr);
      assert.deepEqual(result.methods, ["operation.get"], "an accepted terminal/uncertain receipt must not resend effects");
      if (state === "unknown") assert.match(result.stdout + result.stderr, /불명|unknown|미확정|확인/);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
}

test("R01 CLI-002: maximum 96-character request key derives a valid export ref", async () => {
  const home = temp(); const key = "k".repeat(96);
  try {
    const git = (args: string[]): string => {
      const r = spawnSync("/usr/bin/git", args, { cwd: home, encoding: "utf8", timeout: 10000,
        env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } });
      assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
    };
    git(["init", "-q", "-b", "main"]); writeFileSync(join(home, "file.txt"), "content\n"); git(["add", "file.txt"]);
    git(["-c", "user.name=R01", "-c", "user.email=r01@example.invalid", "commit", "-qm", "fixture"]);
    const candidate = git(["rev-parse", "HEAD"]); const receipt: Receipt = { operation: OP, state: "pending" };
    const result = await withPeer(home, ["submit", "HEAD", "--request", key], receipt);
    assert.equal(result.code, 0, result.stderr); assert.deepEqual(result.methods, ["git.known", "git.submit"]);
    assert.deepEqual(result.params[0], { candidate });
    assert.equal(result.params[1]?.candidate, candidate);
    assert.match(String(result.params[1]?.exportRef), /^refs\/oma\/export\/[A-Za-z0-9._-]{1,96}$/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("R01 IPC-008: corrupt cached JSON is never indistinguishable from absence", () => {
  const home = temp();
  try {
    const cache = new RequestCache(home); assert.equal(cache.read("missing").kind, "absent");
    frozen(home, "route.follow", { topic: "dev" }); const positive = cache.read("same-key");
    assert.ok(positive.kind === "present"); assert.equal(positive.value.method, "route.follow");
    const path = join(home, ".local/state/oma/requests/same-key.json"); writeFileSync(path, "{broken");
    const damaged = cache.read("same-key");
    assert.ok(damaged.kind === "corrupt", "malformed JSON must not be treated as a fresh request key");
    assert.match(damaged.reason, /JSON|invalid|malformed/i);
    assert.equal(readFileSync(path, "utf8"), "{broken", "observing corruption must not repair or remove evidence");
  } finally { rmSync(home, { recursive: true, force: true }); }
});
