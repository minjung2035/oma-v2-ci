import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, type Socket } from "node:net";
import { spawn } from "node:child_process";
import { RequestCache } from "../src/request-cache.js";
import { FrameParser, encodeFrame } from "../src/frame.js";

const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));
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
  { name: "pending is accepted but unfinished", lookup: { ok: true, result: { operation, state: "pending" } }, exit: 0, resend: false, stdout: /^접수됨 \/ 아직 완료되지 않음\n재조회: 동일 command에 --request / },
  { name: "unknown is not absence", lookup: { ok: true, result: { operation, state: "unknown" } }, exit: 3, resend: false, stdout: /^결과 불명확:/ },
  { name: "terminal failed is not absence", lookup: { ok: true, result: { operation, state: "failed", error: { code: "CHECK_FAILED", message: "CHECK_FAILED", retry: "never" } } }, exit: 2, resend: false, stdout: /^실패: CHECK_FAILED/ },
  { name: "success has no repeated physical effect", lookup: { ok: true, result: success }, exit: 0, resend: false, stdout: /"state":"succeeded"/ },
  { name: "SPIKE remains unsupported", lookup: { ok: true, result: { operation, state: "failed", error: { code: "SPIKE_UNRESOLVED", message: "SPIKE_UNRESOLVED", retry: "never" } } }, exit: 4, resend: false, stdout: /^실패: SPIKE_UNRESOLVED/ },
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
