/** guesthost's request ledger (macos-platform MAC-240, MAC-241).
 *
 * Each keyed request leaves two immutable records under the ledger
 * directory, each published once and never replaced: its intent, before any
 * effect, and its outcome, after. The same key with other content is refused
 * (REQUEST_KEY_REUSED); the same request again is answered from its outcome.
 * A request with intent but no outcome may still be running or was cut off:
 * every method kept here has an idempotent effect (fetching a verified bundle
 * into refs only it names, or reading), so an inactive request may be retried.
 * Same-key calls cannot run beside the active owner; no waiting queue is kept.
 * No intent is proof the request never started (REQUEST_NOT_FOUND).
 *
 * This ledger is guesthost's own. A society's operation ledger is its
 * broker's, the only writer of its Store (REC-007); nothing here writes it.
 */
import { canonicalJson, sha256Hex } from "../../domain/canonical-json.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { StoreError, primaryFailure, unobserved } from "../../domain/errors.js";
import { publishNoReplace, ensureOwnedDurableDirectory } from "../../storage/durable-fs.js";
import { PlatformError, platformFailure } from "../rpc.js";
import { isPlatformErrorCode, isRequestKey, type PlatformFailure } from "../../protocol/host-guest.js";

interface Intent { readonly key: string; readonly method: string; readonly digest: string }
type Outcome = { readonly ok: true; readonly result: Record<string, unknown> } | { readonly ok: false; readonly error: PlatformFailure };

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) if (!Object.hasOwn(value, key)) return `missing ${key}`;
  for (const key of Object.keys(value)) if (!keys.includes(key)) return `unknown field ${key}`;
  return null;
}

/** A record is accepted only as exactly what this ledger writes; anything
 * else is damaged, never read through truthiness (AV-20261003-17). */
function isIntent(value: unknown): value is Intent {
  return object(value) && exactKeys(value, ["key", "method", "digest"]) === null &&
    typeof value.key === "string" && typeof value.method === "string" &&
    typeof value.digest === "string" && /^[0-9a-f]{64}$/.test(value.digest);
}
function isPlatformFailure(value: unknown): value is PlatformFailure {
  return object(value) && exactKeys(value, ["code", "message", "retry"]) === null &&
    isPlatformErrorCode(value.code) &&
    typeof value.message === "string" && value.message.length <= 1024 &&
    (value.retry === "never" || value.retry === "same-key" || value.retry === "after-repair");
}
function isOutcome(value: unknown): value is Outcome {
  if (!object(value)) return false;
  if (value.ok === true) return exactKeys(value, ["ok", "result"]) === null && object(value.result);
  if (value.ok !== false) return false; // "ok": "false" is damaged, not a refusal
  return exactKeys(value, ["ok", "error"]) === null && isPlatformFailure(value.error);
}

export class RequestLedger {
  private readonly active = new Set<string>();
  constructor(private readonly dir: string) {
    // P0-8/DR32: the request ledger is oma's own; its leaf is repaired, its
    // parent never is.
    ensureOwnedDurableDirectory(dir, dirname(dir), 0o700);
  }

  private name(key: string): string { return sha256Hex(key); }
  /** Parses a record; JSON that does not parse is damaged. A file holding
   * `null` is still a file: presence is told apart from an absent record. */
  private read(path: string): { readonly present: boolean; readonly value: unknown } {
    let bytes: string;
    try { bytes = readFileSync(path, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { present: false, value: null };
      throw unobserved(error, "the request record") ?? error;
    }
    try { return { present: true, value: JSON.parse(bytes) as unknown }; }
    catch (cause) { throw new StoreError("STORE_CORRUPT", "a request record is damaged", { cause }); }
  }
  /** A record this ledger could have written, or it is not an answer at all. */
  private readRecord<T>(path: string, is: (value: unknown) => value is T): T | null {
    const record = this.read(path);
    if (!record.present) return null;
    if (!is(record.value)) throw new StoreError("STORE_CORRUPT", "a request record is damaged");
    return record.value;
  }
  /** Where a request may keep its bytes (a staged stream), by its key. */
  staging(key: string, suffix: string): string { return join(this.dir, `${this.name(key)}.${suffix}`); }

  async run(key: unknown, method: string, params: Record<string, unknown>, effect: () => Promise<Record<string, unknown>>,
    own: (run: () => Promise<Record<string, unknown>>) => Promise<Record<string, unknown>> = run => run()): Promise<Record<string, unknown>> {
    if (!isRequestKey(key)) throw new StoreError("INVALID_REQUEST", "this request needs a request key");
    const base = join(this.dir, this.name(key));
    const digest = sha256Hex(`${method}\n${canonicalJson(params)}`);
    if (publishNoReplace(`${base}.intent.json`, JSON.stringify({ key, method, digest })) === "existing") {
      const intent = this.readRecord(`${base}.intent.json`, isIntent);
      if (intent === null) throw new StoreError("STORE_CORRUPT", "a request record is damaged");
      if (intent.key !== key || intent.method !== method || intent.digest !== digest)
        throw new StoreError("REQUEST_KEY_REUSED", "this request key was used for another request");
      const outcome = this.readRecord(`${base}.outcome.json`, isOutcome);
      if (outcome !== null) return this.answer(outcome);
    }
    if (this.active.has(key)) throw new StoreError("BROKER_UNAVAILABLE", "this request is still running; observe or retry the same key");
    this.active.add(key);
    try {
      // Historical outcome/intent binding above is independent of today's
      // admission fence. Only a pending effect and its publication need it.
      return await own(async () => {
        let outcome: Outcome;
        try { outcome = { ok: true, result: await effect() }; }
        catch (error) {
          if (primaryFailure(error) instanceof PlatformError) throw error;
          const failure = platformFailure(error);
          // The wire and the ledger share one judgment. Observation and repairable
          // failures leave intent pending; existing terminal outcomes are read above
          // unchanged, never reclassified under today's policy (P0-1/P0-5).
          if (failure.retry !== "never") throw error;
          outcome = { ok: false, error: failure };
        }
        publishNoReplace(`${base}.outcome.json`, JSON.stringify(outcome));
        return this.answer(this.readRecord(`${base}.outcome.json`, isOutcome) ?? outcome);
      });
    } finally { this.active.delete(key); }
  }

  private answer(outcome: Outcome): Record<string, unknown> {
    if (outcome.ok) return outcome.result;
    throw new PlatformError(outcome.error);
  }

  /** MAC-241: what became of a request, by its key. */
  status(key: unknown): Record<string, unknown> {
    if (!isRequestKey(key)) throw new StoreError("INVALID_REQUEST", "invalid request key");
    const base = join(this.dir, this.name(key));
    const intent = this.readRecord(`${base}.intent.json`, isIntent);
    if (intent === null) throw new StoreError("REQUEST_NOT_FOUND", "no request with this key was started");
    // The same binding run() proves: a record that does not name this key is
    // a planted or colliding one, never the answer to this status request.
    if (intent.key !== key)
      throw new StoreError("REQUEST_KEY_REUSED", "this request key was used for another request");
    const outcome = this.readRecord(`${base}.outcome.json`, isOutcome);
    if (outcome === null) return { state: "pending", method: intent.method };
    return outcome.ok ? { state: "done", method: intent.method, result: outcome.result } : { state: "refused", method: intent.method, error: outcome.error };
  }
}
