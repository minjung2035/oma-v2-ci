/** guesthost's request ledger (macos-platform MAC-240, MAC-241).
 *
 * Each keyed request leaves two immutable records under the ledger
 * directory, each published once and never replaced: its intent, before any
 * effect, and its outcome, after. The same key with other content is refused
 * (REQUEST_KEY_REUSED); the same request again is answered from its outcome.
 * A request whose intent is recorded and whose outcome is not was cut off:
 * every method kept here has an idempotent effect (fetching a verified bundle
 * into refs only it names, or reading), so it is run again to its outcome.
 * No intent is proof the request never started (REQUEST_NOT_FOUND).
 *
 * This ledger is guesthost's own. A society's operation ledger is its
 * broker's, the only writer of its Store (REC-007); nothing here writes it.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StoreError, errorCodeOf } from "../../domain/errors.js";
import { publishNoReplace, ensureDurableDirectory } from "../../storage/durable-fs.js";
import { PlatformError } from "../rpc.js";
import { isRequestKey, type PlatformFailure } from "../../protocol/host-guest.js";

type Outcome = { readonly ok: true; readonly result: Record<string, unknown> } | { readonly ok: false; readonly error: PlatformFailure };

/** A stable digest of what was asked: key order does not change it. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export class RequestLedger {
  constructor(private readonly dir: string) { ensureDurableDirectory(dir, 0o700); }

  private name(key: string): string { return createHash("sha256").update(key).digest("hex"); }
  private read<T>(path: string): T | null {
    try { return JSON.parse(readFileSync(path, "utf8")) as T; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw new StoreError("STORE_CORRUPT", "a request record is damaged"); }
  }
  /** Where a request may keep its bytes (a staged stream), by its key. */
  staging(key: string, suffix: string): string { return join(this.dir, `${this.name(key)}.${suffix}`); }

  async run(key: unknown, method: string, params: Record<string, unknown>, effect: () => Promise<Record<string, unknown>>): Promise<Record<string, unknown>> {
    if (!isRequestKey(key)) throw new StoreError("INVALID_REQUEST", "this request needs a request key");
    const base = join(this.dir, this.name(key));
    const digest = createHash("sha256").update(`${method}\n${canonical(params)}`).digest("hex");
    if (publishNoReplace(`${base}.intent.json`, JSON.stringify({ key, method, digest })) === "existing") {
      const intent = this.read<{ key: string; method: string; digest: string }>(`${base}.intent.json`);
      if (intent === null || intent.key !== key || intent.method !== method || intent.digest !== digest)
        throw new StoreError("REQUEST_KEY_REUSED", "this request key was used for another request");
      const outcome = this.read<Outcome>(`${base}.outcome.json`);
      if (outcome !== null) return this.answer(outcome);
    }
    let outcome: Outcome;
    try { outcome = { ok: true, result: await effect() }; }
    catch (error) {
      if (error instanceof PlatformError) throw error;
      const code = errorCodeOf(error);
      // Only a refusal is an outcome; anything else leaves the request to run again.
      if (code === "INTERNAL_ERROR" || code === "BROKER_UNAVAILABLE" || code === "STORAGE_FULL") throw error;
      outcome = { ok: false, error: { code, message: error instanceof Error ? error.message : code, retry: "never" } };
    }
    publishNoReplace(`${base}.outcome.json`, JSON.stringify(outcome));
    return this.answer(this.read<Outcome>(`${base}.outcome.json`) ?? outcome);
  }

  private answer(outcome: Outcome): Record<string, unknown> {
    if (outcome.ok) return outcome.result;
    throw new PlatformError(outcome.error);
  }

  /** MAC-241: what became of a request, by its key. */
  status(key: unknown): Record<string, unknown> {
    if (!isRequestKey(key)) throw new StoreError("INVALID_REQUEST", "invalid request key");
    const base = join(this.dir, this.name(key));
    const intent = this.read<{ method: string }>(`${base}.intent.json`);
    if (intent === null) throw new StoreError("REQUEST_NOT_FOUND", "no request with this key was started");
    const outcome = this.read<Outcome>(`${base}.outcome.json`);
    if (outcome === null) return { state: "pending", method: intent.method };
    return outcome.ok ? { state: "done", method: intent.method, result: outcome.result } : { state: "refused", method: intent.method, error: outcome.error };
  }
}
