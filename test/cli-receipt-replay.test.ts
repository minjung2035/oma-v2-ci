import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type Server, type Socket } from "node:net";
import { execFile, spawn } from "node:child_process";
import { RequestCache } from "#oma-test/app/request-cache";
import { FrameParser, encodeFrame } from "@oma/protocol/frame";
import { receiptNotFound } from "@oma/protocol/receipts";

const cli = fileURLToPath(new URL("../../apps/oma/dist/cli.js", import.meta.url));
const operation = "op-12345678-1234-4234-8234-123456789abc";
const success = { operation, state: "succeeded", result: { kind: "route.follow", topic: "commons", subscribed: true } };
const notFound = { operation: "", state: "failed", error: { code: "REQUEST_NOT_FOUND", message: "absent", retry: "same-key" } };
interface Scenario {
  name: string;
  lookup: { ok: boolean; result?: unknown; error?: unknown };
  exit: number;
  resend: boolean;
  stdout?: RegExp;
}
const scenarios: Scenario[] = [
  { name: "pending is accepted but unfinished", lookup: { ok: true, result: { operation, state: "pending" } }, exit: 0, resend: false, stdout: /^Accepted \/ not yet complete\nQuery again: use --request / },
  { name: "unknown is not absence", lookup: { ok: true, result: { operation, state: "unknown" } }, exit: 3, resend: false, stdout: /^Outcome unknown:/ },
  { name: "terminal failed is not absence", lookup: { ok: true, result: { operation, state: "failed", error: { code: "CHECK_FAILED", message: "CHECK_FAILED", retry: "never" } } }, exit: 2, resend: false, stdout: /^Failed: CHECK_FAILED/ },
  { name: "success has no repeated physical effect", lookup: { ok: true, result: success }, exit: 0, resend: false, stdout: /"state":"succeeded"/ },
  { name: "SPIKE remains unsupported", lookup: { ok: true, result: { operation, state: "failed", error: { code: "SPIKE_UNRESOLVED", message: "SPIKE_UNRESOLVED", retry: "never" } } }, exit: 4, resend: false, stdout: /^Failed: SPIKE_UNRESOLVED/ },
  { name: "explicit not-found receipt permits frozen resend", lookup: { ok: true, result: notFound }, exit: 0, resend: true, stdout: /"state":"succeeded"/ },
  { name: "explicit not-found error permits frozen resend", lookup: { ok: false, error: notFound.error }, exit: 0, resend: true, stdout: /"state":"succeeded"/ },
  { name: "lookup unavailable is not absence", lookup: { ok: false, error: { code: "DB_BUSY", message: "DB_BUSY", retry: "same-key" } }, exit: 3, resend: false },
  { name: "malformed not-found error is not evidence", lookup: { ok: false, error: { ...notFound.error, injected: true } }, exit: 3, resend: false },
  { name: "null is not a receipt", lookup: { ok: true, result: null }, exit: 3, resend: false },
  { name: "an operation-id-bearing not-found failure is terminal", lookup: { ok: true, result: { ...notFound, operation } }, exit: 2, resend: false },
];

