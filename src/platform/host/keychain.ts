/** The engine's credential store on the Mac (macos-platform MAC-701, §7.2).
 *
 * The engine's whole credential blob -- the same JSON its agent directory's
 * file would hold -- is one Keychain item, whose account is the model
 * profile's `credentialRef`. Only the Swift helper touches the Keychain;
 * `KeychainStore` is its get/put. This implements the engine's public
 * credential-store contract (`read`, `list`, `modify`, `delete`), so login,
 * refresh and format stay the engine's (INF-001): what changes is where the
 * blob is kept. Host resolution and Personal engines use the same per-item
 * writer lock across processes; each mutation rereads the committed blob.
 */
import { StoreError } from "../../domain/errors.js";
import type { EngineCredentials } from "../../runtime/engine-auth.js";
import { withProcessWriterLock } from "../../runtime/process-writer.js";
import { ensureOwnedUserDirectory } from "../../runtime/user-files.js";
import { dirname } from "node:path";

export interface KeychainStore {
  /** The item's value, or undefined when there is none. A locked or
   * unreadable Keychain throws (MAC-702): that is not "no credential". */
  get(account: string): Promise<string | undefined>;
  put(account: string, value: string): Promise<void>;
  /** The writer helper inherits the lock and ends before it is returned. */
  withWriter?<T>(fence: number, run: (writer: KeychainStore) => Promise<T>): Promise<T>;
}

type Blob = Record<string, Record<string, unknown>>;
type Credential = Parameters<Parameters<EngineCredentials["modify"]>[1]>[0];

function parse(text: string | undefined): Blob {
  if (text === undefined || text.length === 0) return {};
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new StoreError("STORE_CORRUPT", "the stored credential is not readable"); }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new StoreError("STORE_CORRUPT", "the stored credential is not readable");
  return value as Blob;
}

const locks = new Map<string, Promise<unknown>>();
/** P0-2: every mutating read→write of a Keychain item is one writer at a time
 * in this process; `run` decides what the stored value becomes (AV-22). */
export function serialized<T>(account: string, run: () => Promise<T>): Promise<T> {
  const previous = locks.get(account) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(run);
  locks.set(account, next);
  void next.finally(() => { if (locks.get(account) === next) locks.delete(account); }).catch(() => undefined);
  return next;
}

/** P0-3: host resolver and Personal engines share one cross-process writer lock.
 * Waiting measures contention only; no timeout reclassifies an in-flight write. */
// The helper's existing 60 s credential availability budget also bounds
// contention. This is not a limit on a write already holding the fence.
const CREDENTIAL_LOCK_WAIT_MS = 60_000;
export function keychainCredentials(store: KeychainStore, account: string, lockPath?: string,
  options: { readonly waitMs?: number } = {}): EngineCredentials {
  const write = async <T>(run: (writer: KeychainStore) => Promise<T>, signal?: AbortSignal): Promise<T> => {
    signal?.throwIfAborted();
    if (lockPath === undefined) return serialized(account, async () => { signal?.throwIfAborted(); return run(store); });
    // The OS lock also serializes independent descriptors in this process.
    // A second, unbounded promise queue would hide contention from its deadline.
    // P0-8: the lock's directory is oma's own (the engine or run directory);
    // its leaf is repaired rather than trusted as-is.
    ensureOwnedUserDirectory(dirname(lockPath), dirname(lockPath));
    return withProcessWriterLock(lockPath, async held => {
      const fenced = (writer: KeychainStore): Promise<T> => run({ get: account => writer.get(account),
        put: (account, value) => {
          signal?.throwIfAborted(); held.assertHeld(lockPath);
          return writer.put(account, value);
        } });
      return await (store.withWriter === undefined ? fenced(store) : store.withWriter(held.descriptor, fenced));
    }, { waitMs: options.waitMs ?? CREDENTIAL_LOCK_WAIT_MS, ...(signal === undefined ? {} : { signal }), busyMessage: "another process still holds the credential writer lock" });
  };
  return {
    async read(providerId) {
      return parse(await store.get(account))[providerId] as Credential | undefined;
    },
    async list() {
      return Object.entries(parse(await store.get(account)))
        .map(([providerId, credential]) => ({ providerId, type: credential.type as "api_key" | "oauth" }));
    },
    modify(providerId, fn, options) {
      return write(async writer => {
        const blob = parse(await writer.get(account));
        const next = await fn(blob[providerId] as Credential | undefined);
        if (next === undefined) return blob[providerId] as Credential | undefined;
        await writer.put(account, JSON.stringify({ ...blob, [providerId]: next }));
        return next;
      }, options?.signal);
    },
    delete(providerId, options) {
      return write(async writer => {
        const blob = parse(await writer.get(account));
        if (!(providerId in blob)) return;
        const { [providerId]: _gone, ...rest } = blob;
        await writer.put(account, JSON.stringify(rest));
      }, options?.signal);
    },
  } as EngineCredentials;
}
