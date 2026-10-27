/** Seatbelt mechanics only. The trusted caller supplies the purpose-specific
 * roots and environment. This neither authorizes execution nor observes the
 * arbitrary-descendant lifetime required by the shared execution owner.
 * SBPL syntax: Chromium's Mac sandbox and sandbox-runtime 98a401. */
import { snapshotCommand, type CommandSpec } from "@oma/process/command";
import { StoreError } from "@oma/domain/errors";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface SeatbeltPath { readonly path: string; readonly kind: "file" | "directory" }
/** Transient trusted launch input, never a model setting or durable grant.
 * Paths are canonical host paths; Seatbelt supplies no mount namespace. */
export interface SeatbeltPolicy {
  readonly readable: readonly SeatbeltPath[];
  readonly writable: readonly SeatbeltPath[];
  readonly denied: readonly SeatbeltPath[];
  readonly executable: readonly SeatbeltPath[];
  /** Read-only dylibs/frameworks that may be mapped, without permitting a
   * process-exec grant over their enclosing toolchain bundle. */
  readonly mapped?: readonly SeatbeltPath[];
  readonly unixSockets: readonly string[];
  /** Only the particular OMA broker rendezvous may be added to OS services. */
  readonly machServices: readonly string[];
  readonly environmentKeys: readonly string[];
  /** Exact trusted read-only preload. The C launcher interprets no Node
   * environment; this import executes only after sandbox_init and execve. */
  readonly nodePreload?: string;
  /** Explicit child descriptor slots, never a parent descriptor or state
   * directory grant. Worker defaults to none; fixed setup protocols opt in. */
  readonly preserveFds?: readonly number[];
  /** Noninteractive setup may use the ordinary command-input owner. The
   * launcher consumes the frame and gives the target /dev/null on stdin.
   * Workers keep descriptor 3 so stdin remains their RPC channel. */
  readonly profileInput?: "descriptor" | "stdin";
}
const SYSTEM_READS = ["/System/Library", "/usr/lib", "/usr/share", "/bin", "/sbin", "/usr/bin", "/usr/sbin"];
const SYSTEM_EXEC = ["/bin", "/sbin", "/usr/bin", "/usr/sbin"];
const SYSTEM_FILES = ["/private/etc/hosts", "/private/etc/resolv.conf", "/private/etc/localtime", "/private/etc/services"];
// getpagesize/sysconf use numeric HW_PAGESIZE, named hw.pagesize_compat in
// XNU; hw.pagesize is a different OID. Node's allocator needs the former.
// uname, including Node's os.release(), also reads hostname and kernel version.
const SYSCTLS = ["hw.activecpu", "hw.logicalcpu", "hw.logicalcpu_max", "hw.physicalcpu", "hw.physicalcpu_max",
  "hw.ncpu", "hw.memsize", "hw.pagesize", "hw.pagesize_compat", "hw.cputype", "hw.cpusubtype", "hw.machine", "hw.cpufamily",
  "kern.ostype", "kern.hostname", "kern.osrelease", "kern.version", "kern.osversion", "kern.osproductversion", "kern.argmax", "kern.maxfilesperproc"];
const SYSTEM_MACH = ["com.apple.system.logger", "com.apple.logd", "com.apple.system.opendirectoryd.libinfo"];
function refused(message: string): never { throw new StoreError("UNSUPPORTED_PROFILE", message); }
function path(value: string): string {
  if (typeof value !== "string" || !value.startsWith("/") || value === "/" ||
      value.includes("\0") || Buffer.from(value).toString("utf8") !== value || value.split("/").slice(1).some(part => !part || part === "." || part === ".."))
    refused("Seatbelt requires normalized non-root absolute host paths");
  // The SBPL compiler has a per-literal limit. Aggregate profiles use a pipe,
  // so their total length is independent of the exec argument-size limit.
  if (Buffer.byteLength(JSON.stringify(value)) > 1024) refused("Seatbelt path exceeds the supported SBPL literal length");
  return value;
}
function filter(entry: SeatbeltPath): string {
  if (entry?.kind !== "file" && entry?.kind !== "directory") refused("Seatbelt path kind is invalid");
  return `(${entry.kind === "file" ? "literal" : "subpath"} ${JSON.stringify(path(entry.path))})`;
}
function under(value: string, entry: SeatbeltPath): boolean {
  return value === entry.path || entry.kind === "directory" && value.startsWith(`${entry.path}/`);
}
/** Pure translation, not a kernel qualification result. Denies are emitted
 * after all allows, including device/IPC rules, so nested denied roots retain
 * precedence. There is no allow-default or unrestricted Unix/Mach access. */
