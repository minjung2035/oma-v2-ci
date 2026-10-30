/** DR27: host-owned rules and the immutable decision named by publication. */
export type { TieredPolicy } from "./host.js";
export interface IntegrationCheckSnapshot {
  readonly pipeline?: CheckPipeline;
  readonly id: string;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

export type { CheckPipeline, PipelineStep } from "./check-pipeline.js";
import type { CheckPipeline } from "./check-pipeline.js";
