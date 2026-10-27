import { encodePackageIndex } from "#oma-test/app/runtime/packages/index";
/** DR25 on macOS (macos-platform §4.5 packages.replace, Host API packages.sync):
 * the packages `oma pi` installs on the Mac reach the engine whole, and the
 * engine's own `oma pi` code takes them on -- over a driver that runs the real
 * guest services here, and the real `oma` Mac command. */
import test from "node:test";
import assert from "node:assert/strict";
import { connect, type Server } from "node:net";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync,
  statSync, symlinkSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeFrame } from "@oma/protocol/frame";
import { readLeadingFrame } from "#oma-test/app/platform/rpc";
import type { SessionLauncher } from "#oma-test/app/platform/guest/host";
import { HostService } from "#oma-test/app/platform/host/service";
import { newHostRecord, writeHostRecord } from "@oma/platform-mac/record";
import { HOST_GUEST_PROTOCOL, PLATFORM_FRAME_BYTES } from "@oma/protocol/host-guest";
import { HOST_API_VERSION } from "@oma/protocol/host-api";
import { PACKAGE_ARCHIVE_BOUNDS, readPackageArchive, writePackageArchive } from "#oma-test/app/platform/package-archive";
import { PACKAGE_GENERATIONS, PACKAGE_STORE, readPackageIndex, pinPackageGeneration } from "#oma-test/app/runtime/packages/store";
import { loadConfiguration } from "@oma/config";
import { defaultSocietyFor } from "@oma/config/defaults";
import { sha256Hex } from "@oma/domain/canonical-json";
import { LocalDriver, listenSilently } from "./fixtures/local-guest.js";
import { RequestLedger } from "#oma-test/app/platform/guest/requests";
import { GuestProjects } from "#oma-test/app/platform/guest/project";
import { GuestPackages } from "#oma-test/app/platform/guest/packages";
import { createCompleteConfigurationFixture } from "./fixtures/configuration.js";
import { RESIDENT_PATHS, confinedPath } from "@oma/domain/resident-paths";
import { packageStoreRoot } from "#oma-test/app/runtime/packages/store";
import { applyPackageArchive, type ApplyStep } from "#oma-test/app/application/packages-apply";
import { fileURLToPath } from "node:url";
import { readExtensions, toggleExtension } from "#oma-test/app/application/extensions";
import { fakeNpmRegistry } from "./fixtures/fake-npm-registry.js";
import { readPersonalSettings, updatePersonalSettings } from "#oma-test/app/runtime/personal-settings";
import { holdSocketNames } from "./fixtures/socket-names.js";

const HELLO = "packages:npm/node_modules/oma-hello-ext/extensions/hello.ts";
const TIMEOUT = { timeout: 180_000 };

/** A store as the engine's package manager leaves one on the Mac. */
function macStore(dir: string, packages: Record<string, Record<string, string>>): void {
  for (const [name, files] of Object.entries(packages)) for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(dir, "npm", "node_modules", name, file, ".."), { recursive: true });
    writeFileSync(join(dir, "npm", "node_modules", name, file), text);
  }
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ packages: Object.keys(packages).map(name => `npm:${name}`) }));
}
const hello = { "package.json": JSON.stringify({ name: "oma-hello-ext", version: "1.0.0", pi: { extensions: ["./extensions/hello.ts"] } }),
  "extensions/hello.ts": "export default function (pi) { pi.registerCommand('hello-ext', { handler: async () => {} }); }\n" };

