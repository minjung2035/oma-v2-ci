/** The guest's first-boot step (MAC-303): make the data disk if, and only
 * if, it was handed over to be made; then mount it and check whose it is.
 * guestctl and guesthost start only after this succeeded.
 *
 * usage: guest-provision.js --device /dev/vdc --mount /var/lib/oma
 */
import { chownSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ensureOwnedDirectory } from "@oma/storage/directory";
import { runProcess } from "@oma/process/run";
import { systemUser } from "../platform/guest/identity.js";
import {
  allZero, hasFilesystem, instanceCheck, makeFilesystem, parseCmdline, provisionDecision, readInstance, writeInstance,
} from "../platform/guest/provision.js";

function fail(message: string): never { process.stderr.write(`guest-provision: ${message}\n`); process.exit(1); }
const argOf = (flag: string): string => {
  const at = process.argv.indexOf(flag);
  if (at < 0 || process.argv[at + 1] === undefined) fail(`${flag} is required`);
  return process.argv[at + 1]!;
};
const device = argOf("--device");
const mount = argOf("--mount");

async function main(): Promise<void> {
  const boot = parseCmdline(readFileSync("/proc/cmdline", "utf8"));
  const decision = provisionDecision({ ...boot, hasFilesystem: await hasFilesystem(device), neverWritten: () => allZero(device) });
  if (decision.kind === "refuse") fail(decision.reason);
  if (decision.kind === "format") await makeFilesystem(device);
  // P0-8/DR32: the mount point is oma's own leaf on the guest's root; the
  // root itself is never repaired.
  ensureOwnedDirectory(mount, mount);
  const mounted = await runProcess({ executable: "/usr/bin/mount", argv: ["-o", "errors=remount-ro,data=ordered", device, mount],
    env: { PATH: "/usr/sbin:/usr/bin" }, timeoutMs: 5 * 60_000, stdoutBytes: 64 * 1024, stderrBytes: 64 * 1024 });
  if (mounted.kind !== "exited" || mounted.exitCode !== 0) fail("the data disk could not be mounted");
  const check = instanceCheck(readInstance(mount), boot.instance!, decision.kind === "format");
  if (check === "write") {
    writeInstance(mount, boot.instance!);
    // The oma user's parts of the disk (§5.3).
    const oma = systemUser("oma");
    for (const part of ["data", "projects", "requests", "home"]) {
      ensureOwnedDirectory(join(mount, part), mount, 0o700);
      chownSync(join(mount, part), oma.uid, oma.gid);
    }
  } else if (check !== "ok") fail(check);
}
main().catch(error => { fail(error instanceof Error ? error.message : String(error)); });
