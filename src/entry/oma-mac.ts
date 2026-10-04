/** `oma` on the Mac (macos-platform §2.4 / DR28): the Human's command.
 * Society uses the Host API and carries the guest's screen. Personal uses
 * the native host engine, selected before any Host API token is read.
 *
 * usage: oma attach <society> [--takeover] | oma status | oma list
 *        oma open <society> --project <id> | oma stop
 *        oma pi install|remove|update|list ... [--project <id> | --host-only]
 */
import { readFileSync, realpathSync } from "node:fs";
import { ensureOwnedUserDirectory } from "../runtime/user-files.js";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { constants } from "node:os";
import { PlatformError } from "../platform/rpc.js";
import { errorCodeOf, errorExit, isErrorCode } from "../domain/errors.js";
import { hostApiRequest } from "../platform/host/api-client.js";
import { attachTerminal } from "../platform/host/attach-client.js";
import { PLATFORM_FRAME_BYTES } from "../protocol/host-guest.js";
import { PACKAGE_USAGE, packageActivation, packageCommand, packageListLines, writePackageIndex, type PackageCommand } from "../runtime/pi-packages.js";
import { pruneLocalStage, stageLocalPackage } from "../runtime/local-package.js";
import { reconcilePersonalSettings } from "../runtime/personal-settings.js";
import { parseMacArguments } from "../runtime/host-arguments.js";
import { ProcessLock } from "../runtime/process-lock.js";
import { runEngineLogin } from "../tui/login.js";
import { chooseSessionMode, chooseSociety } from "../tui/session-mode.js";
import { sessionBirthForHistory, RESUME_SESSION_ENV } from "../runtime/session-catalog.js";
import { requireSessionMode } from "../runtime/session-mode.js";
import { StoreError } from "../domain/errors.js";
import { withAsyncCleanup } from "../process/cleanup.js";
import { isGuestHistoryReference, parseGuestHistoryReference, type GuestHistory } from "../protocol/guest-history.js";
import { isValidSocietyName } from "../domain/identifiers.js";
import { hostPersonalHistoryQuery, inspectHostPersonalHistory } from "../platform/host/personal-histories.js";

function say(line: string, code: number): never { process.stderr.write(`${line}\n`); process.exit(code); }
const USAGE = `usage: oma [--mode society|personal] [--resume <history>]\n       oma bind <society> | attach <society> [--takeover] | status | list | open <society> --project <id> | stop\n${PACKAGE_USAGE.replace(/^usage: /, "       ")}\n       oma pi install|remove|update|list ... [--project <id> | --host-only]`;
let home: string, socketPath: string, token: string;

const STATES: Record<string, string> = { stopped: "Stopped", booting: "Starting", handshaking: "Starting", ready: "Running",
  draining: "Stopping", forced: "Stopping", crashed: "Restarting", failed: "Recovery required" };

/** P0-2/P0-5: display and selection read the same observation; malformed or
 * duplicate identities cannot become an empty list or an attach decision. */
function observedSocieties(reply: Record<string, unknown>): { society: string; running: boolean }[] {
  const entries = reply.societies;
  if (!Array.isArray(entries) || !entries.every(entry => entry !== null && typeof entry === "object" &&
      isValidSocietyName(entry.society) && typeof entry.running === "boolean") ||
      new Set(entries.map(entry => entry.society)).size !== entries.length)
    throw new StoreError("BROKER_UNAVAILABLE", "The Society list could not be observed");
  return entries as { society: string; running: boolean }[];
}

async function call(method: string, params: Record<string, unknown>, key?: string): Promise<Record<string, unknown>> {
  return await hostApiRequest(socketPath, token, method, params, key);
}

/** DR25: `oma pi` on the Mac. The engine has no network (MAC-203), so the
 * bundled engine's package manager runs here, in the Human's terminal, over
 * the Mac's package store (never the user's own ~/.pi), and the service then
 * carries the whole store to the engine, where the same `oma pi` code as on
 * Linux takes it on. `--project <id>` names the project whose Principal and
 * Workers get what was installed, as the project directory does on Linux.
 * DR28: explicit --host-only uses that store for Personal without the app or
 * guest synchronization; installing does not select a Personal extension. */