test("DR25/mac: the packages archive carries the store's list and installed files, and nothing an engine would not load", async t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-pkg-archive-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = join(dir, "store");
  macStore(store, { "oma-hello-ext": { ...hello, "bin/tool.js": "#!/usr/bin/env node\n" } });
  chmodSync(join(store, "npm/node_modules/oma-hello-ext/bin/tool.js"), 0o755);
  mkdirSync(join(store, "npm/node_modules/.bin"), { recursive: true });
  symlinkSync("../oma-hello-ext/bin/tool.js", join(store, "npm/node_modules/.bin/tool"));
  mkdirSync(join(store, "git/github.com/a/b/.git"), { recursive: true });
  writeFileSync(join(store, "git/github.com/a/b/.git/HEAD"), "ref: refs/heads/main\n");
  writeFileSync(join(store, "git/github.com/a/b/index.ts"), "export default function () {}\n");
  mkdirSync(join(store, "tmp")); writeFileSync(join(store, "tmp", "x"), "scratch");
  writeFileSync(join(store, "oma-extensions.json"), encodePackageIndex([]));
  writeFileSync(join(store, "auth.json"), "{\"secret\": 1}");
  const archive = join(dir, "packages.archive");
  await writePackageArchive(store, archive);
  const into = join(dir, "into"); mkdirSync(into);
  readPackageArchive(archive, into);
  const listed: string[] = [];
  const walk = (at: string, rel: string): void => { for (const name of readdirSync(at).sort()) {
    const path = join(at, name), inside = rel ? `${rel}/${name}` : name;
    listed.push(`${inside}${lstatSync(path).isDirectory() ? "/" : ""}`);
    if (lstatSync(path).isDirectory()) walk(path, inside);
  } };
  walk(into, "");
  assert.deepEqual(listed, ["git/", "git/github.com/", "git/github.com/a/", "git/github.com/a/b/", "git/github.com/a/b/index.ts",
    "npm/", "npm/node_modules/", "npm/node_modules/.bin/", "npm/node_modules/oma-hello-ext/", "npm/node_modules/oma-hello-ext/bin/",
    "npm/node_modules/oma-hello-ext/bin/tool.js", "npm/node_modules/oma-hello-ext/extensions/", "npm/node_modules/oma-hello-ext/extensions/hello.ts",
    "npm/node_modules/oma-hello-ext/package.json", "settings.json"]);
  assert.equal(readFileSync(join(into, "npm/node_modules/oma-hello-ext/extensions/hello.ts"), "utf8"), hello["extensions/hello.ts"]);
  assert.equal(statSync(join(into, "npm/node_modules/oma-hello-ext/bin/tool.js")).mode & 0o111, 0o111, "the executable bit did not travel");
});

