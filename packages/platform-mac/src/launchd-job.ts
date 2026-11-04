/** Ordinary user-domain one-shot registration mechanics. A successful CLI
 * result confirms registration/start only. Kernel CID and authenticated helper
 * messages, never a saved label or launchctl text, establish scope identity. */
import { closeSync, constants, realpathSync, writeSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StoreError } from "@oma/domain/errors";
import { cleanupAll, withCleanup } from "@oma/native/cleanup";
import { openDirectory } from "@oma/native/files";
import { mkdirAt, openAt, unlinkAt } from "@oma/file-descriptors";
import { snapshotCommand, type CommandSpec, type ProcessObservation } from "@oma/process/command";
import { runProcessSync } from "@oma/process/run";

export interface LaunchdJobDefinition {
  readonly label: string;
  readonly command: CommandSpec;
  readonly machServices?: readonly string[];
}
export interface LaunchdJobRegistration {
  readonly domain: string;
  readonly target: string;
  readonly submission: ProcessObservation;
}
const registrations = new WeakSet<LaunchdJobRegistration>();
type Plist = string | boolean | readonly Plist[] | { readonly [key: string]: Plist };
function name(value: string): void {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(value) || Buffer.byteLength(value) >= 128)
    throw new TypeError("invalid one-shot job/service name");
}
function text(value: string): string {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff\ud800-\udfff]/u.test(value))
    throw new TypeError("launchd value is not XML text");
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
}
function plist(value: Plist): string {
  if (typeof value === "string") return "<string>" + text(value) + "</string>";
  if (typeof value === "boolean") return value ? "<true/>" : "<false/>";
  if (Array.isArray(value)) return "<array>" + value.map(plist).join("") + "</array>";
  return "<dict>" + Object.entries(value).map(([key, entry]) => "<key>" + text(key) + "</key>" + plist(entry)).join("") + "</dict>";
}
/** Pure setup bytes for the helper. Its workload/stdio arrives through private
 * authenticated capabilities; this definition carries no actor authority. */
export function renderLaunchdJob(definition: LaunchdJobDefinition): string {
  name(definition.label);
  const command = snapshotCommand(definition.command), services = [...(definition.machServices ?? [])];
  if (!command.executable.startsWith("/") || command.cwd !== undefined && !command.cwd.startsWith("/") ||
      command.timeoutMs !== null || command.input !== undefined || command.stdinFd !== undefined ||
      command.stdoutBytes !== 0 || command.stderrBytes !== 0 ||
      command.stdoutSpool !== undefined || command.stderrSpool !== undefined || command.silenceMs !== undefined)
    throw new StoreError("UNSUPPORTED_PROFILE", "launchd helper requires an absolute command and private byte channels");
  services.forEach(name);
  if (new Set(services).size !== services.length) throw new TypeError("duplicate one-shot Mach service");
  const environment = Object.create(null) as Record<string, string>;
  for (const [key, value] of Object.entries(command.env)) if (value !== undefined) environment[key] = value;
  const definitionBytes: Plist = { Label: definition.label, Program: command.executable,
    ProgramArguments: [command.executable, ...command.argv], EnvironmentVariables: environment,
    ...(command.cwd === undefined ? {} : { WorkingDirectory: command.cwd }),
    RunAtLoad: false, KeepAlive: false, AbandonProcessGroup: false,
    SessionCreate: true, LaunchOnlyOnce: true, LimitLoadToSessionType: "Background",
    StandardInPath: "/dev/null", StandardOutPath: "/dev/null", StandardErrorPath: "/dev/null",
    ...(services.length ? { MachServices: Object.fromEntries(services.map(service => [service, true])) } : {}) };
  return '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0">' + plist(definitionBytes) + "</plist>";
}
function domain(): string {
  const uid = process.getuid?.();
  if (process.platform !== "darwin" || uid === undefined || uid <= 0)
    throw new StoreError("UNSUPPORTED_PROFILE", "one-shot launchd registration requires ordinary Darwin user ownership");
  return "user/" + uid;
}
function launchctl(argv: readonly string[], budgetMs: number): ProcessObservation {
  const result = runProcessSync({ executable: "/bin/launchctl", argv,
    env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C", LC_ALL: "C" },
    timeoutMs: budgetMs, stdoutBytes: 65536, stderrBytes: 65536 });
  if (result.kind !== "exited" || result.exitCode !== 0)
    throw new StoreError("RUN_TERMINATION_UNKNOWN", "launchd setup was not confirmed", { cause: result });
  return result;
}
/** A failed submission can leave an unknown registration. It is never proof
 * of noncreation. Temporary definition cleanup does not remove a running job. */
export function submitLaunchdJob(definition: LaunchdJobDefinition, budgetMs: number): LaunchdJobRegistration {
  const ownerDomain = domain(), label = definition.label, bytes = renderLaunchdJob({ ...definition, label });
  if (!Number.isSafeInteger(budgetMs) || budgetMs <= 0 || budgetMs > 0x7fffffff) throw new TypeError("invalid launchd setup budget");
  const temporary = realpathSync(tmpdir()), parent = openDirectory(temporary), entry = "oma-launchd-" + randomUUID();
  let directory: number | undefined, file: number | undefined, created = false, fileCreated = false;
  const submission = withCleanup(() => {
    mkdirAt(parent, entry, 0o700); created = true;
    directory = openAt(parent, entry, constants.O_RDONLY | constants.O_DIRECTORY);
    file = openAt(directory, "job.plist", constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600); fileCreated = true;
    const content = Buffer.from(bytes);
    for (let offset = 0; offset < content.length;) {
      const count = writeSync(file, content, offset, content.length - offset);
      if (count <= 0) throw new Error("launchd definition write made no progress"); offset += count;
    }
    const completed = file; file = undefined; closeSync(completed);
    return launchctl(["bootstrap", ownerDomain, join(temporary, entry, "job.plist")], budgetMs);
  }, () => cleanupAll([
    () => { if (file !== undefined) { const fd = file; file = undefined; closeSync(fd); } },
    () => { if (fileCreated && directory !== undefined) unlinkAt(directory, "job.plist"); },
    () => { if (directory !== undefined) { const fd = directory; directory = undefined; closeSync(fd); } },
    () => { if (created) unlinkAt(parent, entry, true); },
    () => closeSync(parent),
  ]));
  const registration = Object.freeze({ domain: ownerDomain, target: ownerDomain + "/" + label, submission });
  registrations.add(registration); return registration;
}
/** A registration submitted by this process can request startup; it grants no permission
 * to release the helper's workload gate. Recovery never starts/stops by label. */
export function startLaunchdJob(registration: LaunchdJobRegistration, budgetMs: number): ProcessObservation {
  domain();
  if (!registrations.has(registration)) throw new TypeError("launchd start requires this process's submitted registration");
  return launchctl(["kickstart", registration.target], budgetMs);
}
