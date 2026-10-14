// X1 keyring host-visibility: add a key inside the sandbox, then from the HOST
// (no sandbox) enumerate /proc/keys and the _uid keyring to see whether the
// key the sandbox added is present on the host side. This distinguishes:
//   (i) sandbox writes to the real per-uid keyring shared with the host, vs
//   (ii) --unshare-user gives the sandbox its own keyring namespace.
// The add is left, checked, then revoked from inside a second sandbox call.
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { vsockSeccompFilter } from "../../../../dist/src/runtime/vsock-seccomp.js";

const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "oma-adv-X1-khost-"));
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
  const name = "oma-adv-x1-hostvis-" + Math.floor(Math.random() * 1e9);
  const before = readFileSync("/proc/keys", "utf8");
  const added = sandbox(["add", name, "payload-x1"]);
  console.log("sandbox add: " + added);
  const after = readFileSync("/proc/keys", "utf8");
  const serial = /serial=(\d+)/.exec(added)?.[1];
  const hexSerial = serial ? Number(serial).toString(16).padStart(8, "0") : null;
  const hostSeesSerial = hexSerial ? after.includes(hexSerial) : false;
  const hostKeyCountDelta = after.split("\n").length - before.split("\n").length;
  console.log("host /proc/keys sees the sandbox key serial: " + hostSeesSerial + " (line delta " + hostKeyCountDelta + ")");
  // host-side find using keyctl via the same binary run WITHOUT sandbox:
  const hostFind = spawnSync(binary, ["find", name], { encoding: "utf8" });
  console.log("host find (no sandbox): " + (hostFind.stdout + hostFind.stderr).trim());
  if (serial) console.log("cleanup: " + sandbox(["revoke", serial]));
  console.log(hostSeesSerial
    ? "\nHOST-VISIBLE: the key the sandbox added is on the host's per-uid keyring — a shared kernel object."
    : "\nnot host-visible: the sandbox's add stayed in its own userns keyring on this kernel.");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
