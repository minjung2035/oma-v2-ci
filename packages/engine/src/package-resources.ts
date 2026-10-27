/** The SDK owns package discovery. This is not OMA's stored index or its path admission. */
import type { PackageManager, ResolvedPaths } from "@earendil-works/pi-coding-agent";
export interface EnginePackageDiscovery {
  resolve(): Promise<ResolvedPaths>;
  configuredPackages(): ReturnType<PackageManager["listConfiguredPackages"]>;
}
export async function createEnginePackageDiscovery(store: string): Promise<EnginePackageDiscovery> {
  const sdk = await import("@earendil-works/pi-coding-agent");
  const settingsManager = sdk.SettingsManager.create(store, store, { projectTrusted: false });
  const manager = new sdk.DefaultPackageManager({ cwd: store, agentDir: store, settingsManager });
  return {
    resolve: () => manager.resolve(async () => "skip"),
    configuredPackages: () => manager.listConfiguredPackages(),
  };
}
