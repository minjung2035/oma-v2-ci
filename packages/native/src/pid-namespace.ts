/** Linux namespace-init capabilities. Callers own admission, recovery and
 * journal policy. A pidfd on a verified PID-namespace init is the kernel exit
 * observation; neither the launcher nor its pipes stand in for this handle.
 */
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { errno, load } from "koffi";
import { getSystemErrorName } from "node:util";
import { StoreError } from "@oma/domain/errors";
import { cleanupAll, withCleanup } from "./cleanup.js";
import { pidfdLiveness } from "./linux.js";

export interface NamespaceInitIdentity {
  readonly pid: number;
  readonly bootId: string;
  readonly startTime: string;
  readonly namespaceDevice: string;
  readonly namespaceInode: string;
}
export interface NamespaceInitPin {
  readonly identity: NamespaceInitIdentity;
  population(): "populated" | "empty" | "unknown";
  /** Signal only the live capability acquired by this process, never a PID
   * recovered from disk. A successful signal is not an exit observation. */
  terminate(): void;
  close(): void;
}
export interface NamespaceRunnerPin {
  readonly pid: number; readonly uid: number; readonly gid: number; readonly startTime: string;
  alive(): boolean;
  close(): void;
}
/** The directly exec'd child of bubblewrap's namespace init is namespace PID
 * 2. Pin that kernel task, including its start identity, before exposing its
 * inherited channel. A Worker descendant can never acquire this position. */
export function pinNamespaceRunner(root: NamespaceInitIdentity): NamespaceRunnerPin {
  linux(); validPid(root.pid);
  const observed = observeNamespaceProcess(root.pid);
  if (observed.kind !== "running" || observed.identity.bootId !== root.bootId || observed.identity.startTime !== root.startTime ||
      observed.identity.namespaceDevice !== root.namespaceDevice || observed.identity.namespaceInode !== root.namespaceInode)
    throw new Error("owned namespace init is not observed running");
  const parent = openSync(`/proc/${root.pid}`, 0o10000000 | constants.O_DIRECTORY | 0o2000000);
  let proc: number | undefined, pidfd: number | undefined, namespace: number | undefined;
  try {
    const facts = withCleanup(() => {
      const children = readFileSync(`/proc/self/fd/${parent}/task/${root.pid}/children`, "utf8").trim().split(/\s+/).filter(Boolean).map(Number);
      let found: { pid: number; uid: number; gid: number; startTime: string } | undefined;
      for (const pid of children) {
        validPid(pid);
        const child = openSync(`/proc/${pid}`, 0o10000000 | constants.O_DIRECTORY | 0o2000000);
        let selected = false;
        try {
          const identity = taskIdentity(child, pid);
          if (identity.namespacePids.at(-1) !== 2) continue;
          if (found !== undefined) throw new Error("namespace runner task is ambiguous");
          proc = child; selected = true;
          namespace = openSync(`/proc/self/fd/${proc}/ns/pid`, constants.O_RDONLY | 0o2000000);
          const ns = fstatSync(namespace, { bigint: true });
          if (String(ns.dev) !== root.namespaceDevice || String(ns.ino) !== root.namespaceInode || bootId() !== root.bootId)
            throw new Error("runner belongs to another namespace");
          pidfd = call(434, "int", pid, "unsigned int", 0, "long", 0, "long", 0, "long", 0, "long", 0);
          const after = taskIdentity(proc, pid), status = readFileSync(`/proc/self/fd/${proc}/status`, "utf8");
          const uid = Number(/^Uid:\s+\d+\s+(\d+)/m.exec(status)?.[1]), gid = Number(/^Gid:\s+\d+\s+(\d+)/m.exec(status)?.[1]);
          const ppid = Number(/^PPid:\s+(\d+)$/m.exec(status)?.[1]);
          if (after.startTime !== identity.startTime || after.namespacePids.at(-1) !== 2 || ppid !== root.pid ||
              !Number.isSafeInteger(uid) || uid < 0 || !Number.isSafeInteger(gid) || gid < 0 || pidfdLiveness(pidfd).kind !== "running")
            throw new Error("runner task changed during acquisition");
          found = { pid, uid, gid, startTime: identity.startTime };
        } finally { if (!selected) closeSync(child); }
      }
      if (found === undefined) throw Object.assign(new Error("namespace runner has not forked yet"), { code: "EAGAIN" });
      const after = taskIdentity(parent, root.pid);
      if (after.startTime !== root.startTime || after.namespacePids.at(-1) !== 1) throw new Error("namespace init changed during runner acquisition");
      return found;
    }, () => cleanupAll([() => closeSync(parent), () => { if (proc !== undefined) { const fd = proc; proc = undefined; closeSync(fd); } },
      () => { if (namespace !== undefined) { const fd = namespace; namespace = undefined; closeSync(fd); } }]));
    const held = pidfd!; pidfd = undefined; let closed = false;
    return Object.freeze({ ...facts, alive: () => !closed && pidfdLiveness(held).kind === "running",
      close: () => { if (!closed) { closed = true; closeSync(held); } } });
  } catch (error) { return withCleanup(() => { throw error; }, () => { if (pidfd !== undefined) closeSync(pidfd); }); }
}
export type NamespaceProcessObservation =
  | { readonly kind: "running"; readonly identity: NamespaceInitIdentity }
  | { readonly kind: "exited" }
  | { readonly kind: "unavailable" };

