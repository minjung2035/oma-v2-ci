import type { VerifiedExtension } from "@oma/contracts/assets";
import type { SandboxDirectories, SandboxHost } from "@oma/contracts/runtime";
import type { ValidatedRunLease } from "@oma/protocol/run-lease";
import type { EngineSettingsFiles } from "./pi-compat/settings-files.js";
export interface EngineStartEffects {
  readonly settings: EngineSettingsFiles;
  assertExtensions(extensions: readonly VerifiedExtension[]): void;
}
export interface ResidentSandbox {
  residentArgv(host: SandboxHost, lease: ValidatedRunLease, directories: SandboxDirectories,
    environment: Readonly<Record<string, string>>, inferenceSocket?: string, egressSocket?: string): string[];
  seccompFilter(): Uint8Array;
}
export interface ResidentEngineEffects extends EngineStartEffects { readonly sandbox: ResidentSandbox }
export interface EngineLoginDirectory { ensureOwnedDirectory(path: string, boundary: string): void }
