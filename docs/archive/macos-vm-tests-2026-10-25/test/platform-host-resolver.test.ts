/** macos-platform §7 (MAC-701, MAC-702, MAC-704): the host resolves a run's
 * provider from its own engine state, with the credential in the Keychain
 * (an in-memory stand-in here; the real one is the Swift helper's). */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StoreError } from "@oma/domain/errors";
import { keychainCredentials } from "#oma-test/app/runtime/keychain-credentials";
import { type KeychainStore } from "@oma/contracts/credentials";
import { hostResolver } from "#oma-test/app/platform/host/resolver";
import { ProcessLock } from "@oma/native/process-lock";
import { renameSync } from "node:fs";
import { setTimeout as pause } from "node:timers/promises";
import { spawn } from "node:child_process";

const KEY = "sk-ant-api03-" + "k".repeat(40);
function memoryKeychain(initial: Record<string, string> = {}): KeychainStore & { items: Map<string, string>; locked: boolean; writes: number } {
  const keychain = {
    items: new Map(Object.entries(initial)), locked: false, writes: 0,
    async get(account: string) { if (keychain.locked) throw new StoreError("BROKER_UNAVAILABLE", "the keychain is locked"); return keychain.items.get(account); },
    async put(account: string, value: string) { if (keychain.locked) throw new StoreError("BROKER_UNAVAILABLE", "the keychain is locked"); keychain.writes += 1; keychain.items.set(account, value); },
  };
  return keychain;
}
async function withoutEnv<T>(name: string, value: string | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
  try { return await run(); } finally { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; }
}
const code = (expected: string) => (error: unknown) => error instanceof StoreError && error.code === expected;

test("MAC-704: the host's own settings pick the model and the Keychain holds the key; no credential file is written", async t => {
  const engineDir = mkdtempSync(join(tmpdir(), "oma-engine-"));
  t.after(() => rmSync(engineDir, { recursive: true, force: true }));
  writeFileSync(join(engineDir, "settings.json"), JSON.stringify({ defaultProvider: "anthropic", defaultModel: "claude-fable-5" }));
  // Another item this app does not keep is refused even though it would resolve.
  const keychain = memoryKeychain({ "engine-managed": JSON.stringify({ anthropic: { type: "api_key", key: KEY } }),
    "somewhere-else": JSON.stringify({ anthropic: { type: "api_key", key: KEY } }) });
  const resolve = hostResolver(engineDir, keychain);
  const auth = await withoutEnv("ANTHROPIC_API_KEY", undefined, () => resolve("engine-managed", "pi", "current"));
  assert.equal(`${auth.provider}/${auth.model}`, "anthropic/claude-fable-5");
  assert.equal(auth.apiKey, KEY);
  assert.equal(auth.origin, "https://api.anthropic.com");
  assert.equal(existsSync(join(engineDir, "auth.json")), false, "the credential lives only in the Keychain");
  for (const name of readdirSync(engineDir))
    assert.equal(readFileSync(join(engineDir, name), "utf8").includes(KEY), false, `${name} holds no key`);
  await assert.rejects(resolve("somewhere-else", "anthropic", "claude-fable-5"), code("UNSUPPORTED_PROFILE"));
});

test("MAC-702: a Keychain that cannot be read fails the resolution; no other credential stands in", async t => {
  const engineDir = mkdtempSync(join(tmpdir(), "oma-engine-"));
  t.after(() => rmSync(engineDir, { recursive: true, force: true }));
  const keychain = memoryKeychain({ "engine-managed": JSON.stringify({ anthropic: { type: "api_key", key: KEY } }) });
  keychain.locked = true;
  const resolve = hostResolver(engineDir, keychain);
  await withoutEnv("ANTHROPIC_API_KEY", "sk-ant-api03-" + "e".repeat(40), async () => {
    await assert.rejects(resolve("engine-managed", "anthropic", "claude-fable-5"),
      (error: unknown) => !(typeof error === "object" && error !== null && "apiKey" in error));
  });
});

test("§7.2: writes to the credential are serialized, each seeing the one before", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-credential-current-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const keychain = memoryKeychain();
  const store = keychainCredentials(keychain, "engine-managed", join(root, "writer.lock"));
  await Promise.all(["a", "b", "c"].map(provider => store.modify(provider, async current => {
    assert.equal(current, undefined);
    await new Promise(r => setTimeout(r, 5));
    return { type: "api_key", key: `${provider}-key` } as never;
  })));
  assert.deepEqual(Object.keys(JSON.parse(keychain.items.get("engine-managed")!)).sort(), ["a", "b", "c"], "no write lost another's");
  assert.deepEqual((await store.list()).map(entry => entry.providerId).sort(), ["a", "b", "c"]);
  await store.delete("b");
  assert.equal(await store.read("b"), undefined);
});

