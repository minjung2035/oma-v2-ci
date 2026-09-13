import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FrameParser, encodeFrame } from "../src/frame.js";

const entry = (name: string) => join(import.meta.dirname, "..", "src", "entry", `${name}.js`);

test("ID-001: entrypoints reject traversal before filesystem or socket effects", () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-entry-name-"));
  try {
    for (const name of ["broker", "runner", "host"]) {
      const args = name === "host" ? ["reconcile"] : name === "runner" ? ["--agent", "a"] : [];
      const result = spawnSync(process.execPath, [entry(name), ...args, "--society", "../escape"], {
        env: { ...process.env, XDG_DATA_HOME: dir, XDG_RUNTIME_DIR: dir }, encoding: "utf8", timeout: 3000,
      });
      assert.equal(result.status, 4, `${name}: ${result.stderr}`);
      assert.equal(existsSync(join(dir, "escape")), false);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("PR-002: host entry reports EOF/malformed replies as failure and parses split replies", { timeout: 10000 }, async () => {
  for (const mode of ["success", "eof", "malformed", "denied"]) {
    const dir = mkdtempSync(join(tmpdir(), "oma-host-entry-"));
    const run = join(dir, "oma", "probe");
    mkdirSync(run, { recursive: true });
    const server = createServer((peer) => {
      const parser = new FrameParser(4096);
      peer.on("error", () => {});
      peer.on("data", (chunk) => {
        for (const frame of parser.feed(Buffer.from(chunk))) {
          const request = frame.raw as { id: string; method: string };
          assert.equal(request.method, "host.reconcile");
          if (mode === "eof") return peer.end();
          if (mode === "malformed") return peer.end(Buffer.from([0, 0, 0, 1, 0xff]));
          // Protocol v1 responses carry the version like every other boundary.
          const reply = encodeFrame(mode === "denied"
            ? { v: 1, id: request.id, ok: false, error: { code: "AUTH_FAILED", message: "denied", retry: "never" } }
            // The closed host.reconcile result schema, not a partial object.
            : { v: 1, id: request.id, ok: true, result: { examined: 1, repaired: 1, remaining: 0 } });
          peer.write(reply.subarray(0, 2));
          setTimeout(() => { if (!peer.destroyed) peer.end(reply.subarray(2)); }, 20);
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(join(run, "host.sock"), resolve));
    const child = spawn(process.execPath, [entry("host"), "reconcile", "--society", "probe"], {
      env: { ...process.env, XDG_RUNTIME_DIR: dir }, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.resume();
    const timer = setTimeout(() => child.kill("SIGKILL"), 4000);
    try {
      const [code] = await once(child, "exit");
      assert.equal(code, mode === "success" ? 0 : mode === "denied" ? 2 : 3, mode);
      if (mode === "success") assert.deepEqual(JSON.parse(stdout), { examined: 1, repaired: 1, remaining: 0 });
      else assert.equal(stdout, "");
    } finally {
      clearTimeout(timer);
      child.kill("SIGKILL");
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