// Execution specification only. Tests and build are NOT_RUN in the editing environment.
test("actual CLI uses authoritative receipts without inventing resend permission", { timeout: 60_000 }, async t => {
  for (const scenario of scenarios) {
    await t.test(scenario.name, { timeout: 10_000 }, async sub => {
      const home = mkdtempSync(join(tmpdir(), "oma-r08-"));
      const key = "r08-frozen";
      const frozen = { key, method: "route.follow" as const, params: { topic: "commons" }, createdAtMs: 1 };
      const cache = new RequestCache(home);
      cache.freeze(frozen);
      assert.equal(cache.read(key).kind, "present", "invalid-cache exits must not satisfy a replay test");
      const metadata = join(home, ".local/state/oma/requests", `${key}.json`);
      const before = JSON.parse(readFileSync(metadata, "utf8"));
      const requests: Array<Record<string, unknown>> = [];
      const sockets = new Set<Socket>();
      const wireErrors: unknown[] = [];
      const server = createServer(socket => {
        sockets.add(socket);
        socket.once("close", () => sockets.delete(socket));
        socket.on("error", error => wireErrors.push(error));
        const parser = new FrameParser(256 * 1024);
        socket.on("data", bytes => {
          try {
            assert.ok(Buffer.isBuffer(bytes), "fixture sockets must remain in byte mode");
            for (const frame of parser.feed(bytes)) {
              requests.push(frame.raw);
              const response = frame.raw.method === "operation.get" ? scenario.lookup : { ok: true, result: success };
              socket.end(encodeFrame({ v: 1, id: frame.raw.id, ...response }));
            }
          } catch (error) { wireErrors.push(error); socket.destroy(); }
        });
      });
      sub.after(() => {
        for (const socket of sockets) socket.destroy();
        server.close();
        rmSync(home, { recursive: true, force: true });
      });
      const socketPath = join(home, "broker.sock");
      await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(socketPath, resolve); });
      const child = spawn(process.execPath, [cli, "follow", "commons", "--request", key], {
        cwd: home, env: { ...process.env, HOME: home, OMA_SOCKET: socketPath }, stdio: ["ignore", "pipe", "pipe"],
      });
      sub.after(() => { child.kill(); });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", bytes => { stdout += String(bytes); });
      child.stderr.on("data", bytes => { stderr += String(bytes); });
      const exit = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
      assert.equal(exit, scenario.exit, `${scenario.name}: ${stderr}`);
      if (scenario.stdout) assert.match(stdout, scenario.stdout);
      assert.deepEqual(wireErrors, []);
      assert.deepEqual(requests.map(request => request.method), scenario.resend ? ["operation.get", "route.follow"] : ["operation.get"]);
      assert.deepEqual(requests[0]?.params, { key });
      if (scenario.resend) {
        assert.deepEqual(requests[1]?.params, frozen.params);
        assert.equal(requests[1]?.request, key);
      }
      const after = JSON.parse(readFileSync(metadata, "utf8"));
      for (const field of ["key", "method", "params", "createdAtMs"])
        assert.deepEqual(after[field], before[field], `receipt update must preserve frozen ${field}`);
    });
  }
});

/* V26B (WP26): the same CLI and cache with `send`, whose frozen request
 * carries the message body. The peer is not a broker: CLI/cache evidence only. */
