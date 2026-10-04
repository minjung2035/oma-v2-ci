/** The guest's half of MAC-303: the state disk is made once, and only a disk
 * that was never written is ever formatted.
 *
 * The host passes `oma.instance=<id>` on every boot and `oma.provision=<id>`
 * only when its record says provisioning is pending and the disk image has no
 * allocated block. The guest formats only when that flag names this instance
 * and every byte of the device is zero -- read in full, once, at the first
 * boot. A disk with no file system in any other case (a damaged superblock
 * looks just like that at its start) is refused and left as it is for the
 * repair path. A disk that mounts must say it belongs to this instance.
 */
import { closeSync, openSync, readFileSync, readSync, constants } from "node:fs";
import { join } from "node:path";
import { StoreError } from "../../domain/errors.js";
import { runProcess, type CommandSpec } from "../../process/run.js";
import { isUuid } from "../../protocol/host-guest.js";
import { INSTANCE_FILE, INSTANCE_KIND } from "./identity.js";
import { ensureOwnedDurableDirectory, publishNoReplace } from "../../storage/durable-fs.js";

export interface BootFacts {
  /** `oma.instance=` from the kernel command line. */
  readonly instance: string | null;
  /** `oma.provision=` from the kernel command line. */
  readonly provision: string | null;
  readonly hasFilesystem: boolean;
  /** Asked only when it decides anything: reading a whole disk is not free. */
  readonly neverWritten: () => boolean;
}
export type ProvisionDecision =
  | { readonly kind: "format" }
  | { readonly kind: "mount" }
  | { readonly kind: "refuse"; readonly reason: string };

export function provisionDecision(facts: BootFacts): ProvisionDecision {
  if (!isUuid(facts.instance)) return { kind: "refuse", reason: "the boot names no engine instance" };
  if (facts.hasFilesystem) return { kind: "mount" };
  if (facts.provision === facts.instance && facts.neverWritten()) return { kind: "format" };
  return { kind: "refuse", reason: "the data disk has no file system and was not handed over to be made; it is left for repair" };
}

/** After mounting: the disk's record of whose it is. A disk just made gets
 * one; any other disk must already carry this instance's. */
export function instanceCheck(recorded: string | null, instance: string, formatted: boolean): "write" | "ok" | string {
  if (recorded === null) return formatted ? "write" : "the data disk does not say which engine it belongs to";
  return recorded === instance ? "ok" : "the data disk belongs to another engine instance";
}

export function parseCmdline(text: string): { instance: string | null; provision: string | null } {
  const value = (name: string): string | null => {
    const found = text.split(/\s+/).find(item => item.startsWith(`${name}=`));
    return found === undefined ? null : found.slice(name.length + 1);
  };
  return { instance: value("oma.instance"), provision: value("oma.provision") };
}

const command = (executable: string, argv: readonly string[], timeoutMs: number): CommandSpec =>
  ({ executable, argv, env: { PATH: "/usr/sbin:/usr/bin" }, timeoutMs, stdoutBytes: 64 * 1024, stderrBytes: 64 * 1024 });

/** Every byte of the device is zero. */
export function allZero(device: string): boolean {
  const fd = openSync(device, constants.O_RDONLY);
  try {
    const buffer = Buffer.alloc(4 * 1024 * 1024);
    for (let position = 0; ; ) {
      const count = readSync(fd, buffer, 0, buffer.length, position);
      if (count === 0) return true;
      for (let at = 0; at < count; at++) if (buffer[at] !== 0) return false;
      position += count;
    }
  } finally { closeSync(fd); }
}

/** Whether the device carries any file system signature (blkid's probe).
 * blkid exits 2 both for "nothing found" and for a device it could not read,
 * so the device is opened here first, and a 2 that came with an error is not
 * taken for a blank disk (P0-5). */
export async function hasFilesystem(device: string): Promise<boolean> {
  try { closeSync(openSync(device, constants.O_RDONLY)); }
  catch { throw new StoreError("BROKER_UNAVAILABLE", "the data disk could not be read"); }
  const probed = await runProcess(command("/usr/sbin/blkid", ["-p", "-o", "value", "-s", "TYPE", device], 30_000));
  if (probed.kind !== "exited") throw new StoreError("BROKER_UNAVAILABLE", "the data disk could not be probed");
  if (probed.exitCode === 0) return true;
  if (probed.exitCode === 2 && probed.stderr.length === 0) return false;
  throw new StoreError("BROKER_UNAVAILABLE", "the data disk could not be probed");
}

export async function makeFilesystem(device: string): Promise<void> {
  const made = await runProcess(command("/usr/sbin/mkfs.ext4", ["-q", "-L", "oma-state", "-E", "lazy_itable_init=0,lazy_journal_init=0", device], 10 * 60_000));
  if (made.kind !== "exited" || made.exitCode !== 0) throw new StoreError("INTERNAL_ERROR", "the data disk could not be made");
}

export function readInstance(mount: string): string | null {
  let text: string;
  try { text = readFileSync(join(mount, INSTANCE_FILE), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  const value = JSON.parse(text) as Record<string, unknown>;
  if (value.kind !== INSTANCE_KIND || !isUuid(value.instanceId)) throw new StoreError("STORE_CORRUPT", "the data disk's record is damaged");
  return value.instanceId;
}

/** P0V-106 (X2-03): the record is published whole under its name -- a
 * flushed temporary linked in without replacing one, the directory flushed
 * (the core's no-replace publication) -- so an interrupted first boot leaves
 * no record rather than a damaged one, and the next boot provisions again. */
export function writeInstance(mount: string, instance: string): void {
  // P0-8/DR32: the mount point is oma's own leaf on the guest's root.
  ensureOwnedDurableDirectory(mount, mount, 0o755);
  const path = join(mount, INSTANCE_FILE);
  const bytes = `${JSON.stringify({ kind: INSTANCE_KIND, instanceId: instance, createdAt: new Date().toISOString() })}\n`;
  if (publishNoReplace(path, bytes, 0o644) === "existing" && readInstance(mount) !== instance)
    throw new StoreError("STORE_CORRUPT", "the data disk already names another instance");
}
