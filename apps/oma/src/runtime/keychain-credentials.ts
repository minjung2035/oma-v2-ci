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
import { StoreError } from "@oma/domain/errors";
import { credentialStoreCredentials } from "@oma/engine/credential-store";
import type { EngineCredentials } from "@oma/engine/engine-auth";
import type { KeychainStore } from "@oma/contracts/credentials";
import { withProcessWriterLock } from "@oma/process/writer";
import { ensureOwnedUserDirectory } from "./user-files.js";
import { dirname } from "node:path";

/** P0-3: host resolver and Personal engines share one cross-process writer lock.
 * Waiting measures contention only; no timeout reclassifies an in-flight write. */
// The helper's existing 60 s credential availability budget also bounds
// contention. This is not a limit on a write already holding the fence.
const CREDENTIAL_LOCK_WAIT_MS = 60_000;
export function keychainCredentials(store: KeychainStore, account: string, lockPath: string,
  options: { readonly waitMs?: number } = {}): EngineCredentials {
  const write = async <T>(run: (writer: KeychainStore) => Promise<T>, signal?: AbortSignal): Promise<T> => {
    signal?.throwIfAborted();
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
  return credentialStoreCredentials(store, account, { write });
}
