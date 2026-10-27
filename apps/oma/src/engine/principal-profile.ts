/** Application selection of the current configured Principal profile and package resources. */
import { loadConfiguration } from "@oma/config";
import { StoreError } from "@oma/domain/errors";
import { packageResourcePaths, packageStoreRoot } from "../runtime/packages/index.js";
import type { SessionProfile } from "@oma/engine/principal-launch";
export function principalSessionProfile(configPath: string, society: string): SessionProfile & { readonly inferenceSeconds: number } {
  const configuration = loadConfiguration(configPath);
  const config = configuration.config;
  const modelName = config.agentProfiles[config.principalProfile]?.modelProfile ?? "";
  const model = config.modelProfiles[modelName];
  if (!model) throw new StoreError("UNSUPPORTED_PROFILE", `principal model profile ${modelName} is not declared`);
  const role = configuration.roles[config.principalProfile];
  const prompt = role?.prompt ?? "";
  // The store's real root is the root the engine's reads are allowed under,
  // and the one packageResourcePaths resolves the advertised resources from.
  const packageStore = config.installation.packages === undefined ? undefined
    : packageStoreRoot(config.installation.packages) ?? undefined;
  const packageResources = packageResourcePaths(packageStore);
  return {
    society, provider: model.provider, model: model.model, inferenceSeconds: model.inferenceTimeoutSeconds,
    extensions: (role?.extensions ?? []).map(extension => ({ path: extension.path, sha256: extension.sha256 })),
    ...(packageStore === undefined ? {} : { packageStore }),
    ...(packageResources === undefined ? {} : { packageResources }),
    ...(prompt.length > 0 ? { prompt } : {}),
  };
}

