// CLI/request-cache regression only: the local socket peer is not a broker or systemd proof.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RequestCache } from "#oma-test/app/request-cache";
import { encodeFrame } from "@oma/protocol/frame";
import type { Receipt } from "@oma/contracts";

const CLI = fileURLToPath(new URL("../../apps/oma/dist/cli.js", import.meta.url));
const CACHE = new URL(import.meta.resolve("#oma-test/app/request-cache")).href;
const MESSAGE = "m-00000000-0000-4000-8000-000000000091-0";
interface CliResult {
  code: number | string;
  signal: string | null;
  killed: boolean;
  stdout: string;
  stderr: string;
}
function run(
  home: string,
  args: string[],
  preload?: string,
): Promise<CliResult> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [...(preload ? ["--import", preload] : []), CLI, ...args],
      {
        cwd: home,
        encoding: "utf8",
        timeout: 5000,
        maxBuffer: 65536,
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          HOME: home,
          OMA_SOCKET: join(home, "peer.sock"),
          NODE_OPTIONS: process.env.NODE_OPTIONS ?? "",
        },
      },
      (error, stdout, stderr) =>
        resolve({
          code: error?.code ?? 0,
          signal: error?.signal ?? null,
          killed: error?.killed ?? false,
          stdout,
          stderr,
        }),
    );
  });
}
function fixture(): string {
  const home = mkdtempSync(join(tmpdir(), "oma-f2-request-"));
  writeFileSync(join(home, "input.txt"), "fixture input\n");
  mkdirSync(join(home, "context"));
  writeFileSync(join(home, "context", "GOAL.md"), "# GOAL\nfixture\n");
  return home;
}
// Tripwires for preparation attempts, not a sandbox. No malformed invocation
// may silently allocate a random key, touch its inputs/cache, spawn Git, or connect.
function preparationGuard(home: string): string {
  const path = join(home, "guard.mjs");
  writeFileSync(
    path,
    `import { RequestCache } from ${JSON.stringify(CACHE)};
    import fs from 'node:fs'; import childProcess from 'node:child_process';
    import crypto from 'node:crypto'; import { Socket } from 'node:net';
    import { resolve, sep } from 'node:path'; import { fileURLToPath } from 'node:url';
    import { syncBuiltinESMExports } from 'node:module';
    const stop = what => { console.error('PREPARATION_REACHED: ' + what); process.exit(91); };
    for (const method of ['read', 'readBody', 'freeze', 'updateReceipt']) RequestCache.prototype[method] = () => stop('cache.' + method);
    crypto.randomUUID = () => stop('random request key');
    for (const method of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) childProcess[method] = () => stop('subprocess');
    Socket.prototype.connect = () => stop('network');
    for (const method of ['readFileSync', 'openSync', 'statSync', 'lstatSync', 'existsSync', 'readdirSync']) {
      const original = fs[method];
      fs[method] = function (path, ...args) {
        const target = typeof path === 'string' ? resolve(path) : path instanceof URL ? fileURLToPath(path) : null;
        if (target === process.env.HOME || target?.startsWith(process.env.HOME + sep)) stop('input filesystem');
        return original.call(this, path, ...args);
      };
    }
    syncBuiltinESMExports();`,
  );
  return path;
}
const mutations: Array<[string, (home: string) => string[]]> = [
  [
    "send",
    (home) => [
      "send",
      "bob",
      "--subject",
      "hello",
      "--file",
      join(home, "input.txt"),
    ],
  ],
  ["ack", () => ["ack", MESSAGE]],
  ["follow", () => ["follow", "dev"]],
  ["unfollow", () => ["unfollow", "dev"]],
  [
    "agent.create",
    (home) => [
      "agent",
      "create",
      "alice",
      "--from",
      "HEAD",
      "--file",
      join(home, "input.txt"),
    ],
  ],
  ["agent.start", () => ["agent", "start", "alice"]],
  ["agent.stop", () => ["agent", "stop", "alice"]],
  ["agent.continue", () => ["agent", "continue", "--note", "hello"]],
  ["submit", (home) => ["submit", "HEAD", "--file", join(home, "input.txt")]],
  [
    "merge review",
    (home) => ["merge", "review", "merge-abcd1234-0000-4000-8000-000000000000", "--file", join(home, "input.txt")],
  ],
  [
    "context.publish",
    (home) => ["context", "publish", join(home, "context"), "--expect", "none"],
  ],
];
for (const [name, args] of mutations) {
  test(`F2: ${name} rejects malformed --request before any preparation`, async () => {
    const home = fixture();
    try {
      const guard = preparationGuard(home);
      const before = readdirSync(home, { recursive: true }).sort();
      for (const options of [
        ["--request"],
        // AV1: an option's value is the next argument, whatever it looks like;
        // `--request --subject` names the key "--subject". A malformed key is one
        // outside the request-key grammar.
        ["--request", "bad/key"],
        ["--request", ""],
        ["--request", "valid", "--request"],
        ["--request", "first", "--request", "second"],
      ]) {
        const result = await run(home, [...args(home), ...options], guard);
        assert.equal(result.killed, false);
        assert.equal(result.signal, null);
        assert.equal(
          result.code,
          2,
          `${JSON.stringify(options)}: ${result.stderr}`,
        );
        assert.match(result.stderr, /oma: (?:--request|invalid request key)/);
        assert.doesNotMatch(result.stderr, /PREPARATION_REACHED/);
        assert.equal(result.stdout, "");
        assert.deepEqual(readdirSync(home, { recursive: true }).sort(), before);
        assert.equal(
          readFileSync(join(home, "input.txt"), "utf8"),
          "fixture input\n",
        );
        assert.equal(
          readFileSync(join(home, "context", "GOAL.md"), "utf8"),
          "# GOAL\nfixture\n",
        );
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
}
test("F2: preparation tripwires observe allocation and cache access rather than silently passing", async () => {
  const home = fixture();
  try {
    const guard = preparationGuard(home);
    for (const [options, expected] of [
      [[], "random request key"],
      [["--request", "valid"], "cache.read"],
    ] as const) {
      const result = await run(home, ["follow", "dev", ...options], guard);
      assert.equal(result.code, 91, result.stderr);
      assert.equal(result.killed, false);
      assert.equal(result.signal, null);
      assert.ok(result.stderr.includes(`PREPARATION_REACHED: ${expected}`));
    }
    assert.equal(readdirSync(home).includes(".local"), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("F2: omitted request creates distinct keys; explicit valid request freezes once and retries by lookup", async () => {
  const home = fixture();
  const sockets = new Set<Socket>();
  const errors: unknown[] = [];
  const receipts = new Map<string, Receipt>();
  const seen: Array<{ method: string; key: string }> = [];
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    let pending = Buffer.alloc(0);
    let answered = false;
    socket.on("error", (error) => errors.push(error));
    socket.on("data", (chunk) => {
      if (answered) return;
      try {
        assert.ok(Buffer.isBuffer(chunk));
        pending = Buffer.concat([pending, chunk]);
        assert.ok(pending.length <= 65536, "fixture request exceeds bound");
        if (pending.length < 4) return;
        const bytes = pending.readUInt32BE(0);
        assert.ok(bytes <= 65532);
        if (pending.length < 4 + bytes) return;
        const request = JSON.parse(
          pending.subarray(4, 4 + bytes).toString("utf8"),
        ) as {
          id: string;
          method: string;
          request?: string;
          params: { key?: string; topic?: string };
        };
        assert.equal(typeof request.id, "string");
        assert.ok(
          request.method === "route.follow" ||
            request.method === "operation.get",
        );
        const key =
          request.method === "operation.get"
            ? request.params.key
            : request.request;
        assert.equal(typeof key, "string");
        assert.ok(key);
        if (request.method === "route.follow") {
          assert.equal(request.params.topic, "dev");
          assert.equal(receipts.has(key), false);
          receipts.set(key, {
            operation: `op-00000000-0000-4000-8000-${String(receipts.size + 1).padStart(12, "0")}`,
            state: "succeeded",
            result: { kind: "route.follow", topic: "dev", subscribed: true },
          });
        }
        const receipt = receipts.get(key);
        assert.ok(receipt, "lookup must refer to an existing request");
        seen.push({ method: request.method, key });
        answered = true;
        socket.end(
          encodeFrame({ v: 1, id: request.id, ok: true, result: receipt }),
        );
      } catch (error) {
        errors.push(error);
        socket.destroy();
      }
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(join(home, "peer.sock"), resolve);
    });
    for (let n = 0; n < 2; n++) {
      const result = await run(home, ["follow", "dev"]);
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.signal, null);
    }
    assert.equal(seen.length, 2);
    assert.notEqual(seen[0]?.key, seen[1]?.key);
    for (const request of seen) {
      assert.equal(request.method, "route.follow");
      assert.match(
        request.key,
        /^cli-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
    for (const key of ["Retry._Key-1", "-leading", "x".repeat(96)]) {
      const at: number = seen.length;
      for (let n = 0; n < 2; n++) {
        const result = await run(home, ["follow", "dev", "--request", key]);
        assert.equal(result.code, 0, result.stderr);
        assert.equal(result.signal, null);
      }
      assert.deepEqual(seen.slice(at), [
        { method: "route.follow", key },
        { method: "operation.get", key },
      ]);
      const cached = new RequestCache(home).read(key);
      assert.equal(cached.kind, "present");
      if (cached.kind === "present")
        assert.deepEqual(cached.value.lastReceipt, receipts.get(key));
    }
    assert.deepEqual(
      errors,
      [],
      "fixture failures must not masquerade as CLI success",
    );
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(home, { recursive: true, force: true });
  }
});
