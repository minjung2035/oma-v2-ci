/** Installed credential adapter closure; no release Keychain qualification. */
import assert from "node:assert/strict";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MAC_HELPER_SOURCES } from "@oma/platform-mac/native-assets";
import { bundledKeychainHelper, nativeKeychainStore } from "@oma/platform-mac/keychain-client";
import { machoImageCdHashes } from "@oma/platform-mac/macho-image";
import { bundledJobHelper, encodeDarwinJob } from "@oma/platform-mac/job-launch";
assert.ok(readFileSync(join(MAC_HELPER_SOURCES, "main.swift"), "utf8").includes("SecItemCopyMatching"));
assert.equal(bundledKeychainHelper("/install"), "/install/packages/platform-mac/dist/keychain/oma-keychain");
if (process.platform === "darwin") {
  const helper = lstatSync(join(MAC_HELPER_SOURCES, "oma-keychain"));
  assert.ok(helper.isFile() && (helper.mode & 0o111) !== 0, "installed Mac package requires its compiled Keychain helper");
  assert.ok(machoImageCdHashes(readFileSync(process.execPath), process.arch).length > 0);
  const job = lstatSync(bundledJobHelper());
  assert.ok(job.isFile() && (job.mode & 0o111) !== 0, "installed Mac package requires its compiled job helper");
  assert.ok(machoImageCdHashes(readFileSync(bundledJobHelper()), process.arch).length > 0);
} else {
  assert.throws(() => machoImageCdHashes(readFileSync(process.execPath), "arm64"), { code: "UNSUPPORTED_PROFILE" });
}
assert.equal(Buffer.from(encodeDarwinJob({ executable: "/trusted/node", argv: ["literal"], env: {},
  timeoutMs: null, stdoutBytes: 0, stderrBytes: 0 }, [0, 1, 2], 1)).subarray(0, 8).toString(), "OMAJOB1\0");
const calls = [];
const store = nativeKeychainStore(async (op, fields) => { calls.push([op, fields.account]); return op === "keychain.get" ? { value: "fixture-only" } : {}; });
assert.equal(await store.get("engine-managed"), "fixture-only");
await store.put("engine-managed", "fixture-only");
assert.deepEqual(calls, [["keychain.get", "engine-managed"], ["keychain.put", "engine-managed"]]);
for (const absent of ["@oma/engine", "@oma/client", "@oma/config", "@oma/tui", "@oma/broker", "@oma/git"])
  assert.throws(() => import.meta.resolve(absent), { code: "ERR_MODULE_NOT_FOUND" });

// Installed public Seatbelt preparation is TS-only; this does not qualify the
// kernel sandbox or the descendant scope on this installation host.
const { prepareSeatbelt } = await import("@oma/platform-mac/seatbelt");
const recipe = prepareSeatbelt({ executable: "/pinned/node", argv: ["a literal argument"],
  env: { HOME: "/private/work", TMPDIR: "/private/work" }, cwd: "/private/work",
  timeoutMs: null, stdoutBytes: 0, stderrBytes: 0 }, { readable: [],
  writable: [{ path: "/private/work", kind: "directory" }], denied: [],
  executable: [{ path: "/pinned/node", kind: "file" }], unixSockets: [], machServices: [], environmentKeys: ["HOME", "TMPDIR"] });
assert.ok(recipe.command.executable.endsWith("/seatbelt/oma-seatbelt"));
assert.deepEqual(recipe.command.argv.slice(-2), ["/pinned/node", "a literal argument"]);
const launcher = readFileSync(new URL("./seatbelt/main.c", import.meta.resolve("@oma/platform-mac/seatbelt")), "utf8");
assert.ok(launcher.includes("sandbox_init(profile"));
const { observeDarwinJobScope, acquireDarwinJobScope } = await import("@oma/platform-mac/job-recovery");
const legacy = { kind: "darwin-audit-session", auditSession: 1, coalitionId: "2", pid: 3, pidVersion: 4 };
assert.deepEqual(observeDarwinJobScope(legacy), { kind: "unavailable" });
assert.throws(() => acquireDarwinJobScope(legacy), { code: "RUN_TERMINATION_UNKNOWN" });
