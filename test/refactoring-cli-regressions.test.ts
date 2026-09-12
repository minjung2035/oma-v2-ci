// R01 regression oracles. NOT_RUN when authored; these are not historical PASS evidence.
// The CLI process is real. The socket peer below is a protocol fixture, NOT a broker/kernel E2E.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createServer, type Socket } from "node:net";
import { loadConfig } from "../src/config.js";
import { StoreError } from "../src/store.js";
import { RequestCache, type CachedRequest } from "../src/request-cache.js";
import { encodeFrame } from "../src/frame.js";
import type { Receipt } from "../implementation/contracts.js";

const CLI = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const WORKER = fileURLToPath(new URL("./fixtures/lineage-regression.js", import.meta.url));
const OP = "op-00000000-0000-4000-8000-000000000091";
const succeeded: Receipt = { operation: OP, state: "succeeded", result: { kind: "route.follow", topic: "dev", subscribed: true } };
const temp = (): string => mkdtempSync(join(tmpdir(), "oma-r01-cli-"));
const digest = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

function validConfig() {
  const resources = { memoryBytes: 1024, tasks: 1, cpuQuotaPercent: 1, tmpBytes: 1024,
    workspaceBytes: 1024, stagingBytes: 1024, checkTimeoutSeconds: 1 };
  return {
    schemaVersion: 1, society: "demo",
    installation: { node: "/usr/bin/node", libdir: "/usr/lib/oma", rootfs: "/srv/rootfs", deploymentDigest: "d" },
    modelProfiles: { m: { provider: "p", model: "m", credentialRef: "c", codecRevision: "c1", pricingRevision: "p1",
      maxInputTokens: 1, maxOutputTokens: 1, inferenceTimeoutSeconds: 1 } },
    agentProfiles: { p: { modelProfile: "m", capabilities: ["mail.send"], delegable: [], childProfile: null, resources } },
    principalProfile: "p", initialResidents: [{ name: "alice", profile: "p", brief: "work" }],
    quota: { societyAgents: 10, lineageAgents: 10, societyUnits: 10, lineageUnits: 10, principalReservedUnits: 1,
      inferenceSlots: 2, principalReservedSlots: 1, storageBytes: 1024 },
    integration: { policyRevision: "p1", protectedPaths: [], checks: [] },
    limits: { frameBytes: 1024, mailBodyBytes: 1024, subjectBytes: 128, addresses: 10, replyReferences: 10,
      contextFiles: 10, contextBytes: 1024, bundleBytes: 1024, logBytes: 1024, batchMaxMessages: 10,
      idleStreamSeconds: 1, receiptWaitSeconds: 1 },
    features: { notmuch: false, reflinkSeed: false, formalApproval: false, egress: false },
  };
}

function run(home: string, args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, HOME: home, OMA_SOCKET: join(home, "absent.sock") },
    encoding: "utf8", timeout: 5000,
  });
}

function frozen(home: string, method: string, params: CachedRequest["params"], receipt: Receipt = succeeded): RequestCache {
  const cache = new RequestCache(home);
  cache.write({ key: "same-key", method, params, createdAtMs: 1, lastReceipt: receipt });
  return cache;
}

