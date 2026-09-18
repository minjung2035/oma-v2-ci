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
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { StoreError } from "../domain/errors.js";

export const PI_PACKAGE = "@earendil-works/pi-coding-agent";
/** Pi derives this name from its own APP_NAME; pointing it elsewhere is the
 * supported way to keep one installation's state separate from another's. */
export const PI_AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

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

function regularFile(path: string): boolean {
  try { return statSync(path).isFile(); } catch { return false; }
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
  catch { return null; }
  if (manifest.name !== PI_PACKAGE) return null;
  const bin = manifest.bin;
  const relative = typeof bin === "string" ? bin : bin?.["pi"];
  if (typeof relative !== "string" || relative.length === 0) return null;
  const entry = resolve(dirname(packageJsonPath), relative);
  return regularFile(entry) ? entry : null;
}

/** Every `node_modules` directory from `from` up to the filesystem root. */
function nodeModulesChain(from: string): string[] {
  const roots: string[] = [];
  let current = from;
  const stop = parse(current).root;
  for (;;) {
    roots.push(join(current, "node_modules"));
    if (current === stop) break;
    const next = dirname(current);
    if (next === current) break;
    current = next;
  }
  return roots;
}

function bundledEntry(libdir: string | undefined): string | null {
  const roots: string[] = [];
  // A deployed tree ships its own engine beside the installed code.
  if (libdir !== undefined && isAbsolute(libdir)) roots.push(...nodeModulesChain(libdir));
  roots.push(...nodeModulesChain(dirname(fileURLToPath(import.meta.url))));
  const seen = new Set<string>();
  for (const root of roots) {
    if (seen.has(root)) continue;
    seen.add(root);
    const manifest = join(root, PI_PACKAGE, "package.json");
    if (!regularFile(manifest)) continue;
    const entry = entryFromPackage(manifest);
    if (entry !== null) return entry;
  }
  return null;
}

/** The agent directory OMA gives Pi. It is inside the society's state root, so
 * it is backed up, removed and reasoned about with the rest of OMA's state.
 */
export function piAgentDir(stateRoot: string): string {
  return join(stateRoot, "pi");
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