for (const value of ["{", "null", "[]"]) test(`Keychain credential owner: corrupt ${value} is not an empty blob`, async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-credential-corrupt-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const keychain = memoryKeychain({ "engine-managed": value }), store = keychainCredentials(keychain, "engine-managed", join(root, "writer.lock"));
  await assert.rejects(store.read("fixture"), code("STORE_CORRUPT"));
  await assert.rejects(store.list(), code("STORE_CORRUPT"));
  await assert.rejects(store.modify("fixture", async () => ({ type: "api_key", key: "fixture" }) as never), code("STORE_CORRUPT"));
  await assert.rejects(store.delete("fixture"), code("STORE_CORRUPT"));
  assert.equal(keychain.writes, 0); assert.equal(keychain.items.get("engine-managed"), value);
});

test("Keychain credential owner: helper actual close, not successful put, returns the writer lock", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-keychain-lock-")), lockPath = join(root, "credentials.lock");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const keychain = memoryKeychain(); let returned = false, finish!: () => void, acquired!: () => void;
  const entered = new Promise<void>(resolve => { acquired = resolve; });
  const store = keychainCredentials({ ...keychain, async withWriter(fence, run) {
    assert.ok(Number.isInteger(fence)); assert.equal(ProcessLock.tryAcquire(lockPath), null);
    const result = await run(keychain); acquired();
    await new Promise<void>(resolve => { finish = resolve; }); return result;
  } }, "engine-managed", lockPath);
  const result = store.modify("fixture", async () => ({ type: "api_key", key: "local-fixture" }) as never).then(() => { returned = true; });
  await entered; assert.equal(keychain.writes, 1); assert.equal(returned, false);
  assert.equal(ProcessLock.tryAcquire(lockPath), null);
  finish(); await result;
  const lock = ProcessLock.tryAcquire(lockPath); assert.ok(lock); lock.close();
});

test("Keychain credential owner: abort while waiting for another process lock writes nothing", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-keychain-abort-")), lockPath = join(root, "credentials.lock");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const held = ProcessLock.acquire(lockPath), keychain = memoryKeychain(), controller = new AbortController();
  try {
    const store = keychainCredentials(keychain, "engine-managed", lockPath);
    const pending = store.modify("fixture", async () => ({ type: "api_key", key: "fixture" }) as never, { signal: controller.signal });
    const refused = assert.rejects(pending, error => error instanceof Error && error.name === "AbortError");
    await pause(35); controller.abort(); await refused;
    assert.equal(keychain.writes, 0); assert.equal(ProcessLock.tryAcquire(lockPath), null);
  } finally { held.close(); }
});

test("Keychain credential owner: a replaced lock pathname after the callback cannot authorize put", async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-keychain-inode-")), lockPath = join(root, "credentials.lock");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const keychain = memoryKeychain(), store = keychainCredentials(keychain, "engine-managed", lockPath);
  await assert.rejects(store.modify("fixture", async () => {
    renameSync(lockPath, join(root, "old.lock")); writeFileSync(lockPath, "");
    return { type: "api_key", key: "fixture" } as never;
  }), code("BROKER_UNAVAILABLE"));
  assert.equal(keychain.writes, 0);
  const lock = ProcessLock.tryAcquire(join(root, "old.lock")); assert.ok(lock); lock.close();
});

test("Keychain credential owner: concurrent processes reread the previous committed fixture blob", { timeout: 10_000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "oma-keychain-processes-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const blob = join(root, "fixture-credentials.json"), lockPath = join(root, "credentials.lock");
  writeFileSync(blob, "{}");
  const module = new URL(import.meta.resolve("#oma-test/app/runtime/keychain-credentials")).href;
  const script = `import { readFileSync, writeFileSync } from "node:fs";
import { keychainCredentials } from ${JSON.stringify(module)};
import { setTimeout as pause } from "node:timers/promises";
const store = keychainCredentials({ async get() { return readFileSync(${JSON.stringify(blob)}, "utf8"); },
  async put(_account, value) { writeFileSync(${JSON.stringify(blob)}, value); } }, "fixture", ${JSON.stringify(lockPath)});
await store.modify(process.argv[1], async current => { if (current !== undefined) throw new Error("not first");
  await pause(40); return { type: "api_key", key: "local-fixture" }; });`;
  await Promise.all(["a", "b", "c", "d"].map(provider => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script, provider], { env: { PATH: "/usr/bin:/bin", HOME: root }, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = ""; child.stderr.on("data", chunk => { stderr += chunk; }); child.on("error", reject);
    child.once("close", status => { if (status === 0) resolve(); else reject(new Error(`fixture process failed: ${stderr}`)); });
  })));
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(blob, "utf8"))).sort(), ["a", "b", "c", "d"]);
  const lock = ProcessLock.tryAcquire(lockPath); assert.ok(lock); lock.close();
});