/** Fresh kernel data for recovery. This reader never signals, grants authority
 * or interprets a saved journal. Missing proc children are not a missing PID.
 */
export function observeNamespaceProcess(pid: number): NamespaceProcessObservation {
  try { linux(); validPid(pid); } catch { return { kind: "unavailable" }; }
  let proc: number;
  try { proc = openSync(`/proc/${pid}`, 0o10000000 | constants.O_DIRECTORY | 0o2000000); }
  catch (error) { return ["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "") ? { kind: "exited" } : { kind: "unavailable" }; }
  let pidfd: number | undefined, namespace: number | undefined;
  try {
    return withCleanup(() => {
      pidfd = call(434, "int", pid, "unsigned int", 0, "long", 0, "long", 0, "long", 0, "long", 0);
      const alive = pidfdLiveness(pidfd);
      if (alive.kind === "exited") return { kind: "exited" };
      if (alive.kind !== "running") return { kind: "unavailable" };
      const before = taskIdentity(proc, pid), boot = bootId();
      namespace = openSync(`/proc/self/fd/${proc}/ns/pid`, constants.O_RDONLY | 0o2000000);
      const stat = fstatSync(namespace, { bigint: true }), after = taskIdentity(proc, pid);
      if (before.startTime !== after.startTime || bootId() !== boot) return { kind: "unavailable" };
      return { kind: "running", identity: Object.freeze({ pid, bootId: boot, startTime: before.startTime,
        namespaceDevice: String(stat.dev), namespaceInode: String(stat.ino) }) };
    }, () => cleanupAll([() => { if (namespace !== undefined) closeSync(namespace); },
      () => { if (pidfd !== undefined) closeSync(pidfd); }, () => closeSync(proc)]));
  } catch { return { kind: "unavailable" }; }
}

let systemCall: ((number: number, ...args: unknown[]) => number) | undefined;
let pipeCall: ((buffer: Buffer, flags: number) => number) | undefined;
/** Both descriptors belong to the caller immediately. CLOEXEC is cleared
 * only by the caller's explicit spawn descriptor mapping. */
export function namespaceControlPipe(): { readonly read: number; readonly write: number } {
  linux();
  pipeCall ??= load(null).func("int pipe2(void *descriptors, int flags)");
  const descriptors = Buffer.alloc(8);
  if (pipeCall(descriptors, 0o2000000) !== 0) {
    const code = getSystemErrorName(-errno());
    throw Object.assign(new Error(`namespace control pipe failed: ${code}`), { code });
  }
  return { read: descriptors.readInt32LE(0), write: descriptors.readInt32LE(4) };
}
function linux(): void {
  if (process.platform !== "linux" || !["x64", "arm64"].includes(process.arch))
    throw new StoreError("UNSUPPORTED_PROFILE", "PID namespace capabilities require Linux x64/arm64");
}
function call(number: number, ...args: unknown[]): number {
  linux();
  systemCall ??= load(null).func("long syscall(long number, ...)");
  const result = systemCall(number, ...args);
  if (result >= 0) return result;
  const value = errno();
  throw Object.assign(new Error(`PID namespace operation failed: ${getSystemErrorName(-value)}`),
    { code: getSystemErrorName(-value) });
}
function validPid(pid: number): void {
  if (!Number.isSafeInteger(pid) || pid <= 1 || pid > 0x7fffffff) throw new TypeError("invalid namespace-init PID");
}
function bootId(): string {
  const value = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value))
    throw new Error("kernel boot identity is unavailable");
  return value;
}
/** The held proc directory continues to name this task across PID recycling. */
function taskIdentity(proc: number, pid: number): { startTime: string; namespacePids: number[] } {
  const stat = readFileSync(`/proc/self/fd/${proc}/stat`, "utf8"), end = stat.lastIndexOf(")");
  const fields = end < 0 ? [] : stat.slice(end + 2).trim().split(/\s+/);
  const status = readFileSync(`/proc/self/fd/${proc}/status`, "utf8");
  const namespacePids = /^NSpid:\s+([0-9\t ]+)$/m.exec(status)?.[1]?.trim().split(/\s+/).map(Number);
  if (Number(stat.slice(0, stat.indexOf(" "))) !== pid || !/^[0-9]+$/.test(fields[19] ?? "") ||
      !namespacePids?.length || namespacePids[0] !== pid || namespacePids.some(n => !Number.isSafeInteger(n) || n <= 0))
    throw new Error("kernel task identity is incomplete");
  return { startTime: fields[19]!, namespacePids };
}

