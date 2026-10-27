/** Installed Linux adapter: actual assets and pure/live-reader boundaries. No systemd/VM qualification. */
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
const hook = registerHooks({ resolve(specifier, context, next) {
  assert.notEqual(specifier, "node:sqlite", "a file/platform API loaded the ledger");
  return next(specifier, context);
} });
try {
  const { runnerScope } = await import("@oma/platform-linux/runner-scope");
  const { gitSandbox } = await import("@oma/platform-linux/git-sandbox");
  const { spawnSandboxed } = await import("@oma/platform-linux/worker-spawn");
  const { sandboxSeccompFilter } = await import("@oma/platform-linux/sandbox-seccomp");
  const command = runnerScope({ executable: "/node space/$p%", argv: ["literal argument"], env: {}, timeoutMs: null, stdoutBytes: 0, stderrBytes: 0 });
  assert.equal(command.executable, "/usr/bin/bwrap");
  assert.deepEqual(command.argv.slice(-3), ["--", "/node space/$p%", "literal argument"]);
  assert.ok(command.argv.includes("--unshare-pid"));
  assert.equal(typeof gitSandbox, "function"); assert.equal(typeof spawnSandboxed, "function");
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.resolve("@oma/platform-linux/runner-scope")), "utf8"));
  assert.equal(manifest.exports["./units"], undefined);
  assert.ok(sandboxSeccompFilter().byteLength > 0);
  for (const missing of ["@oma/config", "@oma/client", "@oma/engine", "@oma/tui", "@oma/broker", "@oma/mail"])
    assert.throws(() => import.meta.resolve(missing), { code: "ERR_MODULE_NOT_FOUND" });
} finally { hook.deregister(); }
