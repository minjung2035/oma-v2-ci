/** The engine's credential store on the Mac (macos-platform MAC-701, §7.2).
 *
 * The engine's whole credential blob -- the same JSON its agent directory's
 * file would hold -- is one Keychain item, whose account is the model
 * profile's `credentialRef`. Only the Swift helper touches the Keychain;
 * `KeychainStore` is its get/put. This implements the engine's public
 * credential-store contract (`read`, `list`, `modify`, `delete`), so login,
 * refresh and format stay the engine's (INF-001): what changes is where the
 * blob is kept. Writes are serialized per item in this process, the one place
 * that writes it.
 */
import { StoreError } from "../../domain/errors.js";
import type { EngineCredentials } from "../../runtime/engine-auth.js";

export interface KeychainStore {
  /** The item's value, or undefined when there is none. A locked or
   * unreadable Keychain throws (MAC-702): that is not "no credential". */
  get(account: string): Promise<string | undefined>;
  put(account: string, value: string): Promise<void>;
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
function serialized<T>(account: string, run: () => Promise<T>): Promise<T> {
  const previous = locks.get(account) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(run);
  locks.set(account, next);
  void next.finally(() => { if (locks.get(account) === next) locks.delete(account); }).catch(() => undefined);
  return next;
}

export function keychainCredentials(store: KeychainStore, account: string): EngineCredentials {
  return {
    async read(providerId) {
      return parse(await store.get(account))[providerId] as Credential | undefined;
    },
    async list() {
      return Object.entries(parse(await store.get(account)))
        .map(([providerId, credential]) => ({ providerId, type: credential.type as "api_key" | "oauth" }));
    },
    modify(providerId, fn) {
      return serialized(account, async () => {
        const blob = parse(await store.get(account));
        const next = await fn(blob[providerId] as Credential | undefined);
        if (next === undefined) return blob[providerId] as Credential | undefined;
        await store.put(account, JSON.stringify({ ...blob, [providerId]: next }));
        return next;
      });
    },
    delete(providerId) {
      return serialized(account, async () => {
        const blob = parse(await store.get(account));
        if (!(providerId in blob)) return;
        const { [providerId]: _gone, ...rest } = blob;
        await store.put(account, JSON.stringify(rest));
      });
    },
  } as EngineCredentials;
}