async function packages(decision: Extract<PackageCommand, { kind: "run" }>): Promise<never> {
  const { args, projectId } = decision;
  const store = join(home, "packages");
  // The store and the run root are oma's own under its support directory:
  // a mode-000 `packages` or `OMA` a stray left is repaired, not wedged on.
  ensureOwnedUserDirectory(store, home);
  ensureOwnedUserDirectory(join(home, "run"), home);
  const lock = ProcessLock.tryAcquire(join(home, "run", "packages.lock"));
  if (lock === null) say("Another oma pi command is running.", 1);
  const code = await withAsyncCleanup(async () => {
    const libdir = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
    // C20: a local source is copied into the store first; the engine installs
    // the staged `local/<name>`, never the path the Human gave.
    let run = decision;
    if (decision.local !== undefined)
      run = Object.freeze({ ...decision, args: Object.freeze(["install", stageLocalPackage(store, decision.local)]) });
    let code = await runEngineLogin({ stateRoot: join(store, "oma"), libdir: `${libdir}/`,
      override: process.env.OMA_PI_COMMAND, fence: lock.descriptor, env: process.env, packages: { store, args: run.args } });
    if (code === 0 && decision.command !== "list" && !args.includes("--help") && !args.includes("-h")) {
      lock.assertHeld(join(home, "run", "packages.lock"));
      await writePackageIndex(store);
      pruneLocalStage(store);
      reconcilePersonalSettings({ dataRoot: home, libdir, packages: store });
      if (decision.hostOnly) process.stdout.write("Host packages updated; Society packages were not synchronized. Select Personal extensions in Config > Extensions.\n");
      else {
        const activate = packageActivation(run);
        const synced = await call("packages.sync", { ...(projectId === undefined ? {} : { projectId }),
          ...(activate === undefined ? {} : { activate }) }, `pi-${randomUUID()}`);
        if (Array.isArray(synced.said) && synced.said.length > 0) process.stdout.write(`${synced.said.filter(line => typeof line === "string").join("\n")}\n`);
        code = synced.ok === true ? 0 : 1;
      }
    }
    if (code === 0 && decision.command === "list") {
      const contents = packageListLines(store);
      if (contents.length > 0) process.stdout.write(`Package contents:\n  ${contents.join("\n  ")}\n`);
    }
    return code;
  }, () => lock.close());
  process.exit(code);
}

