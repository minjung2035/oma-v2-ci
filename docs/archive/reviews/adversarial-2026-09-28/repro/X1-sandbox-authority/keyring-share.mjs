// X1 keyring cross-sandbox sharing driver.
//
// Sandbox A (Resident 1) adds a "user" key to the user keyring. Sandbox B
// (Resident 2), a SEPARATE bwrap invocation with the same Resident isolation
// flags (--unshare-all --new-session --die-with-parent --cap-drop ALL +
// vsock seccomp), searches for it. If B finds A's key, the user keyring is a
// kernel object shared across Resident sandboxes of the same uid, i.e. the
// user namespace does NOT isolate it. The key is revoked at the end.
//
// Usage: timeout 60 node review/adversarial-2026-09-28/repro/X1-sandbox-authority/keyring-share.mjs
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { vsockSeccompFilter } from "../../../../dist/src/runtime/vsock-seccomp.js";

const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "oma-adv-X1-keyring-"));
try {
  const binary = join(dir, "keyring-share");
  const cc = spawnSync("gcc", ["-O1", "-o", binary, join(here, "keyring-share.c")], { encoding: "utf8" });
  if (cc.status !== 0) throw new Error("gcc failed: " + cc.stderr);

  const filterPath = join(dir, "filter.bpf");
  writeFileSync(filterPath, vsockSeccompFilter());

  const sandbox = (probeArgs) => {
    const fd = openSync(filterPath, "r");
    try {
      const args = ["--unshare-all", "--new-session", "--die-with-parent", "--cap-drop", "ALL",
        "--seccomp", "3", "--ro-bind", "/", "/", "--proc", "/proc", "--dev", "/dev",
        "--ro-bind", dir, "/tmp", "--", "/tmp/keyring-share", ...probeArgs];
      const out = spawnSync("bwrap", args, { stdio: ["ignore", "pipe", "pipe", fd], encoding: "utf8", timeout: 20_000 });
      return (out.stdout + out.stderr).trim();
    } finally { closeSync(fd); }
  };

  const name = "oma-adv-x1-shared-" + Math.floor(Math.random() * 1e9);
  const payload = "secret-from-resident-A";
  const added = sandbox(["add", name, payload]);
  console.log("sandbox A (Resident 1) add:  " + added);
  const found = sandbox(["find", name]);
  console.log("sandbox B (Resident 2) find: " + found);
  const serial = /serial=(\d+)/.exec(added)?.[1];
  if (serial) console.log("cleanup:                     " + sandbox(["revoke", serial]));

  if (found.startsWith("FOUND") && found.includes(payload))
    console.log("\nSHARED: a Resident sandbox's key is visible and readable in a separate Resident sandbox — the user keyring is not isolated by the user namespace.");
  else
    console.log("\nnot shared on this kernel.");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
