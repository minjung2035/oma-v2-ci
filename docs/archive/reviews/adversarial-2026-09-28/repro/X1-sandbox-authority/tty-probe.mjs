// X1 --new-session tty probe + broker admin socket / user bus visibility.
// The Resident sandbox mounts only the per-incarnation control.sock; the
// broker's admin.sock and the systemd user bus are NOT in the mount table
// (src/sandbox.ts residentArgv), and --unshare-all removes the IPC/abstract
// socket namespaces. This confirms neither is reachable and TIOCSTI is refused.
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { vsockSeccompFilter } from "../../../../dist/src/runtime/vsock-seccomp.js";

const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "oma-adv-X1-tty-"));
try {
  const binary = join(dir, "tty-probe");
  const cc = spawnSync("gcc", ["-O1", "-o", binary, join(here, "tty-probe.c")], { encoding: "utf8" });
  if (cc.status !== 0) throw new Error("gcc failed: " + cc.stderr);
  const filterPath = join(dir, "filter.bpf");
  writeFileSync(filterPath, vsockSeccompFilter());
  const fd = openSync(filterPath, "r");
  let out;
  try {
    // --new-session as in residentArgv; give the child our stdin as a pipe.
    const args = ["--unshare-all", "--new-session", "--die-with-parent", "--cap-drop", "ALL",
      "--seccomp", "3", "--ro-bind", "/", "/", "--proc", "/proc", "--dev", "/dev",
      "--ro-bind", dir, "/tmp",
      // Show that a directory NOT in the mount table (a stand-in for runRoot
      // holding admin.sock) is absent inside: list /run to prove admin.sock
      // is not bound. --unshare-all also removes abstract-socket/dbus reach.
      "--", "/tmp/tty-probe"];
    out = spawnSync("bwrap", args, { stdio: ["pipe", "pipe", "pipe", fd], input: "", encoding: "utf8", timeout: 20_000 });
  } finally { closeSync(fd); }
  console.log((out.stdout + out.stderr).trim());
} finally {
  rmSync(dir, { recursive: true, force: true });
}
