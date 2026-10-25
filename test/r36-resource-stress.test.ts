import { TransportSpool } from "@oma/storage/transport-spool";
import test from "node:test";
import assert from "node:assert/strict";
import { connect, createServer, Socket } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { constants, closeSync, mkdirSync, mkdtempSync, openSync, readdirSync, readlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RpcConnection } from "@oma/broker/connection";
import { SharedPeerPin } from "@oma/broker/peer-pin";
import { peerPidFd, pidfdLiveness } from "@oma/native/linux";
import { encodeFrame } from "@oma/protocol/frame";
import { sha256Hex } from "@oma/domain/canonical-json";
import { OperationRecovery, type RecoveryRow } from "@oma/reconcile/operations";
import { parseOperationId } from "@oma/domain/identifiers";
import { runProcess } from "@oma/process/run";
import { Seeded, integerParameter, replayMetadata, recordExplorationFailure } from "./model/reproducible.js";

const seed = integerParameter("OMA_TEST_SEED", 0x3657ee, 0xffffffff);
const cycles = integerParameter("OMA_TEST_STRESS_CYCLES", 64, 100000);
const seconds = integerParameter("OMA_TEST_STRESS_SECONDS", 60, 3600);
const rssBudget = integerParameter("OMA_TEST_RSS_BYTES", 3 * 1024 ** 3, Number.MAX_SAFE_INTEGER);
const limits = { frameBytes: 256 * 1024, idleStreamSeconds: 30, receiptWaitSeconds: 30 };
function fdSnapshot(): { total: number; pidfds: number; cgroupFds: number } {
  const entries = readdirSync("/proc/self/fd"); let pidfds = 0, cgroupFds = 0;
  for (const entry of entries) {
    let target: string;
    try { target = readlinkSync(`/proc/self/fd/${entry}`); }
    catch (error) { if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") continue; throw error; }
    if (target.includes("pidfd")) pidfds++;
    if (target.startsWith("/sys/fs/cgroup")) cgroupFds++;
  }
  return { total: entries.length, pidfds, cgroupFds };
}
async function waitFor(observed: () => boolean, deadline: number): Promise<void> {
  while (!observed()) { assert.ok(performance.now() < deadline, "STRESS_OBSERVATION_DEADLINE"); await delay(1); }
}

test(`R36 stress native transport seed=${seed} cycles=${cycles} durationBudgetSeconds=${seconds}`, { timeout: (seconds + 60) * 1000 }, async t => {
  assert.equal(process.platform, "linux", "native stress requires Linux, not a silent skip");
  assert.ok(cycles > 0 && seconds > 0 && rssBudget > 0, "stress requires explicit nonzero test budgets");
  const root = mkdtempSync(join(tmpdir(), "oma-r36-sockets-")), staging = join(root, "staging");
  mkdirSync(staging);
  const path = join(root, "rpc.sock"), server = createServer({ allowHalfOpen: true });
  const random = new Seeded(seed), cleanupErrors: unknown[] = [];
  const started = performance.now(), deadline = started + seconds * 1000;
  const metadata = replayMetadata(seed, { cycles, seconds, rssBudget, frameBytes: limits.frameBytes });
  let peakRss = process.memoryUsage().rss, peakFd = 0, peakQueue = 0, completed = 0;
  async function cycle(mode: number): Promise<void> {
    const accepted = once(server, "connection"), client = connect(path);
    client.on("error", () => {}); client.resume();
    const connected = (await accepted)[0];
    if (!(connected instanceof Socket)) { client.destroy(); throw new Error("native server did not return a socket"); }
    const peer = connected;
    const handle: unknown = Reflect.get(peer, "_handle");
    if (handle === null || typeof handle !== "object" || !("fd" in handle) || typeof handle.fd !== "number") {
      client.destroy(); peer.destroy(); throw new Error("native socket FD unavailable");
    }
    const native = peerPidFd(handle.fd);
    if (native === null) { client.destroy(); peer.destroy(); throw new Error("native SO_PEERPIDFD is required; no PID-only fallback"); }
    const owner = new SharedPeerPin(() => pidfdLiveness(native).kind === "running", () => closeSync(native));
    let groupFd: number;
    try { groupFd = openSync("/sys/fs/cgroup", constants.O_RDONLY | constants.O_DIRECTORY); }
    catch (error) { owner.releaseConnection(); client.destroy(); peer.destroy(); throw error; }
    // Node's own net.Socket owns an internal "end" listener on this runtime, so
    // the oracle compares against the accepted socket's baseline instead of zero.
    const baselineListeners = { data: peer.listenerCount("data"), end: peer.listenerCount("end"), drain: peer.listenerCount("drain") };
    const tasks: Promise<void>[] = []; let calls = 0;
    const clientClosed = new Promise<void>(resolve => client.once("close", () => resolve()));
    const peerClosed = new Promise<void>(resolve => peer.once("close", () => resolve()));
    const connection = new RpcConnection({ socket: peer, peer: owner, limits, makeSpool: descriptor => new TransportSpool(staging, descriptor),
      preflight: raw => { assert.equal(raw.method, "context.publish"); },
      handle: async raw => { calls++; return { v: 1, id: raw.id, ok: true, result: {} }; },
      onTask: task => tasks.push(task), onCleanupError: error => cleanupErrors.push(error) });
    try {
      peakFd = Math.max(peakFd, fdSnapshot().total);
      if (mode === 0) {
        client.write(Buffer.from([0, 0]));
        await waitFor(() => connection.snapshot().bufferedBytes === 2, deadline);
        client.destroy();
      } else if (mode === 1) {
        const body = Buffer.from("abcdefgh");
        const frame = encodeFrame({ v: 1, id: "partial", method: "context.publish", request: "stress-partial",
          params: { content: { bytes: body.length, sha256: sha256Hex(body), mediaType: "application/vnd.oma.context-v1" } } });
        client.write(Buffer.concat([frame, body.subarray(0, 2)]));
        await waitFor(() => connection.snapshot().phase === "receivingStream", deadline);
        assert.ok(readdirSync(staging).length > 0, "partial body actually reached the owned spool");
        client.destroy();
      } else client.end(encodeFrame({ v: 1, id: "read", method: "status.get", params: {} }));
      peakQueue = Math.max(peakQueue, connection.snapshot().bufferedBytes);
      assert.ok(connection.snapshot().bufferedBytes <= limits.frameBytes + 4);
      await waitFor(() => connection.snapshot().phase === "closed", deadline);
      await Promise.all([clientClosed, peerClosed, ...tasks]);
      connection.close(); connection.close();
      assert.equal(owner.alive(), false); assert.equal(calls, mode === 2 ? 1 : 0);
      for (const event of ["data", "end", "drain"] as const)
        assert.equal(peer.listenerCount(event), baselineListeners[event], `RPC_LISTENER_LEAK:${event}`);
      assert.deepEqual(readdirSync(staging), [], "PREACCEPT_SPOOL_LEAK");
      assert.deepEqual(cleanupErrors, []);
    } finally {
      connection.close(); client.destroy(); peer.destroy(); owner.releaseConnection(); closeSync(groupFd);
      await Promise.all([clientClosed, peerClosed, ...tasks]);
    }
  }
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(path, resolve); });
    // Warm the actual native binding and event-loop handles before taking baseline.
    await cycle(2);
    const baseline = fdSnapshot(), baselineListeners = server.eventNames().map(event => [String(event), server.listenerCount(event)]);
    for (let index = 0; index < cycles; index++) {
      assert.ok(performance.now() < deadline, "STRESS_DURATION_BUDGET");
      await cycle(random.index(3)); completed++;
      assert.deepEqual(fdSnapshot(), baseline, "FD_BASELINE_NOT_RESTORED");
      assert.deepEqual(server.eventNames().map(event => [String(event), server.listenerCount(event)]), baselineListeners);
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
      assert.ok(peakRss <= rssBudget, "configured test RSS ceiling exceeded; not a kernel quota claim");
    }
    t.diagnostic(JSON.stringify({ ...metadata, durationMs: performance.now() - started, completed, baseline, peakFd, peakQueue, peakRss, failures: 0,
      proof: "native socket/pidfd/cgroup descriptor cleanup; no systemd stop or quota attestation" }));
  } catch (error) {
    t.diagnostic(`replay artifact: ${recordExplorationFailure("stress", { ...metadata, completed, durationMs: performance.now() - started, peakFd, peakQueue, peakRss, failures: 1 })}`);
    throw error;
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    server.removeAllListeners(); rmSync(root, { recursive: true, force: true });
  }
});

