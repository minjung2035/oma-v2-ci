/** DR25: `oma pi` end to end -- the installed product's entry, the bundled
 * engine's package manager and npm, over a registry on 127.0.0.1. Nothing
 * reaches the network, the user's `~/.pi` or a real provider. */
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, readFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { loadConfiguration } from "../src/config.js";
import { defaultSocietyFor } from "../src/config/defaults.js";
import { sha256Hex } from "../src/hash.js";
import { readPackageIndex } from "../src/runtime/pi-packages.js";
import { readExtensions, toggleExtension } from "../src/tui/sources/extensions.js";
import { fakeNpmRegistry } from "./fixtures/fake-npm-registry.js";
import { readPersonalSettings, updatePersonalSettings } from "../src/runtime/personal-settings.js";

const ENTRY = new URL("../src/entry/oma.js", import.meta.url).pathname;
const TIMEOUT = { timeout: 180_000 };

test("DR25: oma pi install puts a package in oma's store and turns its extension on for this project's Principal and Workers; remove takes it away", TIMEOUT, async t => {
  const base = mkdtempSync(join(tmpdir(), "oma-pi-cli-"));
  t.after(() => { spawnSync("chmod", ["-R", "u+rwX", base]); rmSync(base, { recursive: true, force: true }); });
  const source = join(base, "src", "oma-hello-ext");
  mkdirSync(join(source, "extensions"), { recursive: true });
  writeFileSync(join(source, "package.json"), JSON.stringify({ name: "oma-hello-ext", version: "1.0.0", pi: { extensions: ["./extensions/hello.ts"] } }));
  writeFileSync(join(source, "extensions", "hello.ts"), "export default function (pi) { pi.registerCommand('hello-ext', { handler: async () => {} }); }\n/*" + "x".repeat(6 * 1024 * 1024) + "*/\n");
  mkdirSync(join(base, "packs"));
  const registry = await fakeNpmRegistry([source], join(base, "packs"));
  t.after(() => registry.close());
  const project = join(base, "project"), home = join(base, "home"), data = join(base, "data"), run = join(base, "run");
  for (const dir of [project, home, data, run]) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, XDG_DATA_HOME: data, XDG_RUNTIME_DIR: run, LANG: "C.UTF-8",
    npm_config_registry: registry.url, npm_config_cache: join(base, "npm-cache"), npm_config_audit: "false",
    npm_config_fund: "false", npm_config_update_notifier: "false",
    // The user's own Pi settings are not oma's; they must not steer the engine.
    PI_CODING_AGENT_DIR: join(home, ".pi", "agent") };
  // Run without blocking this process: the registry answering npm lives here.
  const oma = (...args: string[]) => new Promise<{ status: number | null; stdout: string; stderr: string }>(resolve => {
    const child = spawn(process.execPath, [ENTRY, "pi", ...args], { cwd: project, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    const timer = setTimeout(() => { child.kill("SIGKILL"); }, 120_000);
    child.on("close", status => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
  const store = join(data, "oma", ".packages");
  const real = realpathSync(project);
  const settingsPath = join(data, "oma", ".projects", defaultSocietyFor(real, sha256Hex(real)), "config.json");
  const entry = "packages:npm/node_modules/oma-hello-ext/extensions/hello.ts";

  const refused = await oma("install", "-l", "npm:oma-hello-ext");
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /project's local packages/);
  assert.equal(existsSync(join(project, ".pi")), false, "a refused command wrote the project's .pi");

  const installed = await oma("install", "npm:oma-hello-ext");
  assert.equal(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
  assert.deepEqual(readPackageIndex(store), [{ source: "npm:oma-hello-ext", entries: [entry] }]);
  assert.match(installed.stdout + installed.stderr, /on for this project's Principal and Workers/);
  const settings = loadConfiguration(settingsPath);
  for (const role of [settings.config.principalProfile, "resident"])
    assert.ok(settings.roles[role]!.extensions.some(item => item.path === join(store, entry.slice("packages:".length))), role);
  assert.equal(settings.config.installation.packages, store);
  assert.equal(readPersonalSettings(join(data, "oma")), null, "install consumed the first Personal project's seed");
  updatePersonalSettings({ dataRoot: join(data, "oma"), libdir: process.cwd(), packages: store }, [entry]);

  // Updates must preserve an intentional off; an explicit install selects it again.
  toggleExtension(readExtensions(settingsPath, settings.config.principalProfile, "resident", readPackageIndex(store)), entry, "workers", false);
  const updated = await oma("update", "npm:oma-hello-ext");
  assert.equal(updated.status, 0, updated.stderr);
  assert.equal(loadConfiguration(settingsPath).roles.resident!.extensions.length, 1);
  assert.deepEqual(readPersonalSettings(join(data, "oma"))?.extensions, [entry]);
  updatePersonalSettings({ dataRoot: join(data, "oma"), libdir: process.cwd(), packages: store }, [], { entry, enabled: false });
  const manifest = readFileSync(settingsPath);
  chmodSync(settingsPath, 0o600);
  writeFileSync(settingsPath, "{broken");
  const failed = await oma("install", "npm:oma-hello-ext");
  assert.notEqual(failed.status, 0, failed.stdout + failed.stderr);
  assert.match(failed.stdout + failed.stderr, /Could not update/);
  assert.doesNotMatch(failed.stdout + failed.stderr, /: on for this project's/);
  writeFileSync(settingsPath, manifest);
  const retry = await oma("install", "npm:oma-hello-ext");
  assert.equal(retry.status, 0, retry.stdout + retry.stderr);
  assert.equal(loadConfiguration(settingsPath).roles.resident!.extensions.length, 2);
  assert.deepEqual(readPersonalSettings(join(data, "oma"))?.extensions, [], "install changed an independent Personal choice");
  updatePersonalSettings({ dataRoot: join(data, "oma"), libdir: process.cwd(), packages: store }, [], { entry, enabled: true });

  const listed = await oma("list");
  assert.equal(listed.status, 0);
  assert.match(listed.stdout, /npm:oma-hello-ext/);

  const removed = await oma("remove", "npm:oma-hello-ext");
  assert.equal(removed.status, 0, `${removed.stdout}\n${removed.stderr}`);
  assert.deepEqual(readPackageIndex(store), []);
  assert.deepEqual(readPersonalSettings(join(data, "oma"))?.extensions, [], "remove left Personal preferences pointing at a removed package");
  const after = loadConfiguration(settingsPath);
  for (const role of Object.keys(after.roles))
    assert.ok(!after.roles[role]!.extensions.some(item => item.path.includes("oma-hello-ext")), `${role} kept a removed package`);
  assert.equal(existsSync(join(home, ".pi")), false, "the user's own Pi was touched");
  assert.ok(registry.requests.some(line => line.startsWith("GET /oma-hello-ext")), "npm did not ask the local registry");
});
