/** MODE-006 / MAC-701..704: Personal uses the existing host engine state and
 * Keychain, not a second plaintext credential home or the Society relay. */
import { join } from "node:path";
import { StoreError } from "../domain/errors.js";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

export interface PersonalModels {
  readonly modelRuntime: ModelRuntime;
  close(): Promise<void>;
}
export async function personalModels(libdir: string, agentDir: string): Promise<PersonalModels | undefined> {
  if (process.platform !== "darwin") return undefined;
  if (process.env.OMA_PERSONAL_KEYCHAIN !== "1") throw new StoreError("INVALID_REQUEST", "Mac Personal requires its host credential owner");
  const { KeychainClient } = await import("../platform/host/keychain-client.js");
  const { keychainCredentials } = await import("../platform/host/keychain.js");
  const client = await KeychainClient.launch(libdir);
  try {
    const credentials = keychainCredentials(client, "engine-managed", join(agentDir, "oma-credentials.lock"));
    // SDK availability checks may report individual auth failures as diagnostics.
    // A locked Keychain must fail this start, not become another credential source.
    await credentials.list();
    const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
    const modelRuntime = await ModelRuntime.create({ credentials, modelsPath: join(agentDir, "models.json"), allowModelNetwork: false });
    return { modelRuntime, close: () => client.close() };
  } catch (error) {
    try { await client.close(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], "Personal credential setup and cleanup failed"); }
    throw error;
  }
}
