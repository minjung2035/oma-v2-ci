/** Installed Linux adapter: actual assets and pure/live-reader boundaries. No systemd/VM qualification. */
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const hook = registerHooks({ resolve(specifier, context, next) {
  assert.notEqual(specifier, "node:sqlite", "a file/platform API loaded the ledger");
  return next(specifier, context);
} });
try {
  const { UNIT_TPL_DIR, renderUnit } = await import("@oma/platform-linux/units");
  const { sandboxSeccompFilter } = await import("@oma/platform-linux/sandbox-seccomp");
  const values = { node: "/node space/$p%", libdir: "/lib", state: "/state", society: "demo", agent: "worker", modelProfileHex: "6d" };
  assert.equal(renderUnit("@NODE@ @MODEL_PROFILE_HEX@", values), "/node\\x20space/$$p%% 6d");
  assert.match(readFileSync(join(UNIT_TPL_DIR, "resident.service.in"), "utf8"), /MODEL_PROFILE_HEX/);
  assert.ok(sandboxSeccompFilter().byteLength > 0);
  for (const missing of ["@oma/config", "@oma/client", "@oma/engine", "@oma/tui", "@oma/broker", "@oma/mail"])
    assert.throws(() => import.meta.resolve(missing), { code: "ERR_MODULE_NOT_FOUND" });
} finally { hook.deregister(); }