/** Acquire while bubblewrap is blocked before arbitrary execution. Holding
 * proc before pidfd_open and checking that same task afterwards rejects a PID
 * recycled during acquisition. The scope must be a distinct namespace's init.
 */
export function pinNamespaceInit(pid: number): NamespaceInitPin {
  linux(); validPid(pid);
  const proc = openSync(`/proc/${pid}`, 0o10000000 | constants.O_DIRECTORY | 0o2000000);
  let namespace: number | undefined, pidfd: number | undefined;
  try {
    const snapshot = withCleanup(() => {
    const boot = bootId(), before = taskIdentity(proc, pid);
    if (before.namespacePids.length < 2 || before.namespacePids.at(-1) !== 1)
      throw new Error("execution PID is not a child PID-namespace init");
    namespace = openSync(`/proc/self/fd/${proc}/ns/pid`, constants.O_RDONLY | 0o2000000);
    const identity = fstatSync(namespace, { bigint: true });
    const own = openSync("/proc/self/ns/pid", constants.O_RDONLY | 0o2000000);
    const ownIdentity = withCleanup(() => fstatSync(own, { bigint: true }), () => closeSync(own));
    if (identity.dev === ownIdentity.dev && identity.ino === ownIdentity.ino)
      throw new Error("execution scope is the caller's own PID namespace");
    // Linux x64/arm64 UAPI: pidfd_open(434), no thread-only flag.
    pidfd = call(434, "int", pid, "unsigned int", 0, "long", 0, "long", 0, "long", 0, "long", 0);
    const after = taskIdentity(proc, pid);
    if (before.startTime !== after.startTime || after.namespacePids.at(-1) !== 1 || bootId() !== boot ||
        pidfdLiveness(pidfd).kind !== "running") throw new Error("namespace init changed during acquisition");
    return Object.freeze({ pid, bootId: boot, startTime: before.startTime,
      namespaceDevice: String(identity.dev), namespaceInode: String(identity.ino) });
    }, () => closeSync(proc));
    const result = makePin(pidfd!, namespace!, snapshot);
    pidfd = undefined; namespace = undefined;
    return result;
  } catch (error) {
    return withCleanup(() => { throw error; }, () => cleanupAll([
      () => { if (pidfd !== undefined) closeSync(pidfd); },
      () => { if (namespace !== undefined) closeSync(namespace); },
    ]));
  }
}

function makePin(pidfd: number, namespace: number, identity: NamespaceInitIdentity): NamespaceInitPin {
  let closed = false;
  return Object.freeze({ identity,
    population() {
      if (closed) return "unknown";
      const answer = pidfdLiveness(pidfd);
      return answer.kind === "running" ? "populated" : answer.kind === "exited" ? "empty" : "unknown";
    },
    terminate() {
      if (closed) throw new Error("namespace-init capability is closed");
      try {
        // pidfd_send_signal(424), SIGKILL; never signal a numeric PID.
        call(424, "int", pidfd, "int", 9, "void *", null, "unsigned int", 0, "long", 0, "long", 0);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    },
    close() {
      if (closed) return;
      closed = true; cleanupAll([() => closeSync(pidfd), () => closeSync(namespace)]);
    },
  });
}
