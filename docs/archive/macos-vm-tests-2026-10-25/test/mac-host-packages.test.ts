/** DR28: actual Mac entry and bundled package manager without app, token or guest.
 * Runs on Linux against an isolated HOME and a loopback-only npm registry. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { fakeNpmRegistry } from "./fixtures/fake-npm-registry.js";
import { readPackageIndex } from "#oma-test/app/runtime/packages/store";
import { readPersonalSettings, updatePersonalSettings } from "#oma-test/app/runtime/personal-settings";
import { ProcessLock } from "@oma/native/process-lock";

const ENTRY = fileURLToPath(new URL("../../apps/oma/dist/entry/oma-mac.js", import.meta.url));
const EXTENSION = "packages:npm/node_modules/oma-host-fixture/extensions/hello.ts";

test("Mac host packages: explicit local install/list/update/remove never needs an app or changes Society settings", { timeout: 180_000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-host-packages-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "source"), packs = join(root, "packs"), userHome = join(root, "user-home"), host = join(root, "host");
  mkdirSync(join(source, "extensions"), { recursive: true }); mkdirSync(packs); mkdirSync(userHome);
  writeFileSync(join(source, "package.json"), JSON.stringify({ name: "oma-host-fixture", version: "1.0.0", pi: { extensions: ["extensions/hello.ts"] } }));
  writeFileSync(join(source, "extensions", "hello.ts"), `export default function (pi) {
    pi.registerTool({ name: 'personal_package_fixture', label: 'Installed host package', description: 'A locally installed package fixture',
      parameters: { type: 'object', properties: {}, required: [] },
      async execute() { return { content: [{ type: 'text', text: 'INSTALLED_HOST_PACKAGE_TOOL_COMPLETE' }], details: {} }; } });
  }\n`);
  const registry = await fakeNpmRegistry([source], packs);
  t.after(() => registry.close());
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: userHome, OMA_HOST_HOME: host, LANG: "C.UTF-8",
    PI_CODING_AGENT_DIR: join(userHome, ".pi", "agent"), npm_config_registry: registry.url,
    npm_config_cache: join(root, "cache"), npm_config_audit: "false", npm_config_fund: "false", npm_config_update_notifier: "false" };
  const run = (...args: string[]) => new Promise<{ code: number | null; signal: NodeJS.Signals | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [ENTRY, "pi", ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { output += chunk; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 120_000);
    child.on("error", reject); child.on("close", (code, signal) => { clearTimeout(timer); resolve({ code, signal, output }); });
  });
  const result = async (...args: string[]) => {
    const answer = await run(...args); assert.equal(answer.signal, null, answer.output); return answer;
  };
  const store = join(host, "packages"), preferences = { dataRoot: host, libdir: fileURLToPath(new URL("../../", import.meta.url)), packages: store };
  const ordinary = await result("install", "npm:oma-host-fixture");
  assert.equal(ordinary.code, 3, ordinary.output);
  assert.equal(ordinary.output.trim(), "OMA is not running. Open the OMA app, or use --host-only for package operations without the VM.");
  assert.equal(existsSync(host), false, "missing app was reinterpreted as permission for a local install");
  const installed = await result("install", "npm:oma-host-fixture", "--host-only");
  assert.equal(installed.code, 0, installed.output); assert.match(installed.output, /Society packages were not synchronized/);
  assert.deepEqual(readPackageIndex(store), [{ source: "npm:oma-host-fixture", entries: [EXTENSION], skills: [], prompts: [], themes: [] }]);
  assert.equal(readPersonalSettings(host), null, "install consumed the first project's Personal seed");
  assert.equal(existsSync(join(host, "run", "token")), false); assert.equal(existsSync(join(host, "host-record.json")), false);
  // Existing settings are not a guest path or a project activation target.
  const society = join(host, "society-settings.json"); writeFileSync(society, "unchanged Society choices\n");
  const listed = await result("list", "--host-only"); assert.equal(listed.code, 0, listed.output);
  assert.match(listed.output, /oma-host-fixture/); assert.doesNotMatch(listed.output, /Host packages updated/);
  assert.match(listed.output, /Package contents:\n {2}npm:oma-host-fixture: 1 extension\n/);
  const busy = ProcessLock.tryAcquire(join(host, "run", "packages.lock")); assert.ok(busy);
  try {
    const refused = await result("remove", "npm:oma-host-fixture", "--host-only");
    assert.equal(refused.code, 1, refused.output); assert.match(refused.output, /Another oma pi command is running/);
    assert.deepEqual(readPackageIndex(store), [{ source: "npm:oma-host-fixture", entries: [EXTENSION], skills: [], prompts: [], themes: [] }]);
  } finally { busy.close(); }
  const unavailable = await result("install", "npm:oma-missing-fixture", "--host-only");
  assert.notEqual(unavailable.code, 0, unavailable.output); assert.doesNotMatch(unavailable.output, /Host packages updated/);
  assert.deepEqual(readPackageIndex(store), [{ source: "npm:oma-host-fixture", entries: [EXTENSION], skills: [], prompts: [], themes: [] }]);
  assert.equal(readPersonalSettings(host), null);
  updatePersonalSettings(preferences, [EXTENSION]);
  const project = join(root, "project"); mkdirSync(project);
  const hex = (value: string) => Buffer.from(value).toString("hex");
  const pty = spawnSync("python3", [join(process.cwd(), "test/fixtures/pty-harness.py"), JSON.stringify({
    argv: [process.execPath, join(process.cwd(), "test/fixtures/mac-host-packages-pty.mjs"), host, userHome, project],
    ready: hex("Your ideas, in motion"), steps: [{ write: hex("Use the installed host extension\r"), wait: 3 },
      { write: hex("\x04"), wait: 2 }],
  })], { encoding: "utf8", timeout: 55_000, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(pty.status, 0, pty.stderr);
  const terminal = JSON.parse(pty.stdout), screen = Buffer.from(terminal.output, "hex").toString();
  assert.equal(terminal.exited, true, screen.slice(-8000)); assert.equal(terminal.code, 0, screen.slice(-8000));
  assert.equal(terminal.echo, true); assert.equal(terminal.icanon, true);
  assert.match(screen, /Personal/); assert.match(screen, /personal_package_fixture/); assert.match(screen, /INSTALLED_HOST_PACKAGE_TOOL_COMPLETE/);
  assert.match(screen, /HOST_PACKAGE_PERSONAL_COMPLETE/);
  assert.equal(JSON.parse(readFileSync(join(host, "package-pty-facts.json"), "utf8")).requests, 2);
  const updated = await result("update", "npm:oma-host-fixture", "--host-only");
  assert.equal(updated.code, 0, updated.output); assert.deepEqual(readPersonalSettings(host)?.extensions, [EXTENSION]);
  updatePersonalSettings(preferences, [], { entry: EXTENSION, enabled: false });
  const selected = readFileSync(join(host, ".personal", "settings.json"), "utf8");
  writeFileSync(join(host, ".personal", "settings.json"), "{broken");
  const failed = await result("install", "npm:oma-host-fixture", "--host-only");
  assert.notEqual(failed.code, 0, failed.output); assert.doesNotMatch(failed.output, /Host packages updated/);
  assert.equal(readFileSync(join(host, ".personal", "settings.json"), "utf8"), "{broken");
  const returned = ProcessLock.tryAcquire(join(host, "run", "packages.lock")); assert.ok(returned); returned.close();
  writeFileSync(join(host, ".personal", "settings.json"), selected);
  const retried = await result("install", "npm:oma-host-fixture", "--host-only");
  assert.equal(retried.code, 0, retried.output); assert.deepEqual(readPersonalSettings(host)?.extensions, [], "install enabled an independent Personal choice");
  updatePersonalSettings(preferences, [], { entry: EXTENSION, enabled: true });
  const removed = await result("remove", "npm:oma-host-fixture", "--host-only");
  assert.equal(removed.code, 0, removed.output); assert.deepEqual(readPackageIndex(store), []);
  assert.deepEqual(readPersonalSettings(host)?.extensions, []);

  // C20 on the host store: a local package directory is copied in and installed
  // by the engine as `local/<name>`, never used where it lies; remove takes
  // the copy away with the entry.
  const localInstalled = await result("install", source, "--host-only");
  assert.equal(localInstalled.code, 0, localInstalled.output);
  assert.equal(existsSync(join(store, "local", "oma-host-fixture", "extensions", "hello.ts")), true);
  assert.deepEqual(readPackageIndex(store), [{ source: "local/oma-host-fixture",
    entries: ["packages:local/oma-host-fixture/extensions/hello.ts"], skills: [], prompts: [], themes: [] }]);
  const localListed = await result("list", "--host-only");
  assert.match(localListed.output, /local\/oma-host-fixture: 1 extension/);
  const localRemoved = await result("remove", "local/oma-host-fixture", "--host-only");
  assert.equal(localRemoved.code, 0, localRemoved.output);
  assert.deepEqual(readPackageIndex(store), []);
  assert.equal(readdirSync(join(store, "local")).length, 0, "a removed local package's copy leaves the store");
  assert.equal(readFileSync(society, "utf8"), "unchanged Society choices\n");
  assert.equal(existsSync(join(userHome, ".pi")), false); assert.equal(existsSync(join(host, "run", "hostapi.sock")), false);
  assert.equal(existsSync(join(host, ".projects")), false);
});