async function withPeer(
  home: string, args: string[], receipt: Receipt,
): Promise<{ code: number | null; stdout: string; stderr: string; methods: string[]; params: Record<string, unknown>[] }> {
  const methods: string[] = [];
  const params: Record<string, unknown>[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let pending = Buffer.alloc(0);
    let answered = false;
    socket.on("data", (chunk) => {
      if (answered) return;
      try {
        pending = Buffer.concat([pending, chunk]);
        if (pending.length < 4) return;
        const length = pending.readUInt32BE(0);
        if (length > 256 * 1024) throw new Error("fixture metadata exceeds bound");
        if (pending.length < 4 + length) return;
        // Parse exactly one metadata frame. Any following bytes are the raw upload,
        // not a second frame. This fixture does not reuse the production parser as its oracle.
        const request = JSON.parse(pending.subarray(4, 4 + length).toString("utf8")) as {
          id: string; method: string; params: Record<string, unknown>;
        };
        answered = true;
        methods.push(request.method);
        params.push(request.params);
        socket.end(encodeFrame({ v: 1, id: request.id, ok: true, result: receipt }));
      } catch (error) { socket.destroy(error as Error); }
    });
    socket.on("error", () => undefined);
  });
  const socketPath = join(home, "peer.sock");
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  try {
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [CLI, ...args], {
        cwd: home, env: { ...process.env, HOME: home, OMA_SOCKET: socketPath }, stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("CLI fixture timed out")); }, 10000);
      child.stdout.on("data", (bytes) => { stdout += bytes.toString(); });
      child.stderr.on("data", (bytes) => { stderr += bytes.toString(); });
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    });
    return { ...result, methods, params };
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("R01 CFG-005: valid config succeeds; one duplicate initialResident is rejected", () => {
  const home = temp();
  try {
    const path = join(home, "config.json");
    const config = validConfig();
    writeFileSync(path, JSON.stringify(config));
    assert.equal(loadConfig(path).initialResidents.length, 1);
    config.initialResidents.push({ ...config.initialResidents[0]! });
    writeFileSync(path, JSON.stringify(config));
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
  test(`R01 IPC-006: real CLI ${first.join(" ")} cannot replay as ${second.join(" ")}`, () => {
    const home = temp();
    try {
      frozen(home, method, params, { operation: OP, state: "succeeded", result: result as NonNullable<Receipt["result"]> });
      const positive = run(home, [...first, "--request", "same-key"]);
      assert.equal(positive.status, 0, positive.stderr);
      const negative = run(home, [...second, "--request", "same-key"]);
      assert.equal(negative.status, 2, negative.stderr);
      assert.match(negative.stderr, /REQUEST_KEY_REUSED/);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
}

test("R01 IPC-005: recipient order and duplicates do not change request identity", () => {
  const home = temp();
  try {
    frozen(home, "mail.send", { to: ["alice", "bob"], subject: "hello", kind: "message", body: "frozen" }, {
      operation: OP, state: "succeeded", result: { kind: "mail.send", message: "m-00000000-0000-4000-8000-000000000091-0", recipientCount: 2 },
    });
    const same = run(home, ["send", "alice", "bob", "--subject", "hello", "--request", "same-key"]);
    assert.equal(same.status, 0, same.stderr);
    const reordered = run(home, ["send", "bob", "alice", "alice", "--subject", "hello", "--request", "same-key"]);
    assert.equal(reordered.status, 0, reordered.stderr);
    const changed = run(home, ["send", "alice", "--subject", "hello", "--request", "same-key"]);
    assert.equal(changed.status, 2, changed.stderr);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("R01 IPC-008: missing frozen body is not an empty body or successful cached request", () => {
  const home = temp();
  try {
    const bytes = Buffer.from("# GOAL\nhello\n");
    const cache = new RequestCache(home);
    const hash = digest(bytes);
    cache.persistBody("same-key", bytes);
    cache.write({ key: "same-key", method: "context.publish", params: {
      expected: null, entries: [{ path: "GOAL.md", bytes: bytes.length, sha256: hash }],
      content: { bytes: bytes.length, sha256: hash, mediaType: "application/vnd.oma.context-v1" },
    }, digest: { bytes: bytes.length, sha256: hash }, createdAtMs: 1, lastReceipt: {
      operation: OP, state: "succeeded", result: { kind: "context.publish", previous: null, revision: "1".repeat(40),
        message: "m-00000000-0000-4000-8000-000000000091-0", recipientCount: 0 },
    } });
    const args = ["context", "publish", "/not-read-on-replay", "--expect", "none", "--request", "same-key"];
    assert.equal(run(home, args).status, 0);
    unlinkSync(cache.bodyPath("same-key"));
    const result = run(home, args);
    assert.equal(result.status, 3, result.stderr);
    assert.match(result.stderr, /body|본문|복구/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

for (const [state, expectedExit, extra] of [
  ["pending", 0, {}],
  ["unknown", 3, { reason: "physical effect uncertain" }],
  ["failed", 2, { error: { code: "CHECK_FAILED", message: "check failed", retry: "never" } }],
] as const) {
  test(`R01 CLI-003: accepted ${state} receipt has exit ${expectedExit} and is never resent`, async () => {
    const home = temp();
    try {
      const cache = new RequestCache(home);
      cache.write({ key: "same-key", method: "route.follow", params: { topic: "dev" }, createdAtMs: 1, lastReceipt: null });
      const receipt = { operation: OP, state, ...extra } as Receipt;
      const result = await withPeer(home, ["follow", "dev", "--request", "same-key"], receipt);
      assert.equal(result.code, expectedExit, result.stderr);
      assert.deepEqual(result.methods, ["operation.get"], "an accepted terminal/uncertain receipt must not resend effects");
      if (state === "unknown") assert.match(result.stdout + result.stderr, /불명|unknown|미확정|확인/);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
}

test("R01 CLI-002: maximum 96-character request key derives a valid export ref", async () => {
  const home = temp();
  const key = "k".repeat(96);
  try {
    const git = (args: string[]): string => {
      const r = spawnSync("/usr/bin/git", args, { cwd: home, encoding: "utf8", timeout: 10000,
        env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    git(["init", "-q", "-b", "main"]);
    writeFileSync(join(home, "file.txt"), "content\n");
    git(["add", "file.txt"]);
    git(["-c", "user.name=R01", "-c", "user.email=r01@example.invalid", "commit", "-qm", "fixture"]);
    const candidate = git(["rev-parse", "HEAD"]);
    const receipt: Receipt = { operation: OP, state: "pending" };
    const result = await withPeer(home, ["submit", "HEAD", "--request", key], receipt);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(result.methods, ["git.submit"]);
    assert.equal(result.params[0]?.candidate, candidate);
    assert.match(String(result.params[0]?.exportRef), /^refs\/oma\/export\/[A-Za-z0-9._-]{1,96}$/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(join(tmpdir(), `oma-submit-${key}.bundle`), { force: true });
  }
});

test("R01 IPC-008: corrupt cached JSON is never indistinguishable from absence", () => {
  const home = temp();
  try {
    const cache = new RequestCache(home);
    assert.equal(cache.read("missing"), null);
    frozen(home, "route.follow", { topic: "dev" });
    assert.equal(cache.read("same-key")?.method, "route.follow");
    writeFileSync(join(home, ".local/state/oma/requests/same-key.json"), "{broken");
    assert.throws(() => cache.read("same-key"), /corrupt|invalid|cache/i);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
