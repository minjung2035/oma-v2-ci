// Pure subprocess contract. No Store, authority, queue, path repair or service allocation.
export interface CommandSpec {
  readonly executable: string; readonly argv: readonly string[];
  readonly env: Readonly<NodeJS.ProcessEnv>; readonly cwd?: string;
  readonly input?: string | Uint8Array;
  readonly timeoutMs: number; readonly stdoutBytes: number; readonly stderrBytes: number;
  readonly stderrOverflow?: "limit" | "discard";
}
export interface Capture {
  readonly stdout: Buffer; readonly stderr: Buffer;
  readonly stdoutTruncated: boolean; readonly stderrTruncated: boolean;
  readonly signal: NodeJS.Signals | null; readonly errorCode: string | null; readonly elapsedMs: number;
}
export type ProcessObservation = Capture & (
  | { readonly kind: "exited"; readonly exitCode: number }
  | { readonly kind: "timed-out" | "aborted" | "output-limited" | "signalled" | "spawn-failed" | "unobserved"; readonly exitCode: number | null }
);
function positive(value: number, label: string, zero = false): void {
  if (!Number.isSafeInteger(value) || value < (zero ? 0 : 1)) throw new RangeError(`invalid subprocess ${label}`);
}
export function validateCommand(spec: CommandSpec): void {
  if (!spec.executable || spec.executable.includes("\0") || !Array.isArray(spec.argv) || spec.argv.some(arg => typeof arg !== "string" || arg.includes("\0")))
    throw new TypeError("invalid subprocess command");
  if (spec.cwd !== undefined && (typeof spec.cwd !== "string" || !spec.cwd || spec.cwd.includes("\0"))) throw new TypeError("invalid subprocess cwd");
  for (const [key, value] of Object.entries(spec.env))
    if (!key || /[=\0]/.test(key) || (value !== undefined && (typeof value !== "string" || value.includes("\0")))) throw new TypeError("invalid subprocess environment");
  positive(spec.timeoutMs, "timeout"); positive(spec.stdoutBytes, "stdout budget", true); positive(spec.stderrBytes, "stderr budget", true);
  if (spec.timeoutMs > 0x7fffffff) throw new RangeError("subprocess timeout exceeds the supported native timer interval");
  positive(spec.stdoutBytes + spec.stderrBytes, "combined output budget", true);
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
    ...(source.stderrOverflow === undefined ? {} : { stderrOverflow: source.stderrOverflow }) });
}
export function processErrorCode(error: unknown): string | null {
  return error !== null && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null;
}
