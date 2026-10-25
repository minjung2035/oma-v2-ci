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
  const { GUEST_IMAGE_ASSETS } = await import("@oma/platform-linux/guest-assets");
  const { linuxGuestSystem } = await import("@oma/platform-linux/guest-system");
  const { sandboxSeccompFilter } = await import("@oma/platform-linux/sandbox-seccomp");
  const values = { node: "/node space/$p%", libdir: "/lib", state: "/state", society: "demo", agent: "worker", modelProfileHex: "6d" };
  assert.equal(renderUnit("@NODE@ @MODEL_PROFILE_HEX@", values), "/node\\x20space/$$p%% 6d");
  assert.match(readFileSync(join(UNIT_TPL_DIR, "resident.service.in"), "utf8"), /MODEL_PROFILE_HEX/);
  assert.match(readFileSync(join(GUEST_IMAGE_ASSETS, "systemd", "oma-guestctl.service"), "utf8"), /ExecStopPost=.*--thaw/);
  assert.match(readFileSync(join(GUEST_IMAGE_ASSETS, "bridge", "oma-vsock-bridge.c"), "utf8"), /LISTEN_PID/);
  assert.ok(sandboxSeccompFilter().byteLength > 0);
  let horizon = { kind: "none" }, reads = 0;
  const system = linuxGuestSystem("/not-opened", () => { reads++; return horizon; });
  assert.equal(system.receiptWaitFloor(), horizon);
  horizon = { kind: "unknown" }; assert.equal(system.receiptWaitFloor(), horizon);
  assert.equal(reads, 2, "current configuration observation is never cached as absence");
  for (const missing of ["@oma/config", "@oma/client", "@oma/engine", "@oma/tui", "@oma/broker", "@oma/mail"])
    assert.throws(() => import.meta.resolve(missing), { code: "ERR_MODULE_NOT_FOUND" });
} finally { hook.deregister(); }
