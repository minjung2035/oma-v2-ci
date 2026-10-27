// X1 keyring quota exhaustion driver. Runs keyring-quota.c inside a Resident
// sandbox (real isolation flags + vsock seccomp). The probe fills the shared
// per-uid keyring until EDQUOT and self-cleans. Confirms the quota that the
// broker/Principal/other Residents share is reachable and exhaustible from
// inside one Resident sandbox.
//
// Usage: timeout 60 node review/adversarial-2026-09-28/repro/X1-sandbox-authority/keyring-quota.mjs
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { vsockSeccompFilter } from "../../../../dist/src/runtime/vsock-seccomp.js";

const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "oma-adv-X1-quota-"));
try {
  const binary = join(dir, "keyring-quota");
  const cc = spawnSync("gcc", ["-O1", "-o", binary, join(here, "keyring-quota.c")], { encoding: "utf8" });
  if (cc.status !== 0) throw new Error("gcc failed: " + cc.stderr);
  const filterPath = join(dir, "filter.bpf");
  writeFileSync(filterPath, vsockSeccompFilter());
  let maxkeys = "?";
  try { maxkeys = readFileSync("/proc/sys/kernel/keys/maxkeys", "utf8").trim(); } catch {}
  const fd = openSync(filterPath, "r");
  let out;
  try {
    const args = ["--unshare-all", "--new-session", "--die-with-parent", "--cap-drop", "ALL",
      "--seccomp", "3", "--ro-bind", "/", "/", "--proc", "/proc", "--dev", "/dev",
      "--ro-bind", dir, "/tmp", "--", "/tmp/keyring-quota"];
    out = spawnSync("bwrap", args, { stdio: ["ignore", "pipe", "pipe", fd], encoding: "utf8", timeout: 30_000 });
  } finally { closeSync(fd); }
  const text = (out.stdout + out.stderr).trim();
  console.log("per-uid maxkeys = " + maxkeys);
  console.log(text);
  const m = /added=(\d+) stopped_errno=(\d+)/.exec(text);
  if (m && Number(m[1]) > 0 && /EDQUOT|Disk quota exceeded/.test(text))
    console.log("\nEXHAUSTIBLE: one Resident sandbox filled the shared per-uid keyring to its quota (EDQUOT). Every process of this uid that then needs add_key is refused until these are freed.");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
