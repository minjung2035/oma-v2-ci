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
import { join } from "node:path";
import { StoreError, primaryFailure, unobserved } from "../../domain/errors.js";
import { publishNoReplace, ensureDurableDirectory } from "../../storage/durable-fs.js";
import { PlatformError, platformFailure } from "../rpc.js";
import { isRequestKey, type PlatformFailure } from "../../protocol/host-guest.js";

type Outcome = { readonly ok: true; readonly result: Record<string, unknown> } | { readonly ok: false; readonly error: PlatformFailure };

export class RequestLedger {
  private readonly active = new Set<string>();
  constructor(private readonly dir: string) { ensureDurableDirectory(dir, 0o700); }

  private name(key: string): string { return sha256Hex(key); }
  private read<T>(path: string): T | null {
    let bytes: string;
    try { bytes = readFileSync(path, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw unobserved(error, "the request record") ?? error;
    }
    try { return JSON.parse(bytes) as T; }
    catch (cause) { throw new StoreError("STORE_CORRUPT", "a request record is damaged", { cause }); }
  }
  /** Where a request may keep its bytes (a staged stream), by its key. */
  staging(key: string, suffix: string): string { return join(this.dir, `${this.name(key)}.${suffix}`); }

  async run(key: unknown, method: string, params: Record<string, unknown>, effect: () => Promise<Record<string, unknown>>): Promise<Record<string, unknown>> {
    if (!isRequestKey(key)) throw new StoreError("INVALID_REQUEST", "this request needs a request key");
    const base = join(this.dir, this.name(key));
    const digest = sha256Hex(`${method}\n${canonicalJson(params)}`);
    if (publishNoReplace(`${base}.intent.json`, JSON.stringify({ key, method, digest })) === "existing") {
      const intent = this.read<{ key: string; method: string; digest: string }>(`${base}.intent.json`);
      if (intent === null || intent.key !== key || intent.method !== method || intent.digest !== digest)
        throw new StoreError("REQUEST_KEY_REUSED", "this request key was used for another request");
      const outcome = this.read<Outcome>(`${base}.outcome.json`);
      if (outcome !== null) return this.answer(outcome);
    }
    if (this.active.has(key)) throw new StoreError("BROKER_UNAVAILABLE", "this request is still running; observe or retry the same key");
    this.active.add(key);
    try {
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
      return this.answer(this.read<Outcome>(`${base}.outcome.json`) ?? outcome);
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
    const intent = this.read<{ method: string }>(`${base}.intent.json`);
    if (intent === null) throw new StoreError("REQUEST_NOT_FOUND", "no request with this key was started");
    const outcome = this.read<Outcome>(`${base}.outcome.json`);
    if (outcome === null) return { state: "pending", method: intent.method };
    return outcome.ok ? { state: "done", method: intent.method, result: outcome.result } : { state: "refused", method: intent.method, error: outcome.error };
  }
}
