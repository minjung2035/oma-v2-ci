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
import { closeSync, fstatSync, readFileSync, readSync, statSync } from "node:fs";
import { openDirectory, openRegularBeneath } from "../storage/contained-fs.js";
import { lockedUserReplace } from "./locked-files.js";
import { prepareEngineInteractiveSettings, settingsObject } from "../pi-compat/settings.js";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { StoreError, unobserved } from "../domain/errors.js";
import { withCleanup } from "../process/cleanup.js";

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
  lockedUserReplace(agentDir, name, 1024 * 1024, current => {
    // Persisted bytes the engine owns that cannot be interpreted are store
    // corruption, never a raw SyntaxError escaping the taxonomy.
    let parsed: unknown = {};
    if (current !== undefined)
      try { parsed = JSON.parse(current); }
      catch (cause) { throw new StoreError("STORE_CORRUPT", `engine file ${name} is not valid JSON`, { cause }); }
    const settings = settingsObject(parsed);
    return JSON.stringify(update(settings), null, 2) + "\n";
  });
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
  // A4: the settings fields Pi has setters for go through its SettingsManager;
  // the locked read-modify-replace is OMA's storage (pi-compat/settings.ts).
  prepareEngineInteractiveSettings(agentDir);
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