test("DR25/mac: an archive that names anything out of place, or more than it may hold, is refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "oma-pkg-refuse-"));
  try {
    const magic = Buffer.from("oma-packages-v1\n");
    const entry = (kind: number, path: string, body?: Buffer): Buffer => {
      const name = Buffer.from(path); const head = Buffer.alloc(3); head.writeUInt8(kind, 0); head.writeUInt16BE(name.length, 1);
      if (body === undefined) return Buffer.concat([head, name]);
      const size = Buffer.alloc(9); size.writeUInt32BE(0, 1); size.writeUInt32BE(body.length, 5);
      return Buffer.concat([head, name, size, body]);
    };
    const cases: [string, Buffer, RegExp][] = [
      ["magic", Buffer.from("ustar-not-an-oma-archive"), /not a packages archive/],
      ["escape", Buffer.concat([magic, entry(1, "npm"), entry(2, "npm/../../escape", Buffer.from("x")), Buffer.from([0])]), /normalized relative/],
      ["absolute", Buffer.concat([magic, entry(2, "/etc/passwd", Buffer.from("x")), Buffer.from([0])]), /normalized relative/],
      ["root", Buffer.concat([magic, entry(2, "auth.json", Buffer.from("x")), Buffer.from([0])]), /out of place/],
      ["orphan", Buffer.concat([magic, entry(2, "npm/x.ts", Buffer.from("x")), Buffer.from([0])]), /out of place/],
      ["twice", Buffer.concat([magic, entry(1, "npm"), entry(1, "npm"), Buffer.from([0])]), /out of place/],
      ["short", Buffer.concat([magic, entry(1, "npm")]), /ends early/],
      ["trailing", Buffer.concat([magic, Buffer.from([0]), Buffer.from("more")]), /after its end/],
      ["kind", Buffer.concat([magic, Buffer.from([7])]), /unknown entry/],
      ["utf8", Buffer.concat([magic, entry(1, "npm"), Buffer.from([2, 0, 5]), Buffer.from([110, 112, 109, 47, 255])]), /not UTF-8/],
      ["executable", Buffer.concat([magic, entry(1, "npm"), (() => { const file = entry(2, "npm/x", Buffer.from("x")); file[8] = 2; return file; })()]), /executable flag/],
    ];
    for (const [name, bytes, reason] of cases) {
      const archive = join(dir, `${name}.archive`); writeFileSync(archive, bytes);
      const into = join(dir, name); mkdirSync(into);
      assert.throws(() => readPackageArchive(archive, into), reason, name);
    }
    // A member whose u64 size declares bytes the archive does not carry ends
    // honestly on the stream, whatever the number -- size alone is no longer a
    // refusal, but declared bytes that are absent still are.
    const huge = Buffer.alloc(9); huge.writeUInt32BE(1, 1); huge.writeUInt32BE(0, 5);
    const archive = join(dir, "huge.archive");
    writeFileSync(archive, Buffer.concat([magic, entry(1, "npm"), Buffer.from([2, 0, 5]), Buffer.from("npm/x"), huge]));
    mkdirSync(join(dir, "huge"));
    assert.throws(() => readPackageArchive(archive, join(dir, "huge")), /ends early/);
    // A size the wire's u64 cannot name exactly is the one refusal left:
    // it cannot be observed exactly at all.
    const unsafe = Buffer.alloc(9); unsafe.writeUInt8(0, 0); unsafe.writeUInt32BE(0x200000, 1); unsafe.writeUInt32BE(0, 5);
    const unobservable = join(dir, "unsafe.archive");
    writeFileSync(unobservable, Buffer.concat([magic, entry(1, "npm"), Buffer.from([2, 0, 5]), Buffer.from("npm/x"), unsafe]));
    mkdirSync(join(dir, "unsafe"));
    assert.throws(() => readPackageArchive(unobservable, join(dir, "unsafe")), /observed exactly/);
    assert.ok(PACKAGE_ARCHIVE_BOUNDS.fileBytes === Number.MAX_SAFE_INTEGER,
      "the file bound is the exact-observation bound, not a capacity cap");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

async function world(t: import("node:test").TestContext) {
  const dir = mkdtempSync(join(tmpdir(), "oma-pkg-host-"));
  const socketNames = holdSocketNames(dir);
  let holder: Server | null = null, driver: LocalDriver | null = null, service: HostService | null = null;
  t.after(async () => {
    try { if (service !== null) await service.shutdown(); }
    finally {
      try { if (driver !== null) await driver.dispose(); }
      finally {
        try { if (holder !== null) await new Promise<void>(resolve => holder!.close(() => resolve())); }
        finally {
          socketNames.close();
          spawnSync("chmod", ["-R", "u+rwX", dir]);
          rmSync(dir, { recursive: true, force: true });
        }
      }
    }
  });
  const runDir = join(dir, "run"); mkdirSync(runDir);
  const recordPath = join(dir, "host-record.json");
  const record = newHostRecord();
  writeHostRecord(recordPath, record);
  const societiesDir = join(dir, "data", "oma");
  mkdirSync(societiesDir, { recursive: true });
  const holderPath = join(dir, "demo.sock");
  holder = await listenSilently(holderPath);
  const launcher: SessionLauncher = { socketPath: () => holderPath, start: async () => {},
    stop: async () => { await new Promise(r => holder?.close(r)); holder = null; return "stopped"; } };
  driver = new LocalDriver(dir, { dir: societiesDir, launcher }, record.instanceId);
  service = await HostService.start({
    runDir, recordPath, driver, uid: process.getuid!(), git: "/usr/bin/git", archivesDir: join(dir, "archives"), storageFloorBytes: 0,
    keychain: { get: async () => undefined, put: async () => {} }, packagesDir: join(dir, "packages"),
    identity: { hostVersion: "1.0.0", installationId: record.installationId, instanceId: record.instanceId, expectImage: "2026.09.1",
      protocol: { min: HOST_GUEST_PROTOCOL, max: HOST_GUEST_PROTOCOL } },
    resolve: async () => ({ provider: "anthropic", model: "m", origin: "https://provider.invalid", apiKey: "sk-ant-api03-" + "r".repeat(40), headers: {} }),
    timings: { handshakeDeadlineMs: 2000, handshakeRetryMs: 20, drainDeadlineMs: 800, healthEveryMs: 1000, hungAfterMs: 2000,
      restarts: { max: 3, windowMs: 60_000, backoffMs: 20 } },
  });
  const token = readFileSync(join(runDir, "token"), "utf8").trim();
  const call = async (method: string, params: Record<string, unknown> = {}, key?: string): Promise<Record<string, unknown>> => {
    const socket = connect(join(runDir, "hostapi.sock"));
    await new Promise<void>((ok, fail) => { socket.once("connect", ok); socket.once("error", fail); });
    socket.write(encodeFrame({ v: 1, id: "h", method: "hello", params: { api: { min: 1, max: HOST_API_VERSION }, token, client: "oma-cli" } }));
    const hello = await readLeadingFrame(socket, PLATFORM_FRAME_BYTES, 3000);
    if (hello.rest.length > 0) socket.unshift(hello.rest);
    socket.write(encodeFrame({ v: 1, id: "r", method, params, ...(key === undefined ? {} : { key }) }));
    const answer = await readLeadingFrame(socket, PLATFORM_FRAME_BYTES, 120_000);
    socket.destroy();
    return answer.frame;
  };
  // A project brought to the engine: its mirror, as project.import leaves it.
  const projectId = randomUUID();
  const mirror = join(dir, "projects", projectId);
  mkdirSync(mirror, { recursive: true });
  spawnSync("/usr/bin/git", ["init", "-q", mirror]);
  const real = realpathSync(mirror);
  const projectSettings = join(societiesDir, ".projects", defaultSocietyFor(real, sha256Hex(real)), "config.json");
  return { dir, societiesDir, call, projectId, projectSettings, macPackages: join(dir, "packages"), socketEnv: socketNames.env };
}

test("DR25/mac: packages.sync makes the Mac's packages the engine's store, turns them on in the named project, and follows a removal", TIMEOUT, async t => {
  const w = await world(t);
  macStore(w.macPackages, { "oma-hello-ext": hello });
  const first = await w.call("packages.sync", { projectId: w.projectId }, "pi-1");
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.deepEqual((first.result as { added: string[] }).added, ["npm:oma-hello-ext"]);
  const store = join(w.societiesDir, PACKAGE_STORE);
  assert.ok(lstatSync(store).isSymbolicLink(), "the engine's store is not a link to a generation");
  const firstGeneration = readlinkSync(store);
  pinPackageGeneration(realpathSync(store)); // An engine that can retain old callbacks stays a reader.
  assert.match(firstGeneration, new RegExp(`^${PACKAGE_GENERATIONS}/p-[0-9a-f]{64}$`));
  assert.deepEqual(readPackageIndex(store), [{ source: "npm:oma-hello-ext", entries: [HELLO], skills: [], prompts: [], themes: [] }]);
  const settings = loadConfiguration(w.projectSettings);
  for (const role of [settings.config.principalProfile, "resident"])
    assert.ok(settings.roles[role]!.extensions.some(item => item.path.endsWith("oma-hello-ext/extensions/hello.ts")), role);
  // The same key again is the same answer; nothing is applied twice.
  const again = await w.call("packages.sync", { projectId: w.projectId }, "pi-1");
  assert.deepEqual(again.result, first.result);

  toggleExtension(readExtensions(w.projectSettings, settings.config.principalProfile, "resident", readPackageIndex(store)), HELLO, "workers", false);
  const update = await w.call("packages.sync", { projectId: w.projectId }, "pi-update");
  assert.equal((update.result as { ok: boolean }).ok, true);
  assert.equal(loadConfiguration(w.projectSettings).roles.resident!.extensions.length, 1);
  const manifest = readFileSync(w.projectSettings);
  chmodSync(w.projectSettings, 0o600);
  writeFileSync(w.projectSettings, "{broken");
  const failed = await w.call("packages.sync", { projectId: w.projectId, activate: "npm:oma-hello-ext" }, "pi-failed");
  assert.equal(failed.ok, true, JSON.stringify(failed));
  assert.equal((failed.result as { ok: boolean }).ok, false);
  assert.doesNotMatch(JSON.stringify(failed.result), /: on for this project's/);
  writeFileSync(w.projectSettings, manifest);
  const retried = await w.call("packages.sync", { projectId: w.projectId, activate: "npm:oma-hello-ext" }, "pi-retry");
  assert.equal((retried.result as { ok: boolean }).ok, true, JSON.stringify(retried));
  assert.equal(loadConfiguration(w.projectSettings).roles.resident!.extensions.length, 2);

  // Removed on the Mac: the engine's store follows and every role lets it go.
  rmSync(join(w.macPackages, "npm"), { recursive: true });
  writeFileSync(join(w.macPackages, "settings.json"), JSON.stringify({ packages: [] }));
  const second = await w.call("packages.sync", {}, "pi-2");
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.deepEqual(readPackageIndex(store), []);
  const after = loadConfiguration(w.projectSettings);
  for (const role of Object.keys(after.roles))
    assert.ok(!after.roles[role]!.extensions.some(item => item.path.includes("oma-hello-ext")), role);
  // More publications never establish that readers of older code exited.
  const generations = readdirSync(join(w.societiesDir, PACKAGE_GENERATIONS)).sort();
  assert.ok(generations.includes(firstGeneration.split("/").at(-1)!), "the previous generation was removed");
  macStore(w.macPackages, { "oma-two": { "package.json": JSON.stringify({ name: "oma-two", version: "1.0.0", pi: { extensions: ["./two.ts"] } }),
    "two.ts": "export default function () {}\n" } });
  await w.call("packages.sync", {}, "pi-3");
  assert.ok(readdirSync(join(w.societiesDir, PACKAGE_GENERATIONS)).includes(firstGeneration.split("/").at(-1)!),
    "an old generation was removed without proof that its readers exited");
  // Not named: listed, turned on nowhere.
  assert.ok(!loadConfiguration(w.projectSettings).roles.resident!.extensions.some(item => item.path.includes("oma-two")));
  // A project that was never brought to the engine is refused, not made up.
  const refused = await w.call("packages.sync", { projectId: randomUUID() }, "pi-4");
  assert.equal(refused.ok, false);
  assert.match(JSON.stringify(refused.error), /not been brought to the engine/);
  const malformed = await w.call("packages.sync", { projectId: "../other" }, "pi-5");
  assert.equal(malformed.ok, false);
  assert.match(JSON.stringify(malformed.error), /by its id/);
});

test("DR25/mac: what was staged is taken on only when it is what the Mac declared", async t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-pkg-staged-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ledger = new RequestLedger(join(dir, "requests"));
  const packages = new GuestPackages({ ledger, projects: new GuestProjects(join(dir, "projects"), join(dir, "oma"), ledger),
    dataDir: join(dir, "oma"), libdir: dir, node: process.execPath, entry: "/nonexistent/guest-packages.js", env: {}, timeoutMs: 1000 });
  writeFileSync(ledger.staging("k-1", "bundle"), "arrived");
  await assert.rejects(() => packages.replace("k-1", { archive: { bytes: 7, sha256: "0".repeat(64) } }), /did not arrive as declared/);
  await assert.rejects(() => packages.replace("k-2", { archive: { bytes: 7, sha256: "0".repeat(64) } }), /did not arrive as declared/, "nothing staged");
  await assert.rejects(() => packages.replace("k-3", { archive: "x" }), /archive must be/);
});

test("DR25/mac: a store that is a link to its generation is read, pinned and mounted where the generation is", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const generation = join(f.root, PACKAGE_GENERATIONS, `p-${"a".repeat(64)}`);
    macStore(generation, { "oma-hello-ext": hello });
    writeFileSync(join(generation, "oma-extensions.json"), encodePackageIndex([{ source: "npm:oma-hello-ext", entries: [HELLO], skills: [], prompts: [], themes: [] }]));
    const store = join(f.root, PACKAGE_STORE);
    symlinkSync(`${PACKAGE_GENERATIONS}/p-${"a".repeat(64)}`, store);
    assert.deepEqual(readPackageIndex(store), [{ source: "npm:oma-hello-ext", entries: [HELLO], skills: [], prompts: [], themes: [] }]);
    f.edit("host.json", host => { host.installation.packages = store; });
    f.edit("roles/resident.json", role => { role.extensions = ["packages/extension/dist/index.js", HELLO]; });
    const pinned = loadConfiguration(f.path).roles.resident!.extensions.find(item => item.path.endsWith("hello.ts"))!.path;
    assert.equal(pinned, join(realpathSync(generation), "npm/node_modules/oma-hello-ext/extensions/hello.ts"));
    // The runner mounts the generation itself, so the pinned file is under the mount.
    const dirs = { workspace: "/s/w", home: "/s/h", archive: "/s/a", workerArchive: "/s/wa", selfMail: "/s/m", view: "/s/v", world: "/s/world",
      projectGit: "/s/git", projectMirror: "/s/mirror", sessions: "/s/sessions" };
    assert.equal(confinedPath({ libdir: f.installation, packages: packageStoreRoot(store)! }, dirs, pinned),
      `${RESIDENT_PATHS.packages}/npm/node_modules/oma-hello-ext/extensions/hello.ts`);
    assert.throws(() => confinedPath({ libdir: f.installation, packages: store }, dirs, pinned), /outside every mount/,
      "the link's own path is not where the pinned file is");
  } finally { f.close(); }
});

