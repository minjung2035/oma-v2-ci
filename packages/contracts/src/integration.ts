/** DR27: host-owned rules and the immutable decision named by publication. */
export type { TieredPolicy } from "./host.js";
export interface IntegrationCheckSnapshot {
  readonly id: string;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}
