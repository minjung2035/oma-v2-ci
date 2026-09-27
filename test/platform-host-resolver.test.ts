/** macos-platform §7 (MAC-701, MAC-702, MAC-704): the host resolves a run's
 * provider from its own engine state, with the credential in the Keychain
 * (an in-memory stand-in here; the real one is the Swift helper's). */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StoreError } from "../src/domain/errors.js";
import { keychainCredentials, type KeychainStore } from "../src/platform/host/keychain.js";
import { hostResolver } from "../src/platform/host/resolver.js";

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

test("§7.2: writes to the credential are serialized, each seeing the one before", async () => {
  const keychain = memoryKeychain();
  const store = keychainCredentials(keychain, "engine-managed");
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
