/** Shared declaration leaf: host policy and accepted check snapshots. */
export interface PipelineStep {
  readonly id: string; readonly argv: readonly string[]; readonly cwd: string;
  readonly env: Readonly<Record<string, string>>; readonly deadlineMs?: number;
}
export interface CheckPipeline {
  readonly version: 2; readonly setupSteps: readonly PipelineStep[]; readonly checkSteps: readonly PipelineStep[];
  readonly env: Readonly<Record<string, string>>; readonly toolchainDigest: string;
  readonly cachePolicy: { readonly kind: "off" } | { readonly kind: "npm-downloads"; readonly trustScope: string; readonly lockfile: string };
}
