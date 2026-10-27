import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { VerifiedExtension, PackageResourcePaths } from "@oma/contracts/assets";
import type { SessionMode } from "@oma/domain/session-mode";
import type { EngineStartEffects } from "./ports.js";
import type { EnginePresentation } from "./presentation.js";
export interface PersonalEngineInput {
  readonly birth: { readonly id: string; readonly cwd: string; readonly history: string };
  readonly agentDir: string;
  readonly libdir: string;
  readonly version: string;
  readonly resume?: string;
}
export interface PersonalEnginePorts extends EngineStartEffects {
  readonly presentation: EnginePresentation;
  readonly extensions: {
    load(): { readonly extensions: readonly VerifiedExtension[]; readonly missing: readonly string[] };
    readSelection(): { readonly extensions: readonly string[] };
    availableEntries(): readonly string[];
    entry(input: string): string;
    select(entry: string, enabled: boolean): void;
    resources(): PackageResourcePaths | undefined;
  };
  readonly history: {
    target(file: string, cwd: string): Promise<{ readonly id: string; readonly mode: SessionMode }>;
    directories(cwd: string): readonly { readonly dir: string; readonly mode: SessionMode }[];
  };
  acquireCredentials(): Promise<{ readonly modelRuntime: ModelRuntime; close(): Promise<void> } | undefined>;
}
