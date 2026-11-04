import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

async function runSurface(t, failure) {
  const fixture = mkdtempSync(join(tmpdir(), "oma-surface-owner-test-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const runtime = join(fixture, "runtime"), scratch = join(fixture, "scratch"), home = join(fixture, "home");
  const entry = join(runtime, "scripts/functional-surface.mjs");
  const observer = join(runtime, "dist/test/fixtures/surface-probe-extension.js");
  for (const dir of [dirname(entry), dirname(observer), scratch, home]) mkdirSync(dir, { recursive: true });
  // Execute the unchanged production entry and its watchdog, resolving the real
  // installed SDK and trusted extension. Only the test observer is augmented.
  for (const name of ["functional-surface.mjs", "bounded-script.mjs"])
    copyFileSync(join(root, "scripts", name), join(runtime, "scripts", name));
  for (const name of ["node_modules", "packages", "apps"])
    symlinkSync(join(root, name), join(runtime, name), "dir");
  writeFileSync(join(runtime, "package.json"), JSON.stringify({ type: "module" }));
  writeFileSync(observer, `export { default } from ${JSON.stringify(pathToFileURL(join(root,
    "test/fixtures/surface-owner-probe-extension.mjs")).href)};\n`);
  const log = join(fixture, "lifetime.jsonl");
  const env = {
    PATH: process.env.PATH,
    HOME: home, TMPDIR: scratch, TMP: scratch, TEMP: scratch,
    XDG_CONFIG_HOME: join(home, "config"), XDG_CACHE_HOME: join(home, "cache"),
    XDG_DATA_HOME: join(home, "data"),
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/nonexistent/oma-surface-owner-no-user-bus",
    SURFACE_OWNER_LOG: log,
    ...(failure ? { SURFACE_OWNER_FAILURE: failure } : {}),
    ...(process.env.NODE_OPTIONS ? { NODE_OPTIONS: process.env.NODE_OPTIONS } : {}),
  };
  const outcome = await new Promise((resolve, reject) => {
    // The real gate owns its 60-second child lifetime; this outer bound also
    // catches a broken watchdog without leaving the test process waiting forever.
    execFile(process.execPath, [entry], { cwd: runtime, env, timeout: 75000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number" && !error.signal) return reject(error);
        resolve({ code: error?.code ?? 0, signal: error?.signal ?? null, stdout, stderr });
      });
  });
  assert.equal(existsSync(log), true, `the real SDK session must start:\n${outcome.stderr}\n${outcome.stdout}`);
  const observations = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line));
  return { ...outcome, observations,
    workspaces: readdirSync(scratch).filter(name => name.startsWith("oma-functional-surface-")) };
}

const lifetime = observations => observations.filter(event => ["start", "fault", "shutdown"].includes(event.phase));
const toolResult = (observations, id) => {
  const found = observations.find(event => event.phase === "tool-result" && event.id === id);
  assert.ok(found, `the installed SDK must deliver the real ${id} result`);
  return found;
};

function assertCleaned(result) {
  assert.equal(result.signal, null, result.stderr);
  assert.deepEqual(result.workspaces, [], "the gate must remove its own private workspace before exit");
  const shutdowns = result.observations.filter(event => event.phase === "shutdown");
  assert.ok(shutdowns.length > 0, "an opened session must receive shutdown");
  for (const event of shutdowns) {
    assert.equal(event.exists, true, "shutdown must run while its workspace is still owned");
    assert.equal(existsSync(event.workdir), false, "the workspace must be gone once the child closes");
  }
}

test("001. Surface gate executes real tools, resumes committed selections and cleans up every opened session", async t => {
  const result = await runSurface(t);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /functional surface PASS:/);
  assert.doesNotMatch(result.stderr, /functional surface FAIL:/);
  assert.deepEqual(lifetime(result.observations).map(event => event.phase),
    ["start", "shutdown", "start", "shutdown", "start", "shutdown"]);
  assert.deepEqual(result.observations.filter(event => event.phase === "start").map(event => event.reason),
    ["startup", "resume", "resume"]);
  assert.deepEqual(result.observations.filter(event => event.phase === "shutdown").map(event => event.sample),
    ["Alpha\nbeta\n", "Alpha\ninserted\nbeta\n", "Alpha\ninserted\nbeta\n"]);
  for (const id of ["read-initial", "replace", "within-core-loadout", "insert-core-loadout"])
    assert.equal(toolResult(result.observations, id).isError, false, `${id} must execute successfully`);
  const resetShutdown = result.observations.filter(event => event.phase === "shutdown")[1];
  const refused = resetShutdown.toolResults.find(message => message.id === "retired-selector-refused");
  assert.ok(refused, "the refused call must have a real persisted tool result");
  assert.deepEqual(refused, { id: "retired-selector-refused", tool: "toolset", isError: true },
    "a retired selector must produce a persisted error, not execute");
  assertCleaned(result);
});

test("002. Surface gate reports an actual SDK extension error and shuts down before deleting its workspace", async t => {
  const result = await runSurface(t, "tool-result");
  assert.equal(result.code, 1, result.stderr);
  assert.doesNotMatch(result.stdout, /functional surface PASS:/);
  assert.match(result.stderr, /surface-owner-injected-tool-result-error/,
    "the failure must originate in the real SDK event runner, not an import or startup seam");
  assert.deepEqual(lifetime(result.observations).map(event => event.phase), ["start", "fault", "shutdown"]);
  assert.equal(toolResult(result.observations, "read-initial").isError, false,
    "the injected failure must happen after a successful real tool execution");
  assert.equal(result.observations.find(event => event.phase === "shutdown").sample, "Alpha\nbeta\n");
  assertCleaned(result);
});
