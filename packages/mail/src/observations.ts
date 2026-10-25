import type { ImmutableObservation } from "@oma/contracts/files";
import { StoreError } from "@oma/domain/errors";

/** A derived mail entry is absent only after a completed absence observation. */
export function mailEntryPresent(observation: ImmutableObservation, description = "mailbox"): boolean {
  if (observation.kind === "corrupt") throw observation.error;
  if (observation.kind === "unavailable")
    throw new StoreError("BROKER_UNAVAILABLE", `${description} observation is unavailable`, { cause: observation.error });
  return observation.kind === "present";
}
