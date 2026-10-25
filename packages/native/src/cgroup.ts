import { closeSync, constants, fstatSync, openSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { StoreError } from "@oma/domain/errors";
import { parseCgroupPopulation } from "@oma/domain/cgroup-population";

export interface CgroupIdentity { readonly dev: bigint; readonly ino: bigint }
export type Population = "empty" | "populated" | "removed" | "unknown";
export interface CgroupPin {
  readonly fd: number;
  readonly identity: CgroupIdentity;
  population(): Population;
  matches(path: string): boolean;
  close(): void;
}
/** Native owner. A missing `cgroup.events` is evidence only through the pinned
 * descriptor of a directory that was seen to hold one: that core file exists
 * for a cgroup's whole life, so its absence below the same pinned inode means
 * the kernel removed the cgroup. The directory's link count is not a signal:
 * cgroup2 keeps it unchanged after removal (observed on Linux 6.12). */
export function pinCgroup(path: string): CgroupPin {
  if (!path.startsWith("/") || path === "/" || path.includes("\0") || path.split("/").some(part => part === "." || part === ".."))
    throw new StoreError("AUTH_FAILED", "invalid observed cgroup path");
  const fd = openSync(join("/sys/fs/cgroup", path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  let closed = false;
  try {
    const st = fstatSync(fd, { bigint: true });
    if (!st.isDirectory()) throw new StoreError("AUTH_FAILED", "cgroup pin is not a directory");
    const identity = Object.freeze({ dev: st.dev, ino: st.ino });
    let observedEvents = false;
    return {
      fd, identity,
      population() {
        if (closed) return "unknown";
        let events: string;
        try { events = readFileSync(`/proc/self/fd/${fd}/cgroup.events`, "utf8"); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") return "unknown";
          if (observedEvents) return "removed";
          try { return fstatSync(fd, { bigint: true }).nlink === 0n ? "removed" : "unknown"; }
          catch { return "unknown"; }
        }
        const population = parseCgroupPopulation(events);
        if (population !== "unknown") observedEvents = true;
        return population;
      },
      matches(currentPath) {
        if (closed) return false;
        try {
          const current = statSync(join("/sys/fs/cgroup", currentPath), { bigint: true });
          const pinned = fstatSync(fd, { bigint: true });
          return current.isDirectory() && pinned.isDirectory() && pinned.nlink > 0n &&
            current.dev === identity.dev && current.ino === identity.ino &&
            pinned.dev === identity.dev && pinned.ino === identity.ino;
        } catch { return false; }
      },
      close() { if (!closed) { closed = true; closeSync(fd); } },
    };
  } catch (error) { closeSync(fd); throw error; }
}