test("R36 stress bounded executor timeout drains owned pipes without asserting descendant death", { timeout: 90000 }, async () => {
  assert.equal(process.platform, "linux");
  const timeoutMs = integerParameter("OMA_TEST_COMMAND_TIMEOUT_MS", 100, 10000);
  assert.ok(timeoutMs > 0);
  const warmup = await runProcess({ executable: process.execPath, argv: ["-e", "process.exit(0)"], env: {}, timeoutMs: 10000, stdoutBytes: 4096, stderrBytes: 4096 });
  assert.equal(warmup.kind, "exited");
  for (let cycle = 0; cycle < 8; cycle++) {
    const before = fdSnapshot();
    const result = await runProcess({ executable: process.execPath, argv: ["-e", "setInterval(()=>{},1000)"], env: {},
      timeoutMs, stdoutBytes: 4096, stderrBytes: 4096 });
    assert.equal(result.kind, "timed-out");
    assert.deepEqual(fdSnapshot(), before, "settled command retained a pipe or child handle");
  }
});

test("R36 stress no-progress recovery coalesces callers and respects the existing receipt backoff", async () => {
  let now = 0, attempts = 0;
  const row: RecoveryRow = { id: parseOperationId("op-00000000-0000-4000-8000-000000000001")!,
    kind: "mail.send", state: "unknown" };
  const recovery = new OperationRecovery({ snapshot: () => [row.id], read: () => row,
    recover: async () => { attempts++; }, failure: error => { throw error; }, clock: () => now, budgetSeconds: limits.receiptWaitSeconds });
  for (let cycle = 0; cycle < 64; cycle++) {
    const first = recovery.sweep();
    assert.equal(recovery.sweep(), first, "concurrent sweep must reuse exactly one task");
    const result = await first;
    assert.deepEqual(result, cycle === 0 ? { examined: 1, repaired: 0, remaining: 1 } : { examined: 0, repaired: 0, remaining: 0 });
    assert.equal(recovery.running, false);
    assert.ok(recovery.lastOutcomes.length <= 1);
  }
  assert.equal(attempts, 1);
  now += limits.receiptWaitSeconds * 1000;
  await recovery.sweep(); assert.equal(attempts, 2);
});
