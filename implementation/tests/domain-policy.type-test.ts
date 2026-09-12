/** R02 compile-only descriptor coverage; NOT_RUN, never a production import. */
import type { Capability, ResourceLimits, ProtocolLimits } from "../contracts.js";
import type { CAPABILITIES } from "../../src/domain/capabilities.js";
import type { RESOURCE_FIELDS } from "../../src/domain/resources.js";
import type { PROTOCOL_LIMIT_FIELDS } from "../../src/domain/limits.js";

type Assert<T extends true> = T;
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type CapabilityCoverage = Assert<Equal<Capability, (typeof CAPABILITIES)[number]>>;
type ResourceCoverage = Assert<Equal<keyof ResourceLimits, keyof typeof RESOURCE_FIELDS>>;
type ProtocolCoverage = Assert<Equal<keyof ProtocolLimits, keyof typeof PROTOCOL_LIMIT_FIELDS>>;
type ResourceValues = Assert<Equal<ResourceLimits[keyof ResourceLimits], number>>;
type ProtocolValues = Assert<Equal<ProtocolLimits[keyof ProtocolLimits], number>>;

function existingValueContract(resources: ResourceLimits, limits: ProtocolLimits): void {
  // Freezing metadata must not silently make the existing DTO types readonly.
  resources.tasks = 128;
  limits.addresses = 8;
  // @ts-expect-error Unknown resource fields are not part of the DTO.
  resources.unlimited = 1;
  // @ts-expect-error New queue knobs are not introduced by deduplication.
  limits.queueBytes = 1;
  // @ts-expect-error Units remain numeric, not stringified configuration values.
  resources.memoryBytes = "1024";
}

export type { CapabilityCoverage, ResourceCoverage, ProtocolCoverage, ResourceValues, ProtocolValues };