async function main(argv: readonly string[]): Promise<void> {
  const parsed = parseMacArguments(argv);
  if (parsed.kind === "help") say(USAGE, 0);
  const decision = parsed.kind === "pi" ? packageCommand(parsed.args, true) : null;
  if (decision?.kind === "refused") say(decision.words, 2);
  const userHome = process.env.HOME;
  if (process.env.OMA_HOST_HOME === undefined && (userHome === undefined || !userHome.startsWith("/"))) say("HOME is not set", 2);
  home = process.env.OMA_HOST_HOME ?? join(userHome!, "Library", "Application Support", "OMA");
  socketPath = join(home, "run", "hostapi.sock");
  let society = parsed.kind === "session" ? parsed.society : undefined;
  let guestResume: GuestHistory | undefined;
  if (parsed.kind === "session") {
    const cwd = realpathSync(process.cwd());
    const resume = parsed.resume ?? process.env[RESUME_SESSION_ENV];
    let mode = parsed.mode;
    if (resume !== undefined) {
      if (isGuestHistoryReference(resume)) {
        guestResume = parseGuestHistoryReference(resume);
        if (mode !== undefined && mode !== "society") throw new StoreError("INVALID_REQUEST", "That saved history is a Society session");
        mode = "society"; society = guestResume.society;
      } else {
        const birth = await sessionBirthForHistory(home, resume, cwd);
        requireSessionMode(birth, mode); mode = birth.mode;
      }
    } else if (society !== undefined) mode = "society";
    else if (mode === undefined) {
      const selected = await chooseSessionMode({ input: process.stdin, output: process.stdout });
      if (selected === null) return;
      mode = selected;
    }
    if (mode === "personal") {
      const { personalMain } = await import("./personal-host.js");
      await personalMain({ dataRoot: home, cwd, packages: join(home, "packages"), ...(resume === undefined ? {} : { resume }) });
      return;
    }
  }
  // Host-only package changes are explicit local effects, never a fallback after
  // a failed Society observation, and do not require the app's token.
  if (decision?.kind === "run" && decision.hostOnly) return packages(decision);
  try { token = readFileSync(join(home, "run", "token"), "utf8").trim(); }
  catch { say("OMA is not running. Open the OMA app, or use --host-only for package operations without the VM.", 3); }
  if (decision?.kind === "run") return packages(decision);
  const command = parsed.kind;
  if (parsed.kind === "bind") {
    const bound = await call("project.bind", { society: parsed.society, macRepo: realpathSync(process.cwd()) });
    process.stdout.write(`${bound.projectId}\n`);
    return;
  }
  if (command === "status") {
    const { state } = await call("engine.status", {});
    process.stdout.write(`OMA engine: ${STATES[String(state)] ?? "Unknown"}\n`);
    return;
  }
  if (command === "list") {
    const societies = observedSocieties(await call("society.list", {}));
    for (const entry of societies) process.stdout.write(`${entry.society}\t${entry.running ? "Running" : "Stopped"}\n`);
    return;
  }
  if (command === "stop") { const { result } = await call("engine.stop", {}); say(result === "forced" ? "OMA engine was force-stopped. Recovery will run at next start." : "OMA engine stopped.", 0); }
  if (guestResume !== undefined) await call("session.resume", { ...guestResume });
  if (parsed.kind === "session" && society === undefined) {
    const running = observedSocieties(await call("society.list", {})).filter(entry => entry.running);
    if (running.length === 0) say("No Society is open. Open one in the OMA app or use oma open <society> --project <id>.", 1);
    society = running.length === 1 ? running[0]!.society
      : await chooseSociety({ input: process.stdin, output: process.stdout }, running.map(entry => entry.society)) ?? undefined;
    if (society === undefined) return;
  }
  if (parsed.kind === "open") await call("society.open", { society: parsed.society, projectId: parsed.projectId });
  if (parsed.kind === "open" || parsed.kind === "attach") society = parsed.society;
  if (society === undefined) say(USAGE, 2);
  const end = await attachTerminal({ socketPath, token, society, takeover: parsed.kind === "attach" && parsed.takeover,
    frameBytes: PLATFORM_FRAME_BYTES, deadlineMs: 180_000,
    histories: query => hostPersonalHistoryQuery(home, query),
    terminal: { input: process.stdin, output: process.stdout,
      onResize: listener => { process.stdout.on("resize", listener); return () => { process.stdout.off("resize", listener); }; } } });
  if (end.kind === "exit") {
    if (end.next === "new" || end.next === "resume") {
      if (end.code !== 0 || end.signal !== null) throw new StoreError("BROKER_UNAVAILABLE", "The previous session did not end normally");
      if (process.execve === undefined) throw new StoreError("UNSUPPORTED_PROFILE", "This Node cannot restart oma in place; start oma again");
      const env = { ...process.env };
      delete env[RESUME_SESSION_ENV];
      if (end.next === "resume") {
        if (isGuestHistoryReference(end.history!)) {
          parseGuestHistoryReference(end.history!);
          env[RESUME_SESSION_ENV] = end.history;
        } else {
          const selected = await inspectHostPersonalHistory(home, end.history!);
          process.chdir(selected.birth.cwd);
          env[RESUME_SESSION_ENV] = selected.file;
        }
      }
      const libdir = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
      process.execve(process.execPath, [process.execPath, ...process.execArgv, join(libdir, "dist", "src", "entry", "oma.js")], env);
      return;
    }
    process.exit(end.code ?? 1);
  }
  // Asked to end: the conventional status of a process a signal ended.
  if (end.kind === "stopped") process.exit(128 + (constants.signals[end.signal as NodeJS.Signals] ?? 0));
  if (end.kind === "detached") say("Another UI took over this society.", 0);
  if (end.kind === "refused") say(end.code === "ATTACH_CONFLICT" ? "This society is open in another UI. Add --takeover to continue here." : end.message, 1);
  // P0-5: the connection ended without a word; the society may still run.
  say("Disconnected from the OMA engine. The society may still be running.", 3);
}
main(process.argv.slice(2)).catch(error => {
  // CLI-003/DR13 on the Mac (NB-25): 2 a settled refusal, 3 an outcome that
  // is not yet known, 4 a gate the app or profile will not pass.
  if (error instanceof PlatformError) {
    const failure = error.failure;
    const code = isErrorCode(failure.code) ? errorExit(failure.code, failure.retry) : (failure.retry === "never" ? 4 : 3);
    say(failure.retry === "same-key" ? "Checking the outcome. Try again shortly." : failure.message, code);
  }
  const code = errorCodeOf(error);
  if (code === "INVALID_REQUEST") say(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`, 2);
  say(error instanceof Error ? error.message : String(error), errorExit(code));
});