const OP = (n: number) => `op-00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const MESSAGE = (n: number) => `m-00000000-0000-4000-8000-${String(n).padStart(12, "0")}-0`;
const sent = (n: number) => ({ operation: OP(n), state: "succeeded",
  result: { kind: "mail.send", message: MESSAGE(n), recipientCount: 1, archivePath: `/state/mail/archive/cur/${MESSAGE(n)}` } });

interface Seen { method: string; key: string | undefined; params: Record<string, unknown> }
type Script = (request: Seen) => object | "drop";

/** One frame per connection, answered by the script or dropped unanswered. */
async function peer(home: string, script: Script): Promise<{ seen: Seen[]; close: () => Promise<void> }> {
  const seen: Seen[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer(socket => {
    sockets.add(socket); socket.once("close", () => sockets.delete(socket));
    let pending = Buffer.alloc(0);
    socket.on("error", () => {});
    socket.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      if (pending.length < 4 || pending.length < 4 + pending.readUInt32BE(0)) return;
      const raw = JSON.parse(pending.subarray(4, 4 + pending.readUInt32BE(0)).toString("utf8"));
      const request = { method: raw.method, key: raw.method === "operation.get" ? raw.params.key : raw.request, params: raw.params };
      seen.push(request);
      const answer = script(request);
      if (answer === "drop") { socket.destroy(); return; }
      socket.end(encodeFrame({ v: 1, id: raw.id, ...answer }));
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(join(home, "peer.sock"), resolve); });
  return { seen, close: async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}

function run(home: string, args: string[]): Promise<{ code: number | string; stdout: string; stderr: string }> {
  return new Promise(resolve => execFile(process.execPath, [cli, ...args], {
    cwd: home, encoding: "utf8", timeout: 10_000,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, OMA_SOCKET: join(home, "peer.sock") },
  }, (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr })));
}
function scene() {
  const home = mkdtempSync(join(tmpdir(), "oma-v26b-"));
  writeFileSync(join(home, "input.txt"), "the words first chosen\n");
  const send = (key?: string) => ["send", "bob", "--subject", "hello", "--file", join(home, "input.txt"), ...(key ? ["--request", key] : [])];
  return { home, send, close: () => rmSync(home, { recursive: true, force: true }) };
}
const methods = (seen: Seen[]) => seen.map(request => request.method);

test("V26B: an unanswered send is resent only after a proven REQUEST_NOT_FOUND, with the bytes frozen the first time", async () => {
  const s = scene();
  let accepted = false;
  const p = await peer(s.home, request => {
    if (request.method === "operation.get") return accepted ? { ok: true, result: sent(1) } : { ok: true, result: receiptNotFound };
    if (methods(p.seen).filter(method => method === "mail.send").length === 1) return "drop";
    accepted = true;
    return { ok: true, result: sent(1) };
  });
  try {
    const first = await run(s.home, s.send("frozen-1"));
    assert.equal(first.code, 3, first.stderr);
    assert.match(first.stderr, /--request frozen-1/);
    // The source changes before the retry; the retry must not read it.
    writeFileSync(join(s.home, "input.txt"), "words typed later\n");
    const second = await run(s.home, s.send("frozen-1"));
    assert.equal(second.code, 0, second.stderr);
    assert.deepEqual(methods(p.seen), ["mail.send", "operation.get", "operation.get", "mail.send"]);
    assert.deepEqual(p.seen[3]!.params, p.seen[0]!.params, "the resend was rebuilt instead of replayed");
    assert.equal(p.seen[3]!.params.body, "the words first chosen\n");
    // Accepted now: a third run asks and does not send again.
    const third = await run(s.home, s.send("frozen-1"));
    assert.equal(third.code, 0, third.stderr);
    assert.deepEqual(methods(p.seen).slice(4), ["operation.get"]);
  } finally { await p.close(); s.close(); }
});

test("V26B: a terminal receipt in the cache is not replaced by a later lesser observation", async () => {
  const s = scene();
  let lookup: object = { ok: true, result: sent(1) };
  const p = await peer(s.home, request => request.method === "operation.get" ? lookup : { ok: true, result: sent(1) });
  try {
    assert.equal((await run(s.home, s.send("t"))).code, 0);
    lookup = { ok: true, result: { operation: OP(1), state: "pending" } };
    const later = await run(s.home, s.send("t"));
    assert.equal(later.code, 0, later.stderr);
    const cached = new RequestCache(s.home).read("t");
    assert.equal(cached.kind, "present");
    if (cached.kind === "present") assert.equal(cached.value.lastReceipt?.state, "succeeded", "a pending observation replaced a settled one");
    assert.deepEqual(methods(p.seen), ["mail.send", "operation.get"]);
  } finally { await p.close(); s.close(); }
});

test("WP26: a receipt the request cache cannot record is still shown, with the key to ask again", async () => {
  const s = scene();
  // P0-8: a damaged directory *inside* oma's own tail (`.../oma/requests`)
  // is repaired, so the fault that still makes the cache unrecordable is one
  // oma must never repair -- the user's own shared XDG ancestor.
  const ancestor = join(s.home, ".local", "state");
  const p = await peer(s.home, request => {
    // The cache becomes unwritable after the freeze, before the answer.
    if (request.method === "mail.send") chmodSync(ancestor, 0o000);
    return { ok: true, result: sent(1) };
  });
  try {
    const result = await run(s.home, s.send());
    const key = p.seen[0]!.key!;
    assert.match(key, /^cli-/);
    assert.equal(result.code, 0, `an accepted send was reported as a failure: ${result.stderr}`);
    assert.ok(result.stdout.includes(OP(1)), "the broker's receipt was not shown");
    assert.ok(result.stderr.includes(`--request ${key}`), "the key needed to ask again was not shown");
    assert.match(result.stderr, /CACHE_UNAVAILABLE/);
  } finally { chmodSync(ancestor, 0o700); await p.close(); s.close(); }
  // A receipt that contradicts the cache's earlier observation is unknown, and still shown.
  const c = scene();
  let lookup: object = { ok: true, result: sent(1) };
  const q = await peer(c.home, request => request.method === "operation.get" ? lookup : { ok: true, result: sent(1) });
  try {
    assert.equal((await run(c.home, c.send("x"))).code, 0);
    lookup = { ok: true, result: sent(2) };
    const contradicted = await run(c.home, c.send("x"));
    assert.equal(contradicted.code, 3, contradicted.stderr);
    assert.ok(contradicted.stdout.includes(OP(2)));
    assert.match(contradicted.stderr, /CACHE_CORRUPT.*--request x/);
  } finally { await q.close(); c.close(); }
});

/* AV22 -- ERR-001, CLI-003: the sixth functional run. The Principal's second
 * agent.create was accepted and then answered BROKER_UNAVAILABLE (retry
 * same-key); the CLI printed "BROKER_UNAVAILABLE: BROKER_UNAVAILABLE" and no
 * key, so the model asked again under a new one -- the one thing the error
 * table forbids for that code. A failure the broker says to retry under the
 * same key names that key; one it says never to retry does not. */
test("AV22 / ERR-001, CLI-003: a failure to retry under the same key names the key", { timeout: 30_000 }, async t => {
  for (const [failure, exit, guided] of [
    [{ code: "BROKER_UNAVAILABLE", message: "BROKER_UNAVAILABLE", retry: "same-key" }, 3, true],
    [{ code: "CAPABILITY_DENIED", message: "CAPABILITY_DENIED", retry: "never" }, 2, false],
  ] as const) {
    await t.test(failure.code, async () => {
      const home = mkdtempSync(join(tmpdir(), "oma-av22-"));
      const broker = await peer(home, () => ({ ok: false, error: failure }));
      try {
        const key = "av22-first-ask";
        const result = await run(home, ["follow", "commons", "--request", key]);
        const stderr = result.stderr;
        assert.equal(result.code, exit, stderr);
        assert.deepEqual(broker.seen.map(request => request.method), guided ? ["route.follow", "operation.get"] : ["route.follow"]);
        if (guided) {
          assert.deepEqual(broker.seen[1]!.params, { key }, "recovery only queries the original key, never resends the mutation");
          assert.match(stderr, new RegExp(`--request ${key} with the same command; do not rerun with a new key`), "the key to ask again was not given");
        }
        else assert.doesNotMatch(stderr, /--request/, "a failure never to retry was given a key to retry with");
      } finally { await broker.close(); rmSync(home, { recursive: true, force: true }); }
    });
  }
});

/* DR13 / CLI-003, P0-5: exit 2 is a settled failure. An accepted operation whose
 * outcome is not known yet -- here a create that failed after acceptance with a
 * conflict-class code, retry same-key -- is 3 and names its key; the same code
 * with nothing to look up stays 2. */
test("DR13 / CLI-003: a failure the broker says to look up again is exit 3 whatever its code", { timeout: 30_000 }, async t => {
  for (const [failure, exit] of [
    [{ code: "POLICY_CHANGED", message: "POLICY_CHANGED", retry: "same-key" }, 3],
    [{ code: "POLICY_CHANGED", message: "POLICY_CHANGED", retry: "never" }, 2],
    [{ code: "UNSUPPORTED_PROFILE", message: "UNSUPPORTED_PROFILE", retry: "same-key" }, 4],
  ] as const) {
    await t.test(`${failure.code} ${failure.retry}`, async () => {
      const home = mkdtempSync(join(tmpdir(), "oma-dr13-exit-"));
      const broker = await peer(home, () => ({ ok: false, error: failure }));
      try {
        const result = await run(home, ["follow", "commons", "--request", "dr13-exit"]);
        assert.equal(result.code, exit, result.stderr);
        if (failure.retry === "same-key") assert.match(result.stderr, /--request dr13-exit with the same command; do not rerun with a new key/);
      } finally { await broker.close(); rmSync(home, { recursive: true, force: true }); }
    });
  }
});

/* AV28 -- the CLI shows the value a conflict found. */
test("AV28 / ERR-001: the CLI shows the actual value a conflict names", { timeout: 30_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), "oma-av28-"));
  const actual = "1".repeat(40);
  const broker = await peer(home, () => ({ ok: false, error: { code: "STALE_BASE", message: "STALE_BASE", retry: "never", details: { actual } } }));
  try {
    const body = join(home, "body.txt");
    writeFileSync(body, "reason\n");
    const result = await run(home, ["merge", "review", "merge-abcd1234-0000-4000-8000-000000000000", "--file", body, "--request", "av28-cli"]);
    assert.equal(result.code, 2, result.stderr);
    assert.match(result.stderr, new RegExp(`STALE_BASE: Main differs from expected; retry against actual \\(actual: ${actual}\\)`));
  } finally { await broker.close(); rmSync(home, { recursive: true, force: true }); }
});

/* DR1 -- SB-002-C: a Resident's `oma send` showed the host's archive path,
 * which is no path inside its sandbox. The CLI shows the receipt's path under
 * the archive root its environment names; the recorded receipt is unchanged. */
test("DR1 / SB-002-C: a sent message's archive path is shown in the caller's view", async () => {
  const s = scene();
  const p = await peer(s.home, request => request.method === "operation.get" ? { ok: true, result: receiptNotFound } : { ok: true, result: sent(7) });
  try {
    const shown = (archive?: string) => new Promise<string>(resolve => execFile(process.execPath, [cli, ...s.send(`dr1-${archive ? "in" : "out"}`)], {
      cwd: s.home, encoding: "utf8", timeout: 10_000,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: s.home, OMA_SOCKET: join(s.home, "peer.sock"), ...(archive ? { OMA_MAIL_ARCHIVE: archive } : {}) },
    }, (_error, stdout) => resolve(JSON.parse(stdout.trim().split("\n").at(-1)!).result.archivePath)));
    assert.equal(await shown("/mail/archive/cur"), `/mail/archive/cur/${MESSAGE(7)}`, "the sandbox view was not used");
    assert.equal(await shown(), `/state/mail/archive/cur/${MESSAGE(7)}`, "without a view the recorded path is shown as it is");
  } finally { await p.close(); s.close(); }
});


for (const lost of ["drop", "deadline", "unavailable"] as const) {
  for (const state of ["succeeded", "pending", "unknown", "failed", "absent", "malformed", "unavailable"] as const) {
    test(`DR27/P0: ${lost} mutation answer is looked up once (${state}), never sent twice`, async () => {
      const s = scene();
      const terminal = state === "succeeded" ? sent(1) : state === "failed"
        ? { operation: OP(1), state, error: { code: "CHECK_FAILED", message: "fixture", retry: "never" } }
        : state === "absent" ? receiptNotFound : state === "malformed" ? { bad: true } : { operation: OP(1), state };
      const p = await peer(s.home, request => {
        if (request.method !== "operation.get") return lost === "drop" ? "drop" : { ok: false,
          error: { code: lost === "deadline" ? "DEADLINE_EXCEEDED" : "BROKER_UNAVAILABLE", message: "answer lost", retry: "same-key" } };
        return state === "unavailable" ? "drop" : { ok: true, result: terminal };
      });
      try {
        const result = await run(s.home, s.send("observe-once"));
        assert.equal(result.code, state === "succeeded" || state === "pending" ? 0 : state === "failed" ? 2 : 3, result.stderr);
        assert.deepEqual(methods(p.seen), ["mail.send", "operation.get"]);
        assert.deepEqual(p.seen[1]!.params, { key: "observe-once" });
        const cached = new RequestCache(s.home).read("observe-once");
        assert.ok(cached.kind === "present"); assert.equal((cached.value.params as Record<string, unknown>).body, "the words first chosen\n");
        if (["absent", "malformed", "unavailable"].includes(state)) assert.match(result.stderr, /Acceptance status unknown.*observe-once/);
      } finally { await p.close(); s.close(); }
    });
  }
}
