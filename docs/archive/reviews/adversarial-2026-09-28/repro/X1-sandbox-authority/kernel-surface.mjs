// X1 kernel-object surface probe driver.
//
// Runs kernel-surface.c inside bubblewrap with the exact isolation flags the
// Resident sandbox uses (src/sandbox.ts residentArgv):
//   --unshare-all --new-session --die-with-parent --cap-drop ALL --seccomp <fd>
// plus --proc /proc --dev /dev, and the real vsock seccomp filter on fd 3.
//
// It also runs once WITHOUT the seccomp filter to show what the filter changes.
// No host writes; probe reads/queries only. Temporaries under mkdtemp.
//
// Usage from repo root:
//   timeout 60 node review/adversarial-2026-09-28/repro/X1-sandbox-authority/kernel-surface.mjs
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { vsockSeccompFilter } from "../../../../dist/src/runtime/vsock-seccomp.js";

const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "oma-adv-X1-"));
try {
  const binary = join(dir, "kernel-surface");
  const cc = spawnSync("gcc", ["-O1", "-o", binary, join(here, "kernel-surface.c")], { encoding: "utf8" });
  if (cc.status !== 0) throw new Error("gcc failed: " + cc.stderr);

  const run = (withFilter) => {
    const filterPath = join(dir, "filter.bpf");
    writeFileSync(filterPath, withFilter ? vsockSeccompFilter() : Buffer.alloc(0));
    const fd = openSync(filterPath, "r");
    try {
      const args = ["--unshare-all", "--new-session", "--die-with-parent", "--cap-drop", "ALL",
        ...(withFilter ? ["--seccomp", "3"] : []),
        "--ro-bind", "/", "/", "--proc", "/proc", "--dev", "/dev",
        "--ro-bind", dir, "/tmp", "--", "/tmp/kernel-surface"];
      const out = spawnSync("bwrap", args, { stdio: ["ignore", "pipe", "pipe", fd], encoding: "utf8", timeout: 30_000 });
      return (out.stdout + out.stderr).trim();
    } finally { closeSync(fd); }
  };

  console.log("=== WITHOUT seccomp filter (bwrap isolation only) ===");
  console.log(run(false));
  console.log("\n=== WITH the Resident vsock seccomp filter ===");
  console.log(run(true));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
