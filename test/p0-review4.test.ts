/** Priority 0, fourth review (implementation/priority-0-audit.md "4차 점검"):
 * the findings of the whole-codebase external review, each tested where its
 * decision takes effect, with the reading the fix removed as the control. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLI_CREDENTIAL_FD_ENV } from "../src/cli/transport.js";
import { runCliProcess } from "../src/extension/cli-process.js";

const CREDENTIAL = "c".repeat(64);
const HANDLE = "d".repeat(32);

/** Runs the real CLI transport in a child that holds `line` on descriptor 3,
 * as the trusted extension leaves it, and makes `calls` requests. Each result
 * is the failure's code and message; there is no broker at the path, so a
 * request that got past the credential fails only on connecting. */
function cliCalls(line: string, calls: number): Promise<string[]> {
  const script = `
    import { callActor } from ${JSON.stringify(join(process.cwd(), "dist/src/cli/transport.js"))};
    const results = [];
    for (let index = 0; index < ${calls}; index += 1) {
      try { await callActor("/nonexistent/socket", "status.get", {}); results.push("no error"); }
      catch (error) { results.push(String(error.code ?? "") + ":" + String(error.message)); }
    }
    process.stdout.write(JSON.stringify(results));
  `;
  return new Promise(resolve => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script],
      { env: { PATH: "/usr/bin:/bin", [CLI_CREDENTIAL_FD_ENV]: "3" }, stdio: ["ignore", "pipe", "inherit", "pipe"] });
    const socket = child.stdio[3] as unknown as { end(text: string): void; on(event: string, fn: () => void): void };
    socket.on("error", () => {});
    socket.end(line);
    let out = "";
    child.stdout!.on("data", chunk => { out += String(chunk); });
    child.once("close", () => { resolve(JSON.parse(out) as string[]); });
  });
}

test("P0V-25 / N01, P0-4: one CLI process reads its credential once, and every request it makes attaches with it", async () => {
  // A lookup and the resend it permits, or a query and the submission it
  // prepares: the second request must not find the descriptor already spent.
  const results = await cliCalls(`credential ${CREDENTIAL} ${HANDLE}\n`, 3);
  assert.equal(results.length, 3);
  for (const result of results) assert.match(result, /BROKER_UNAVAILABLE|ENOENT|connect/, `a later request was refused: ${JSON.stringify(results)}`);
  // A refused credential stays refused for the whole process, not "malformed"
  // on the first request and something else on the next.
  const refused = await cliCalls("ready\n", 2);
  for (const result of refused) assert.match(result, /AUTH_FAILED:.*malformed/, JSON.stringify(refused));
});

test("P0V-27 / N03, P0-4: a broker that could not be started is reported, and the host that tried keeps running", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-spawn-failed-"));
  try {
    // Exists, but cannot be executed: spawn hands back a child with no pid and
    // reports EACCES afterwards, after the supervisor has already decided.
    const node = join(dir, "node"); writeFileSync(node, "not an executable\n"); chmodSync(node, 0o600);
    const script = `
      const { superviseBroker } = await import(${JSON.stringify(join(process.cwd(), "dist/src/runtime/broker-supervisor.js"))});
      const lines = [];
      const handle = await superviseBroker({ node: ${JSON.stringify(node)}, libdir: ${JSON.stringify(dir)}, society: "spawnfail",
        stateRoot: ${JSON.stringify(join(dir, "oma", "spawnfail"))}, runRoot: ${JSON.stringify(join(dir, "run", "oma", "spawnfail"))},
        configPath: ${JSON.stringify(join(dir, "config.json"))}, onEvent: line => lines.push(line) });
      await new Promise(resolve => setTimeout(resolve, 200));
      process.stdout.write(JSON.stringify({ state: handle.state, lines }));
    `;
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; let err = "";
    child.stdout.on("data", chunk => { out += String(chunk); });
    child.stderr.on("data", chunk => { err += String(chunk); });
    const code = await new Promise<number | null>(resolve => child.once("close", resolve));
    assert.equal(code, 0, `the host ended on the failed spawn: ${err}`);
    const result = JSON.parse(out) as { state: { kind: string; reason?: string }; lines: string[] };
    assert.deepEqual(result.state, { kind: "unavailable", reason: "the broker process did not start" });
    assert.ok(result.lines.some(line => /broker failed: .*EACCES/.test(line)), `the reason was not reported: ${JSON.stringify(result.lines)}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("P0V-35 / N12, P0-2: a CLI's output is decoded as the bytes it wrote, wherever the pipe cut them", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-cli-utf8-"));
  try {
    const text = "한글✅ 결과";
    const bytes = Buffer.from(text, "utf8");
    // Every cut inside the first character, on both streams, each written as
    // its own chunk with a pause so the pipe cannot join them again.
    for (const cut of [1, 2, 4, 5]) {
      const cli = join(dir, `split-${cut}.mjs`);
      writeFileSync(cli, `
        const bytes = Buffer.from(${JSON.stringify(text)}, "utf8");
        const pause = () => new Promise(resolve => setTimeout(resolve, 30));
        process.stdout.write(bytes.subarray(0, ${cut})); process.stderr.write(bytes.subarray(0, ${cut + 1 > bytes.length ? cut : cut + 1}));
        await pause();
        process.stdout.write(bytes.subarray(${cut})); process.stderr.write(bytes.subarray(${cut + 1 > bytes.length ? cut : cut + 1}));
      `);
      const result = await runCliProcess({ node: process.execPath, cli, args: [], cwd: dir,
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin" }, grant: null, timeoutMs: 10_000 });
      assert.equal(result.finished, true);
      assert.equal(result.stdout, text, `stdout cut at byte ${cut}`);
      assert.equal(result.stderr, text, `stderr cut at byte ${cut + 1}`);
      assert.equal(Buffer.byteLength(result.stdout), bytes.length);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
