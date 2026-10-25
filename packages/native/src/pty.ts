/** A pseudo-terminal for a society session (macos-platform §4.6).
 *
 * The master side stays with the session holder; the slave side becomes the
 * controlling terminal of the program it runs, as a terminal emulator's would.
 * Calls go through koffi, as the other native calls in this product do:
 * posix_openpt(3), grantpt(3), unlockpt(3), ptsname_r(3) and the window-size
 * ioctl, whose change the kernel reports to the foreground process group as
 * SIGWINCH.
 */
import { closeSync, constants, openSync } from "node:fs";
import { getSystemErrorName } from "node:util";
import { errno, load } from "koffi";
import { StoreError } from "@oma/domain/errors";

/** _IOW('T', 0x14, struct winsize) on Linux, the same on arm64 and x86_64. */
const TIOCSWINSZ = 0x5414;

type Native = {
  openpt(flags: number): number; grantpt(fd: number): number; unlockpt(fd: number): number;
  ptsname(fd: number, buffer: Buffer, length: number): number; ioctl(...args: unknown[]): number;
};
let native: Native | null = null;
function libc(): Native {
  if (process.platform !== "linux") throw new StoreError("UNSUPPORTED_PROFILE", "a society terminal needs Linux");
  if (native === null) {
    const lib = load(null);
    native = {
      openpt: lib.func("int posix_openpt(int flags)") as Native["openpt"],
      grantpt: lib.func("int grantpt(int fd)") as Native["grantpt"],
      unlockpt: lib.func("int unlockpt(int fd)") as Native["unlockpt"],
      ptsname: lib.func("int ptsname_r(int fd, char *buf, size_t buflen)") as Native["ptsname"],
      ioctl: lib.func("int ioctl(int fd, unsigned long request, ...)") as Native["ioctl"],
    };
  }
  return native;
}
function failed(what: string, code = errno()): Error {
  const name = getSystemErrorName(-Math.abs(code));
  return Object.assign(new StoreError("INTERNAL_ERROR", `${what} failed: ${name}`), { errno: name });
}

export interface PseudoTerminal {
  /** The master side: the holder reads the program's output from it and
   * writes the Human's input to it. */
  readonly master: number;
  /** The slave side, opened without becoming this process's controlling
   * terminal; handed to the program and then closed here. */
  readonly slave: number;
}

export function openPseudoTerminal(columns: number, rows: number): PseudoTerminal {
  const c = libc();
  // Close-on-exec, as every descriptor this product opens natively is (leaf.ts,
  // contained-fs.ts): a program that inherited its own terminal's master side
  // would keep that terminal alive past the holder, and never be hung up.
  const master = c.openpt(constants.O_RDWR | constants.O_NOCTTY | 0o2000000 /* O_CLOEXEC */);
  if (master < 0) throw failed("posix_openpt");
  try {
    if (c.grantpt(master) !== 0) throw failed("grantpt");
    if (c.unlockpt(master) !== 0) throw failed("unlockpt");
    const name = Buffer.alloc(128);
    const status = c.ptsname(master, name, name.length);
    if (status !== 0) throw failed("ptsname_r", status);
    const path = name.subarray(0, name.indexOf(0)).toString("utf8");
    setWindowSize(master, columns, rows);
    const slave = openSync(path, constants.O_RDWR | constants.O_NOCTTY);
    return Object.freeze({ master, slave });
  } catch (error) { closeSync(master); throw error; }
}

/** The kernel sends SIGWINCH to the terminal's foreground process group when
 * the size changes, which is how the program learns of it. */
export function setWindowSize(master: number, columns: number, rows: number): void {
  const size = Buffer.alloc(8);
  size.writeUInt16LE(rows, 0);
  size.writeUInt16LE(columns, 2);
  if (libc().ioctl(master, TIOCSWINSZ, "void *", size) !== 0) throw failed("TIOCSWINSZ");
}
