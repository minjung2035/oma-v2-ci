import type { VerifiedExtension } from "@oma/contracts/assets";
import type { PathView, SandboxDirectories, SandboxEndpoints, SandboxHost } from "@oma/contracts/runtime";
import type { ValidatedRunLease } from "@oma/protocol/run-lease";
import type { EngineSettingsFiles } from "./pi-compat/settings-files.js";
export interface EngineStartEffects {
  readonly settings: EngineSettingsFiles;
  assertExtensions(extensions: readonly VerifiedExtension[]): void;
}
export interface PiSpawnPlan {
  readonly command: string; readonly args: string[]; readonly cwd: string; readonly env: Record<string, string>;
  readonly input?: Uint8Array;
  readonly privateInputs?: readonly { readonly fd: number; readonly bytes: Uint8Array }[];
}
export interface ResidentSandbox {
  pathView(host: SandboxHost, lease: ValidatedRunLease, directories: SandboxDirectories, endpoints?: SandboxEndpoints): PathView;
  residentPlan(host: SandboxHost, lease: ValidatedRunLease, directories: SandboxDirectories,
    environment: Readonly<Record<string, string>>, inferenceSocket?: string, egressSocket?: string): PiSpawnPlan;
  spawn(plan: PiSpawnPlan): import("@oma/process/async").ChildProcessWithoutNullStreams;
}
export interface ResidentEngineEffects extends EngineStartEffects { readonly sandbox: ResidentSandbox }
export interface EngineLoginDirectory { ensureOwnedDirectory(path: string, boundary: string): void }
