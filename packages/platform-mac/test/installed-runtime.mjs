/** Installed credential adapter closure; no release Keychain qualification. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAC_HELPER_SOURCES } from "@oma/platform-mac/native-assets";
import { bundledKeychainHelper, nativeKeychainStore } from "@oma/platform-mac/keychain-client";
assert.ok(readFileSync(join(MAC_HELPER_SOURCES, "main.swift"), "utf8").includes("SecItemCopyMatching"));
assert.equal(bundledKeychainHelper("/install"), "/install/packages/platform-mac/dist/keychain/oma-keychain");
const calls = [];
const store = nativeKeychainStore(async (op, fields) => { calls.push([op, fields.account]); return op === "keychain.get" ? { value: "fixture-only" } : {}; });
assert.equal(await store.get("engine-managed"), "fixture-only");
await store.put("engine-managed", "fixture-only");
assert.deepEqual(calls, [["keychain.get", "engine-managed"], ["keychain.put", "engine-managed"]]);
for (const absent of ["@oma/engine", "@oma/client", "@oma/config", "@oma/tui", "@oma/broker", "@oma/git"])
  assert.throws(() => import.meta.resolve(absent), { code: "ERR_MODULE_NOT_FOUND" });
