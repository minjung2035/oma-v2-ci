/** OMA ships and owns its own Pi engine.
 *
 * The product must work on a machine that has no Pi installed, and must not
 * disturb a Pi the user installed for themselves. Both follow from one rule:
 * OMA never resolves Pi from PATH. It runs the engine that came with this
 * installation and points that engine at an agent directory OMA owns, so the
 * user's `~/.pi` configuration, extensions and sessions are untouched and
 * unread.
 *
 * Pi is vendored unmodified. This module resolves and isolates it; it does not
 * patch it, and OMA's own behaviour lives in the trusted core extension.
 */
import { OMA_THEME, OMA_THEME_NAME } from "./oma-theme.js";
import { closeSync, fstatSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { ensureDirectory } from "../storage/directory.js";
import { openDirectory, openRegularBeneath } from "../storage/contained-fs.js";
import { replaceDerivedFile } from "../storage/durable-fs.js";
import { ensureUserDirectory, readUserFile, replaceUserFile } from "./user-files.js";
import { ProcessLock } from "./process-lock.js";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { StoreError, unobserved } from "../domain/errors.js";
import { withCleanup } from "../process/cleanup.js";
import { decodeUtf8 } from "../domain/utf8.js";
import { isValidSocietyName } from "../domain/identifiers.js";

export const PI_PACKAGE = "@earendil-works/pi-coding-agent";
/** Pi derives this name from its own APP_NAME; pointing it elsewhere is the
 * supported way to keep one installation's state separate from another's. */
export const PI_AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";
export const PI_PROVIDER_RETRIES = 5;

/** INF-001: configure the engine's retry owner, never replay requests in the
 * relay or restart a tool-bearing turn. Provider-internal retries are disabled
 * so five retries mean six calls, not two nested retry budgets. Called before
 * spawn, under the settings writer's lock; unrelated engine settings survive. */
function prepareEngineFile(agentDir: string, name: string,
  update: (settings: Record<string, unknown>) => Record<string, unknown>): void {
  ensureUserDirectory(agentDir);
  const lock = ProcessLock.acquire(join(agentDir, "oma-settings.lock"));
  withCleanup(() => {
    const bytes = readUserFile(join(agentDir, name), 1024 * 1024, { singleName: true });
    const settings = bytes === null ? {} : settingsObject(JSON.parse(bytes));
    const next = JSON.stringify(update(settings), null, 2) + "\n";
    if (next !== bytes) replaceUserFile(join(agentDir, name), next);
  }, () => lock.close());
}

function settingsObject(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new StoreError("UNSUPPORTED_PROFILE", "engine settings must be an object");
  return value as Record<string, unknown>;
}

export function preparePiRetry(agentDir: string): void {
  prepareEngineFile(agentDir, "settings.json", settings => {
    const retry = settingsObject(settings.retry);
    const provider = settingsObject(retry.provider);
    const delay = (value: unknown, fallback: number): number =>
      typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 8000 ? value : fallback;
    return { ...settings, retry: { ...retry, enabled: true, maxRetries: PI_PROVIDER_RETRIES,
      baseDelayMs: delay(retry.baseDelayMs, 1000), maxAgentDelayMs: delay(retry.maxAgentDelayMs, 8000),
      provider: { ...provider, maxRetries: 0 } } };
  });
}

/** Presentation policy persists across Pi's own settings reloads. Only the
 * society's isolated engine files are touched; unrelated choices survive. */
export function preparePiInteractive(agentDir: string): void {
  // The look of Open TUI's own preview is the default; what the Human then
  // chooses in /settings or /open-tui is kept. Telemetry to Pi stays off.
  prepareEngineFile(join(agentDir, "themes"), `${OMA_THEME_NAME}.json`, () => ({ ...OMA_THEME }));
  prepareEngineFile(agentDir, "settings.json", settings => {
    // C16: skill commands are Pi's ordinary surface and stay enabled; an
    // earlier suppression persisted in this file is scrubbed once here rather
    // than pinned over again.
    const scrubbed = { ...settings };
    delete scrubbed.enableSkillCommands;
    return { ...scrubbed,
      theme: settings.theme ?? OMA_THEME_NAME,
      hideThinkingBlock: settings.hideThinkingBlock ?? true, quietStartup: settings.quietStartup ?? true,
      enableInstallTelemetry: false, enableAnalytics: false, fullscreenExitOutput: "resume-hint",
    };
  });
  // Ctrl+X is oma's settings; the engine's copy stays on /copy, and its
  // "clear all models" in the scoped-model list is left without a key.
  prepareEngineFile(agentDir, "keybindings.json", keys => ({ ...keys, "app.message.copy": keys["app.message.copy"] ?? [],
    "app.models.clearAll": keys["app.models.clearAll"] ?? [] }));
  prepareEngineFile(agentDir, "open-tui.json", settings => ({ ...settings, enabled: true,
    telemetry: settings.telemetry ?? { enabled: false }, thinkingPeek: settings.thinkingPeek ?? { lines: 0 } }));
}

/** A bounded regular file of `directory`, or null when there is none. Never
 * follows a link. */
export function engineFile(directory: string, name: string, bound: number): { bytes: Uint8Array; mtimeMs: number } | null {
  let parent: number;
  try { parent = openDirectory(directory); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  return withCleanup(() => {
    let fd: number;
    try { fd = openRegularBeneath(parent, name); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    return withCleanup(() => {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size > bound)
        throw new StoreError("UNSUPPORTED_PROFILE", `engine file ${name} is not a bounded regular file`);
      const bytes = Buffer.alloc(stat.size);
      let used = 0;
      while (used < bytes.length) {
        const count = readSync(fd, bytes, used, bytes.length - used, used);
        if (count === 0) throw new StoreError("UNSUPPORTED_PROFILE", `engine file ${name} changed while being read`);
        used += count;
      }
      return { bytes, mtimeMs: stat.mtimeMs };
    }, () => closeSync(fd));
  }, () => closeSync(parent));
}

/** What an earlier engine directory of one society held and the one engine
 * home takes on: its login, its own choices and its fetched tools. */
const ADOPTED_FILES = Object.freeze(["settings.json", "open-tui.json", "keybindings.json", "models.json", "models-store.json"]);
const ADOPTED_TOOLS = Object.freeze(["fd", "rg"]);
const FILE_BYTES = 1024 * 1024;
const TOOL_BYTES = 64 * 1024 * 1024;

/** DR24: the engine home is one for the Human, as the engine's own is: a login,
 * a model and a theme chosen once hold in every session. Before DR24 each
 * society had its own; the first start after it adopts them -- every login any
 * of them held (the newest where two hold the same provider) and the newest
 * of each other file -- without removing or changing them. */
export function adoptEngineHome(agentDir: string): void {
  ensureDirectory(agentDir, 0o700);
  const lock = ProcessLock.acquire(join(agentDir, "oma-settings.lock"));
  withCleanup(() => {
    const dataRoot = dirname(agentDir);
    const earlier = readdirSync(dataRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && isValidSocietyName(entry.name))
      .map(entry => join(dataRoot, entry.name, "pi"));
    if (engineFile(agentDir, "auth.json", FILE_BYTES) === null) {
      const logins = earlier.map(dir => engineFile(dir, "auth.json", FILE_BYTES)).filter(found => found !== null)
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      const merged: Record<string, unknown> = {};
      for (const login of logins) {
        let value: unknown;
        try { value = JSON.parse(decodeUtf8(login.bytes)); } catch { continue; }
        if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
        for (const [provider, credential] of Object.entries(value)) if (!Object.hasOwn(merged, provider)) merged[provider] = credential;
      }
      if (Object.keys(merged).length > 0) replaceDerivedFile(join(agentDir, "auth.json"), `${JSON.stringify(merged, null, 2)}\n`, 0o600);
    }
    for (const name of ADOPTED_FILES) {
      if (engineFile(agentDir, name, FILE_BYTES) !== null) continue;
      const newest = earlier.map(dir => engineFile(dir, name, FILE_BYTES)).filter(found => found !== null)
        .sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
      if (newest) replaceDerivedFile(join(agentDir, name), newest.bytes, 0o600);
    }
    for (const name of ADOPTED_TOOLS) {
      if (engineFile(join(agentDir, "bin"), name, TOOL_BYTES) !== null) continue;
      const found = earlier.map(dir => engineFile(join(dir, "bin"), name, TOOL_BYTES)).find(tool => tool !== null);
      if (found) replaceDerivedFile(join(agentDir, "bin", name), found.bytes, 0o755);
    }
  }, () => lock.close());
}

export interface PiRuntime {
  /** Executable to spawn. The bundle is JavaScript, so this is the Node that
   * runs OMA unless the host pinned a different one. */
  readonly executable: string;
  /** Arguments that must precede Pi's own flags. */
  readonly args: readonly string[];
  /** The resolved Pi entry file, kept for assertions and diagnostics. */
  readonly bundle: string;
  /** OMA-owned agent directory handed to Pi. */
  readonly agentDir: string;
  readonly source: "bundled" | "host-pinned";
}

export interface PiRuntimeOptions {
  /** State root of this society; the isolated agent directory lives under it. */
  readonly stateRoot: string;
  /** Installation directory, searched before this module's own resolution so a
   * deployed tree uses the Pi it shipped with. */
  readonly libdir?: string | undefined;
  /** Explicit host override. Escapes bundling on purpose, for operators. */
  readonly override?: string | undefined;
  /** Node to run the bundle with. Defaults to the Node running OMA. */
  readonly node?: string | undefined;
}

/** A name that is not there is not a regular file; one that cannot be
 * observed now is no answer (DR13). */
function regularFile(path: string): boolean {
  try { return statSync(path).isFile(); }
  catch (error) { const unknown = unobserved(error, `the Pi runtime file ${path}`); if (unknown !== null) throw unknown; return false; }
}

/** Reads the vendored package's own `bin.pi`, so the entry file is whatever the
 * upstream package declares rather than a path this repository guesses.
 *
 * The manifest is read from disk rather than through a module resolver: Pi
 * publishes an `exports` map that does not expose `./package.json`, so resolver
 * lookups fail even though the package is installed.
 */
function entryFromPackage(packageJsonPath: string): string | null {
  let manifest: { name?: string; bin?: string | Record<string, string> };
  try { manifest = JSON.parse(readFileSync(packageJsonPath, "utf8")) as typeof manifest; }
  catch (error) { const unknown = unobserved(error, `the Pi package manifest ${packageJsonPath}`); if (unknown !== null) throw unknown; return null; }
  if (manifest.name !== PI_PACKAGE) return null;
  const bin = manifest.bin;
  const relative = typeof bin === "string" ? bin : bin?.["pi"];
  if (typeof relative !== "string" || relative.length === 0) return null;
  const entry = resolve(dirname(packageJsonPath), relative);
  return regularFile(entry) ? entry : null;
}

/** WP31: the engine this installation shipped, and no other. The lookup used
 * to walk every `node_modules` from the installation up to `/`, like module
 * resolution does, so an installation missing its engine quietly ran another
 * installation's (`/opt/node_modules`, a home directory's). Only the
 * installation root's own `node_modules` counts: the configured `libdir`, or
 * the root this module was installed in. */
function bundledEntry(libdir: string | undefined): string | null {
  const installation = libdir !== undefined && isAbsolute(libdir)
    ? libdir : resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const manifest = join(installation, "node_modules", PI_PACKAGE, "package.json");
  return regularFile(manifest) ? entryFromPackage(manifest) : null;
}

/** Where the Human's engine state lives beside the societies: a name no
 * society can have. */
export const ENGINE_HOME = ".engine";

/** The agent directory OMA gives Pi (DR24): one for the Human, beside the
 * societies in OMA's own state root, never `~/.pi`. Login, the chosen model and
 * effort, theme and keys are the Human's, as the engine's own are; what belongs
 * to one session -- its conversation, mail, workers and repositories -- stays in
 * that society. */
export function piAgentDir(stateRoot: string): string {
  return join(dirname(stateRoot), process.platform === "darwin" ? "engine" : ENGINE_HOME);
}

export function resolvePiRuntime(options: PiRuntimeOptions): PiRuntime {
  const node = options.node ?? process.execPath;
  const agentDir = piAgentDir(options.stateRoot);
  const override = options.override;
  if (override !== undefined && override.length > 0) {
    if (!isAbsolute(override))
      throw new StoreError("UNSUPPORTED_PROFILE", "the Pi override must be an absolute path");
    if (!regularFile(override))
      throw new StoreError("UNSUPPORTED_PROFILE", `the pinned Pi executable is missing: ${override}`);
    // A pinned path may be a native executable or a script; run it directly.
    return Object.freeze({ executable: override, args: Object.freeze([]), bundle: override, agentDir, source: "host-pinned" as const });
  }
  const bundle = bundledEntry(options.libdir);
  if (bundle === null)
    throw new StoreError(
      "UNSUPPORTED_PROFILE",
      `this installation ships no Pi engine (${PI_PACKAGE}); OMA does not fall back to a Pi on PATH`,
    );
  return Object.freeze({ executable: node, args: Object.freeze([bundle]), bundle, agentDir, source: "bundled" as const });
}

/** Isolation variables for the spawned engine. Setting the agent directory is
 * what keeps OMA and a user's own Pi from sharing configuration, extensions or
 * sessions; without it both would read the same `~/.pi`.
 */
export function piIsolationEnv(runtime: PiRuntime): Readonly<Record<string, string>> {
  return Object.freeze({ [PI_AGENT_DIR_ENV]: runtime.agentDir });
}
