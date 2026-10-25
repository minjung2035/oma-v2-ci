/** R02 compile-only descriptor coverage; NOT_RUN, never a production import. */
import type { Capability, ProtocolLimits } from "@oma/contracts";
import type { CAPABILITIES } from "@oma/domain/capabilities";
import type { PROTOCOL_LIMIT_FIELDS } from "@oma/domain/limits";

type Assert<T extends true> = T;
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type CapabilityCoverage = Assert<Equal<Capability, (typeof CAPABILITIES)[number]>>;
type ProtocolCoverage = Assert<Equal<keyof ProtocolLimits, keyof typeof PROTOCOL_LIMIT_FIELDS>>;
type ProtocolValues = Assert<Equal<ProtocolLimits[keyof ProtocolLimits], number>>;

function existingValueContract(limits: ProtocolLimits): void {
  // Freezing metadata must not silently make the existing DTO types readonly.
  limits.addresses = 8;
  // @ts-expect-error New queue knobs are not introduced by deduplication.
  limits.queueBytes = 1;
  // @ts-expect-error Units remain numeric, not stringified configuration values.
  limits.addresses = "8";
}

export type { CapabilityCoverage, ProtocolCoverage, ProtocolValues };
