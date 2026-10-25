/** Compile the actual owned bridge and test its activation refusal, without a vsock device. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("Linux bridge: the actual C source compiles and refuses a missing socket activation", t => {
  const dir = mkdtempSync(join(tmpdir(), "oma-bridge-admission-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const binary = join(dir, "bridge");
  const built = spawnSync("cc", ["-O2", "-Wall", "-Wextra", "-o", binary,
    fileURLToPath(new URL("../dist/guest/bridge/oma-vsock-bridge.c", import.meta.url))], { encoding: "utf8", timeout: 30_000 });
  assert.equal(built.error, undefined); assert.equal(built.signal, null); assert.equal(built.status, 0, built.stderr);
  const refused = spawnSync(binary, [join(dir, "unbound-service.sock")], { env: {}, encoding: "utf8", timeout: 5000 });
  assert.equal(refused.error, undefined); assert.equal(refused.signal, null); assert.equal(refused.status, 2, refused.stderr);
});
