/** The host's Credential Resolver (macos-platform §7.3, MAC-704): a run's
 * provider, model, origin and key, from this host's engine state only -- the
 * engine directory's `models.json` and `settings.json`, and the Keychain for
 * the credential. Nothing the guest holds is read. */
import { StoreError } from "@oma/domain/errors";
import { resolveEngineAuth, type EngineAuth } from "@oma/engine/engine-auth";
import { keychainCredentials } from "../../runtime/keychain-credentials.js";
import { type KeychainStore } from "@oma/contracts/credentials";
import { EGRESS_ENGINE_MANAGED } from "@oma/protocol/host-guest";
import { join } from "node:path";

/** The one credential reference v1 knows: the engine's own login. */
export const ENGINE_MANAGED = EGRESS_ENGINE_MANAGED;

export function hostResolver(engineDir: string, keychain: KeychainStore, libdir?: string) {
  const store: KeychainStore = libdir === undefined ? keychain : {
    get: account => keychain.get(account), put: (account, value) => keychain.put(account, value),
    async withWriter(fence, run) {
      const { KeychainClient } = await import("@oma/platform-mac/keychain-client");
      const writer = await KeychainClient.launch(libdir, fence);
      try { return await run(writer); } finally { await writer.close(); }
    },
  };
  return async (credentialRef: string, provider: string, model: string): Promise<EngineAuth> => {
    if (credentialRef !== ENGINE_MANAGED) throw new StoreError("UNSUPPORTED_PROFILE", "this credential is not one this app keeps");
    return resolveEngineAuth(engineDir, provider, model, keychainCredentials(store, credentialRef, join(engineDir, "oma-credentials.lock")));
  };
}