test("DR25/mac: oma pi install on the Mac installs over the Mac's store and the engine takes it on for the named project", TIMEOUT, async t => {
  const w = await world(t);
  const source = join(w.dir, "src", "oma-hello-ext");
  mkdirSync(join(source, "extensions"), { recursive: true });
  writeFileSync(join(source, "package.json"), JSON.parse(JSON.stringify(hello["package.json"])));
  writeFileSync(join(source, "extensions", "hello.ts"), hello["extensions/hello.ts"]);
  mkdirSync(join(w.dir, "packs"));
  const registry = await fakeNpmRegistry([source], join(w.dir, "packs"));
  t.after(() => registry.close());
  const home = join(w.dir, "user-home"); mkdirSync(home);
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, OMA_HOST_HOME: w.dir, LANG: "C.UTF-8", ...w.socketEnv,
    npm_config_registry: registry.url, npm_config_cache: join(w.dir, "npm-cache"), npm_config_audit: "false", npm_config_fund: "false",
    npm_config_update_notifier: "false" };
  const mac = (...args: string[]) => new Promise<{ status: number | null; out: string }>(resolve => {
    const child = spawn(process.execPath, ["--import", new URL("./fixtures/socket-names.js", import.meta.url).href,
      new URL("../../apps/oma/dist/entry/oma-mac.js", import.meta.url).pathname, "pi", ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; child.stdout.on("data", chunk => { out += chunk; }); child.stderr.on("data", chunk => { out += chunk; });
    const timer = setTimeout(() => { child.kill("SIGKILL"); }, 150_000);
    child.on("close", status => { clearTimeout(timer); resolve({ status, out }); });
  });
  const refused = await mac("install", "--local", "npm:oma-hello-ext");
  assert.notEqual(refused.status, 0);
  assert.match(refused.out, /project's local packages/);
  const installed = await mac("install", "npm:oma-hello-ext", "--project", w.projectId);
  assert.equal(installed.status, 0, installed.out);
  assert.match(installed.out, /on for this project's Principal and Workers/);
  assert.ok(existsSync(join(w.macPackages, "npm/node_modules/oma-hello-ext/extensions/hello.ts")), "the Mac's store has no package");
  assert.deepEqual(readPackageIndex(join(w.societiesDir, PACKAGE_STORE)), [{ source: "npm:oma-hello-ext", entries: [HELLO], skills: [], prompts: [], themes: [] }]);
  assert.deepEqual(readPackageIndex(w.macPackages), [{ source: "npm:oma-hello-ext", entries: [HELLO], skills: [], prompts: [], themes: [] }], "host Personal has no extension index");
  assert.equal(readPersonalSettings(w.dir), null, "install consumed the first Personal project's seed");
  const settings = loadConfiguration(w.projectSettings);
  assert.ok(settings.roles.resident!.extensions.some(item => item.path.endsWith("oma-hello-ext/extensions/hello.ts")));
  const personal = { dataRoot: w.dir, libdir: fileURLToPath(new URL("../../", import.meta.url)), packages: w.macPackages };
  updatePersonalSettings(personal, [HELLO]);
  const updated = await mac("update", "npm:oma-hello-ext");
  assert.equal(updated.status, 0, updated.out);
  assert.deepEqual(readPersonalSettings(w.dir)?.extensions, [HELLO]);
  updatePersonalSettings(personal, [], { entry: HELLO, enabled: false });
  const reinstalled = await mac("install", "npm:oma-hello-ext", "--project", w.projectId);
  assert.equal(reinstalled.status, 0, reinstalled.out);
  assert.deepEqual(readPersonalSettings(w.dir)?.extensions, [], "install changed an independent Personal choice");
  updatePersonalSettings(personal, [], { entry: HELLO, enabled: true });
  const removed = await mac("remove", "npm:oma-hello-ext");
  assert.equal(removed.status, 0, removed.out);
  assert.deepEqual(readPackageIndex(w.macPackages), []);
  assert.deepEqual(readPackageIndex(join(w.societiesDir, PACKAGE_STORE)), []);
  assert.deepEqual(readPersonalSettings(w.dir)?.extensions, [], "removed host package remained selected");
  for (const role of Object.values(loadConfiguration(w.projectSettings).roles))
    assert.ok(!role.extensions.some(item => item.path.includes("oma-hello-ext")));

  // C20 through the whole path: a local directory is staged into the Mac's
  // store, installed there by the engine as `local/<name>`, carried by the
  // archive and indexed identically on both sides.
  const localInstalled = await mac("install", source, "--project", w.projectId);
  assert.equal(localInstalled.status, 0, localInstalled.out);
  const localIndex = [{ source: "local/oma-hello-ext", entries: ["packages:local/oma-hello-ext/extensions/hello.ts"],
    skills: [], prompts: [], themes: [] }];
  assert.ok(existsSync(join(w.macPackages, "local", "oma-hello-ext", "extensions", "hello.ts")), "the staged copy is not in the Mac's store");
  assert.deepEqual(readPackageIndex(w.macPackages), localIndex);
  assert.deepEqual(readPackageIndex(join(w.societiesDir, PACKAGE_STORE)), localIndex, "the guest indexed the carried local package differently");
  const localRemoved = await mac("remove", "local/oma-hello-ext");
  assert.equal(localRemoved.status, 0, localRemoved.out);
  assert.deepEqual(readPackageIndex(w.macPackages), []);
  assert.deepEqual(readPackageIndex(join(w.societiesDir, PACKAGE_STORE)), []);
  assert.equal(readdirSync(join(w.macPackages, "local")).length, 0, "the removed local package's copy stayed behind");
  assert.equal(existsSync(join(home, ".pi")), false, "the user's own Pi was touched");
});

test("DR25/mac: an application stopped after any of its steps, run again for the same request, ends where an uninterrupted one does", TIMEOUT, async t => {
  const libdir = fileURLToPath(new URL("../../", import.meta.url));
  for (const stop of ["recorded", "published", "switched", "collected"] as ApplyStep[]) {
    const dir = mkdtempSync(join(tmpdir(), `oma-pkg-apply-${stop}-`));
    t.after(() => { spawnSync("chmod", ["-R", "u+rwX", dir]); rmSync(dir, { recursive: true, force: true }); });
    const data = join(dir, "oma");
    // The engine's store as the last request left it: a link to an empty generation.
    const old = join(data, PACKAGE_GENERATIONS, `p-${"0".repeat(64)}`);
    mkdirSync(old, { recursive: true });
    writeFileSync(join(old, "oma-extensions.json"), encodePackageIndex([]));
    symlinkSync(`${PACKAGE_GENERATIONS}/p-${"0".repeat(64)}`, join(data, PACKAGE_STORE));
    const mirror = join(dir, "projects", randomUUID());
    mkdirSync(mirror, { recursive: true });
    spawnSync("/usr/bin/git", ["init", "-q", mirror]);
    const mac = join(dir, "mac");
    macStore(mac, { "oma-hello-ext": hello });
    const archive = join(dir, "staged.bundle");
    await writePackageArchive(mac, archive);
    await assert.rejects(() => applyPackageArchive({ data, archive, libdir, mirror }, step => { if (step === stop) throw new Error(`stopped after ${step}`); }),
      /stopped after/);
    const result = await applyPackageArchive({ data, archive, libdir, mirror });
    assert.deepEqual(result.added, ["npm:oma-hello-ext"], `after a stop at ${stop} the package was not found added`);
    assert.deepEqual(readPackageIndex(join(data, PACKAGE_STORE)), [{ source: "npm:oma-hello-ext", entries: [HELLO], skills: [], prompts: [], themes: [] }], stop);
    assert.ok(existsSync(old), `the generation an engine may still read was removed after a stop at ${stop}`);
    assert.deepEqual(readdirSync(join(data, PACKAGE_GENERATIONS)).filter(name => name.startsWith(".staging-")), [], "a staging tree was left");
    const real = realpathSync(mirror);
    const settings = loadConfiguration(join(data, ".projects", defaultSocietyFor(real, sha256Hex(real)), "config.json"));
    for (const role of [settings.config.principalProfile, "resident"])
      assert.ok(settings.roles[role]!.extensions.some(item => item.path.endsWith("oma-hello-ext/extensions/hello.ts")), `${stop}: ${role}`);
  }
});


test("DR37: repeated real packages.sync collects old generations without restarting its publisher", TIMEOUT, async t => {
  const w=await world(t); const store=join(w.societiesDir,PACKAGE_STORE);
  let previous:string|undefined;
  for (const number of [1,2,3]) {
    rmSync(w.macPackages,{recursive:true,force:true});
    const name=`oma-metadata-${number}`;
    macStore(w.macPackages,{[name]:{'package.json':JSON.stringify({name,version:'1.0.0',pi:{extensions:[]}})}});
    const answer=await w.call('packages.sync',{},`collect-${number}`);
    assert.equal(answer.ok,true,JSON.stringify(answer));
    assert.equal((answer.result as {ok:boolean}).ok,true,JSON.stringify(answer));
    assert.equal(readPackageIndex(store)[0]?.source,`npm:${name}`);
    const current=realpathSync(store);
    if(previous)assert.equal(existsSync(previous),false,'the live publisher retained an idle old generation');
    assert.equal(existsSync(join(current,'npm/node_modules',name,'package.json')),true);
    previous=current;
  }
});