export function seatbeltProfile(policy: SeatbeltPolicy): string {
  const mapped = policy.mapped;
  if (mapped !== undefined && !Array.isArray(mapped)) refused("Seatbelt mapped roots must be explicit arrays");
  const rules = ["(version 1)", "(deny default)", "(allow process-fork)",
    "(allow process-info* (target same-sandbox))", "(allow signal (target same-sandbox))"];
  const allow = (operations: string, entries: readonly SeatbeltPath[]): void => {
    if (!Array.isArray(entries)) refused("Seatbelt roots must be explicit arrays");
    for (const entry of entries) rules.push(`(allow ${operations} ${filter(entry)})`);
  };
  allow("file-read*", [...SYSTEM_READS.map(path => ({ path, kind: "directory" as const })),
    ...SYSTEM_FILES.map(path => ({ path, kind: "file" as const })), ...policy.readable, ...policy.executable,
    ...(mapped ?? []), ...policy.writable]);
  allow("file-write*", policy.writable);
  allow("process-exec*", [...SYSTEM_EXEC.map(path => ({ path, kind: "directory" as const })), ...policy.executable]);
  allow("file-map-executable", [...SYSTEM_READS.map(path => ({ path, kind: "directory" as const })), ...policy.executable, ...(mapped ?? [])]);
  // Directory metadata suffices for ancestor traversal, without reading
  // unrelated files. Device access is confined to these kernel devices.
  rules.push("(allow file-read-metadata (vnode-type DIRECTORY))");
  // libignition opens this one directory as its openat root before main.
  // This permits root dirent names, not reads or execution in its subtrees.
  rules.push('(allow file-read-data (literal "/"))');
  allow("file-read* file-write-data file-ioctl", ["/dev/null", "/dev/zero", "/dev/random", "/dev/urandom"]
    .map(path => ({ path, kind: "file" as const })));
  rules.push(`(allow sysctl-read ${SYSCTLS.map(name => `(sysctl-name ${JSON.stringify(name)})`).join(" ")})`);
  // DR37/DR46: ordinary IP networking has no destination allowlist. Keep
  // path-bearing AF_UNIX separate; network* would also expose host sockets.
  rules.push("(allow system-socket (socket-domain AF_INET))", "(allow system-socket (socket-domain AF_INET6))",
    '(allow network-bind (local ip "*:*"))', '(allow network-inbound (local ip "*:*"))',
    '(allow network-outbound (remote ip "*:*"))');
  if (!Array.isArray(policy.unixSockets) || !Array.isArray(policy.machServices)) refused("Seatbelt IPC endpoints must be explicit arrays");
  if (policy.unixSockets.length) rules.push("(allow system-socket (socket-domain AF_UNIX))");
  for (const socket of policy.unixSockets) {
    const name = JSON.stringify(path(socket));
    rules.push(`(allow network-outbound (remote unix-socket (literal ${name})))`);
  }
  for (const service of [...SYSTEM_MACH, ...policy.machServices]) {
    if (!SYSTEM_MACH.includes(service) && !/^com\.oma\.rpc\.[0-9a-f]{64}$/.test(service))
      refused("Seatbelt Mach lookup requires an exact OMA broker rendezvous");
    rules.push(`(allow mach-lookup (global-name ${JSON.stringify(service)}))`);
  }
  if (!Array.isArray(policy.denied)) refused("Seatbelt denied roots must be explicit");
  for (const entry of policy.denied) rules.push(`(deny file* ${filter(entry)})`);
  return rules.join("\n") + "\n";
}
function commandFor(source: CommandSpec, policy: SeatbeltPolicy, launcher: string, frame: Uint8Array): CommandSpec {
  const command = snapshotCommand(source);
  const profileInput = policy.profileInput;
  if (profileInput !== undefined && profileInput !== "descriptor" && profileInput !== "stdin")
    refused("Seatbelt profile input is invalid");
  const stdin = profileInput === "stdin";
  if (stdin && (command.input !== undefined || command.stdinFd !== undefined))
    refused("Seatbelt stdin profile cannot replace command input");
  path(command.executable); path(launcher);
  if (!Array.isArray(policy.environmentKeys) || policy.environmentKeys.some(key => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)))
    refused("Seatbelt environment allowlist is invalid");
  let nodeOptions: string | undefined;
  if (policy.nodePreload !== undefined) {
    const preload = path(policy.nodePreload);
    if (preload.includes("\\") || !policy.readable.some(entry => under(preload, entry)) || policy.writable.some(entry => under(preload, entry)) ||
        policy.denied.some(entry => under(preload, entry))) refused("Seatbelt Node preload requires a trusted read-only root");
    nodeOptions = `--import=${pathToFileURL(preload).href}`;
  }
  for (const [key, value] of Object.entries(command.env)) {
    if (value === undefined) continue;
    if (!policy.environmentKeys.includes(key) || /^(?:DYLD_|LD_|__XPC_)/.test(key) ||
        ["ENV", "BASH_ENV", "SHELLOPTS", "NODE_PATH", "SSH_AUTH_SOCK"].includes(key) ||
        key === "NODE_OPTIONS" && value !== nodeOptions)
      refused("Seatbelt command environment contains an unapproved entry");
  }
  for (const key of ["HOME", "TMPDIR"] as const) {
    const value = command.env[key];
    if (typeof value !== "string" || !policy.writable.some(entry => under(path(value), entry)))
      refused("Seatbelt HOME and TMPDIR must be inside explicit writable roots");
  }
  if (command.cwd === undefined || !policy.writable.some(entry => under(path(command.cwd!), entry)))
    refused("Seatbelt working directory must be inside an explicit writable root");
  // The tiny installed launcher consumes its selected channel, applies the
  // profile and execs the absolute target with these exact arguments. It uses
  // no shell, profile pathname reopen or sandbox-exec pipe-file assumption.
  if (policy.preserveFds !== undefined && !Array.isArray(policy.preserveFds)) refused("Seatbelt descriptor policy is invalid");
  const kept = [...(policy.preserveFds ?? [])];
  if (kept.some(fd => !Number.isSafeInteger(fd) || fd < 4 || fd >= 0x7fffffff) || new Set(kept).size !== kept.length)
    refused("Seatbelt descriptor policy is invalid");
  const descriptors = kept.sort((left, right) => left - right);
  return { ...command, executable: launcher,
    ...(stdin ? { input: frame } : {}),
    argv: [...(stdin ? ["--profile-stdin"] : []), ...(descriptors.length ? [`--keep-fds=${descriptors.join(",")}`] : []),
      command.executable, ...command.argv] };
}
export function bundledSeatbeltHelper(): string {
  return fileURLToPath(new URL("./seatbelt/oma-seatbelt", import.meta.url));
}
/** A recipe grants no authority and starts no process. The existing process
 * owner consumes these private inputs only within its independently acquired
 * execution scope. No host-state fence capability enters this sandbox. */
export function prepareSeatbelt(source: CommandSpec, policy: SeatbeltPolicy): {
  readonly profile: string; readonly command: CommandSpec;
  readonly privateInputs: readonly { readonly fd: number; readonly bytes: Uint8Array }[];
} {
  const profile = seatbeltProfile(policy), payload = Buffer.from(profile), header = Buffer.alloc(16);
  // Producer EOF cannot authorize a syntactically valid prefix missing its
  // final denies. The launcher requires this complete frame and then EOF.
  header.write("OMASBPL1"); header.writeBigUInt64BE(BigInt(payload.length), 8);
  const frame = Buffer.concat([header, payload]);
  const command = snapshotCommand(commandFor(source, policy, bundledSeatbeltHelper(), frame));
  return Object.freeze({ profile, command,
    privateInputs: Object.freeze(command.argv[0] === "--profile-stdin" ? [] : [{ fd: 3, bytes: frame }]) });
}
