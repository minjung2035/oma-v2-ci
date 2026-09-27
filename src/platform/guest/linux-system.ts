/** The guest's real `GuestSystem`: the root-only effects guestctl performs.
 *
 * Calls go through koffi, as openat2 does in `contained-fs`: the clock
 * (clock_settime), the state filesystem's freeze (FIFREEZE/FITHAW ioctls,
 * the interface fsfreeze(8) uses), and systemd for power. Commands run through
 * the product's bounded process runner. Nothing here decides anything;
 * `GuestControl` does.
 */
import { closeSync, openSync, readFileSync, statfsSync, constants } from "node:fs";
import { getSystemErrorName } from "node:util";
import { errno, load } from "koffi";
import { StoreError } from "../../domain/errors.js";
import { decodeProcessText, runProcess, runProcessSync, type CommandSpec } from "../../process/run.js";
import type { GuestSystem, HealthFacts } from "./control.js";

const CLOCK_REALTIME = 0;
/** _IOWR('X', 119, int) and _IOWR('X', 120, int). */
const FIFREEZE = 0xc0045877;
const FITHAW = 0xc0045878;
const EINVAL = 22;
const SYSTEMCTL = "/usr/bin/systemctl";
const RESIZE2FS = "/usr/sbin/resize2fs";
const command = (executable: string, argv: readonly string[], timeoutMs: number): CommandSpec =>
  ({ executable, argv, env: { PATH: "/usr/sbin:/usr/bin" }, timeoutMs, stdoutBytes: 64 * 1024, stderrBytes: 16 * 1024 });

let native: { clockSettime: (clock: number, spec: Buffer) => number; ioctl: (...args: unknown[]) => number } | null = null;
function libc(): NonNullable<typeof native> {
  if (process.platform !== "linux") throw new StoreError("UNSUPPORTED_PROFILE", "the guest's control effects are Linux only");
  if (native === null) {
    const lib = load(null);
    native = {
      clockSettime: lib.func("int clock_settime(int clock, void *spec)") as (clock: number, spec: Buffer) => number,
      ioctl: lib.func("int ioctl(int fd, unsigned long request, ...)") as (...args: unknown[]) => number,
    };
  }
  return native;
}
function failed(what: string): Error {
  const code = getSystemErrorName(-errno());
  return Object.assign(new Error(`${what} failed: ${code}`), { code });
}

function readNumbers(path: string): number[] {
  return readFileSync(path, "utf8").trim().split(/\s+/).map(Number);
}
function meminfo(): { totalBytes: number; availableBytes: number } {
  const lines = readFileSync("/proc/meminfo", "utf8").split("\n");
  const field = (name: string): number => {
    const line = lines.find(item => item.startsWith(`${name}:`));
    const kib = line === undefined ? NaN : Number(line.split(/\s+/)[1]);
    if (!Number.isFinite(kib)) throw new StoreError("BROKER_UNAVAILABLE", `/proc/meminfo has no ${name}`);
    return kib * 1024;
  };
  return { totalBytes: field("MemTotal"), availableBytes: field("MemAvailable") };
}
/** The block device a mount point is on, from the kernel's own mount table. */
function deviceOf(mountPoint: string): string {
  for (const line of readFileSync("/proc/self/mounts", "utf8").split("\n")) {
    const [device, target] = line.split(" ");
    if (target === mountPoint && device !== undefined && device.startsWith("/dev/")) return device;
  }
  throw new StoreError("BROKER_UNAVAILABLE", "the state filesystem's device is not mounted");
}

export function linuxGuestSystem(stateMount: string): GuestSystem {
  const withMount = <T>(run: (fd: number) => T): T => {
    const fd = openSync(stateMount, constants.O_RDONLY | constants.O_DIRECTORY);
    try { return run(fd); } finally { closeSync(fd); }
  };
  return {
    wallClock: () => Date.now(),
    setWallClock(ms) {
      const spec = Buffer.alloc(16);
      spec.writeBigInt64LE(BigInt(Math.floor(ms / 1000)), 0);
      spec.writeBigInt64LE(BigInt((ms % 1000) * 1_000_000), 8);
      if (libc().clockSettime(CLOCK_REALTIME, spec) !== 0) throw failed("clock_settime");
    },
    health(): HealthFacts {
      const [uptime] = readNumbers("/proc/uptime");
      const [one, five, fifteen] = readNumbers("/proc/loadavg");
      const disk = statfsSync(stateMount);
      const failedList = runProcessSync(command(SYSTEMCTL, ["--failed", "--no-legend", "--plain"], 5000));
      return {
        uptimeMs: Math.round((uptime ?? 0) * 1000),
        load: [one ?? 0, five ?? 0, fifteen ?? 0],
        memory: meminfo(),
        disk: { totalBytes: disk.blocks * disk.bsize, freeBytes: disk.bavail * disk.bsize },
        failedUnits: failedList.kind === "exited" && failedList.exitCode === 0
          ? decodeProcessText(failedList.stdout).split("\n").filter(line => line.trim().length > 0).length : null,
      };
    },
    freeze() {
      withMount(fd => { if (libc().ioctl(fd, FIFREEZE, "int", 0) !== 0) throw failed("FIFREEZE"); });
    },
    thaw() {
      withMount(fd => {
        if (libc().ioctl(fd, FITHAW, "int", 0) === 0) return;
        // EINVAL: it was not frozen, which is the state a thaw asks for.
        if (errno() === EINVAL) return;
        throw failed("FITHAW");
      });
    },
    async grow() {
      const result = await runProcess(command(RESIZE2FS, [deviceOf(stateMount)], 10 * 60_000));
      if (result.kind !== "exited" || result.exitCode !== 0)
        throw new StoreError("INTERNAL_ERROR", `resize2fs ${result.kind}: ${decodeProcessText(result.stderr).trim().slice(0, 200)}`);
      const disk = statfsSync(stateMount);
      return disk.blocks * disk.bsize;
    },
    powerOff() {
      // Queued, not waited for: systemd stops this service on the way down.
      void runProcess(command(SYSTEMCTL, ["--no-block", "poweroff"], 30_000));
    },
    schedule(ms, run) {
      const timer = setTimeout(run, ms);
      return { cancel: () => clearTimeout(timer) };
    },
  };
}
