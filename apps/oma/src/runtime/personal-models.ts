/** MODE-006 / MAC-701..704: Personal uses the existing host engine state and
 * Keychain, not a second plaintext credential home or the Society relay. */
import { join } from "node:path";
import { StoreError } from "@oma/domain/errors";
import { createEngineModelRuntime, type PersonalModels } from "@oma/engine/engine-auth";

export async function personalModels(libdir: string, agentDir: string): Promise<PersonalModels | undefined> {
  if (process.platform !== "darwin") return undefined;
  if (process.env.OMA_PERSONAL_KEYCHAIN !== "1") throw new StoreError("INVALID_REQUEST", "Mac Personal requires its host credential owner");
  const { KeychainClient } = await import("@oma/platform-mac/keychain-client");
  const { keychainCredentials } = await import("./keychain-credentials.js");
  const client = await KeychainClient.launch(libdir);
  try {
    const credentials = keychainCredentials(client, "engine-managed", join(agentDir, "oma-credentials.lock"));
    // SDK availability checks may report individual auth failures as diagnostics.
    // A locked Keychain must fail this start, not become another credential source.
    await credentials.list();
    const modelRuntime = await createEngineModelRuntime(agentDir, credentials);
    return { modelRuntime, close: () => client.close() };
  } catch (error) {
    try { await client.close(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], "Personal credential setup and cleanup failed"); }
    throw error;
  }
}
