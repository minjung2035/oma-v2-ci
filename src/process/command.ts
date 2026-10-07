// Pure subprocess contract. No Store, authority, queue, path repair or service allocation.

export interface CommandSpec {
  readonly executable: string; readonly argv: readonly string[];
  readonly env: Readonly<NodeJS.ProcessEnv>; readonly cwd?: string;
  readonly input?: string | Uint8Array;
  readonly timeoutMs: number; readonly stdoutBytes: number; readonly stderrBytes: number;
  readonly stderrOverflow?: "limit" | "discard";
  /** Async runner only: a silence budget, re-armed by every byte the command
   * writes. `timeoutMs` stays the never-exceeded ceiling; `silenceMs` is the
   * window without any output after which the command is ended as `stalled`,
   * so a command that is making progress is not cut by the clock while one
   * that says nothing still ends. The synchronous runner cannot observe a
   * stream mid-flight and refuses the field rather than ignore it. */
  readonly silenceMs?: number;
  /** Full-fidelity spill destinations: the stream's complete bytes land in
   * this file, so size alone never kills a command whose output the caller
   * asked to keep whole. The asynchronous runner keeps the in-memory head in
   * the result and appends the rest (the file holds head + rest, in order);
   * the synchronous runner hands the child the file's own descriptor, so its
   * buffer is empty and the file holds the whole stream. Either way the
   * observation names the path, and the caller owns the directory and the
   * file's cleanup. */
  readonly stdoutSpool?: string;
  readonly stderrSpool?: string;
}
export interface Capture {
  readonly stdout: Buffer; readonly stderr: Buffer;
  readonly stdoutTruncated: boolean; readonly stderrTruncated: boolean;
  /** Set when the stream was spooled: `stdout`/`stderr` hold the retained
   * head (empty for the synchronous runner, which writes the file
   * descriptor-direct), and the file holds the stream's complete bytes. */
  readonly stdoutSpooledTo?: string; readonly stderrSpooledTo?: string;
  readonly signal: NodeJS.Signals | null; readonly errorCode: string | null; readonly elapsedMs: number;
}
export type ProcessObservation = Capture & (
  | { readonly kind: "exited"; readonly exitCode: number }
  | { readonly kind: "timed-out" | "stalled" | "aborted" | "output-limited" | "signalled" | "spawn-failed" | "unobserved"; readonly exitCode: number | null }
);
function positive(value: number, label: string, zero = false): void {
  if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1)) throw new RangeError(`invalid subprocess ${label}`);
}
function spoolPath(value: string | undefined, label: string): void {
  if (value === undefined) return;
  // The file is opened in the parent: a relative spelling would resolve
  // against this process's cwd, not the command's -- refuse it rather than
  // write somewhere nobody named. Every platform this runs on is POSIX, so
  // absolute is spelled "/" -- the contract keeps no path-module capability.
  if (typeof value !== "string" || !value.startsWith("/") || value.includes("\0")) throw new TypeError(`invalid subprocess ${label}`);
}
export function validateCommand(spec: CommandSpec): void {
  if (!spec.executable || spec.executable.includes("\0") || !Array.isArray(spec.argv) || spec.argv.some(arg => typeof arg !== "string" || arg.includes("\0")))
    throw new TypeError("invalid subprocess command");
  if (spec.cwd !== undefined && (typeof spec.cwd !== "string" || !spec.cwd || spec.cwd.includes("\0"))) throw new TypeError("invalid subprocess cwd");
  for (const [key, value] of Object.entries(spec.env))
    if (!key || /[=\0]/.test(key) || (value !== undefined && (typeof value !== "string" || value.includes("\0")))) throw new TypeError("invalid subprocess environment");
  positive(spec.timeoutMs, "timeout"); positive(spec.stdoutBytes, "stdout budget", true); positive(spec.stderrBytes, "stderr budget", true);
  if (spec.timeoutMs > 0x7fffffff) throw new RangeError("subprocess timeout exceeds the supported native timer interval");
  if (spec.silenceMs !== undefined) {
    positive(spec.silenceMs, "silence window");
    if (spec.silenceMs > 0x7fffffff) throw new RangeError("subprocess silence window exceeds the supported native timer interval");
    // A silence window wider than the ceiling is a contradiction in the
    // description, not a meaningful one: the ceiling would always fire first.
    if (spec.silenceMs > spec.timeoutMs) throw new RangeError("subprocess silence window exceeds its timeout");
  }
  positive(spec.stdoutBytes + spec.stderrBytes, "combined output budget", true);
  spoolPath(spec.stdoutSpool, "stdout spill path"); spoolPath(spec.stderrSpool, "stderr spill path");
  if (spec.stderrOverflow !== undefined && spec.stderrOverflow !== "limit" && spec.stderrOverflow !== "discard") throw new TypeError("invalid subprocess stderr policy");
  if (spec.input !== undefined && typeof spec.input !== "string" && !(spec.input instanceof Uint8Array)) throw new TypeError("invalid subprocess input");
}
/** Called before any await; mutable byte input is privately copied as well.
 * This snapshot is a command description, never a token granting current authority.
 */
export function snapshotCommand(source: CommandSpec): CommandSpec {
  validateCommand(source);
  return Object.freeze({ executable: source.executable, argv: Object.freeze([...source.argv]), env: Object.freeze({ ...source.env }),
    timeoutMs: source.timeoutMs, stdoutBytes: source.stdoutBytes, stderrBytes: source.stderrBytes,
    ...(source.cwd === undefined ? {} : { cwd: source.cwd }),
    ...(source.input === undefined ? {} : { input: typeof source.input === "string" ? source.input : Buffer.from(source.input) }),
    ...(source.silenceMs === undefined ? {} : { silenceMs: source.silenceMs }),
    ...(source.stdoutSpool === undefined ? {} : { stdoutSpool: source.stdoutSpool }),
    ...(source.stderrSpool === undefined ? {} : { stderrSpool: source.stderrSpool }),
    ...(source.stderrOverflow === undefined ? {} : { stderrOverflow: source.stderrOverflow }) });
}
export function processErrorCode(error: unknown): string | null {
  return error !== null && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null;
}
