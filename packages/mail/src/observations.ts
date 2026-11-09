import type { ImmutableObservation } from "@oma/contracts/files";
import { StoreError } from "@oma/domain/errors";
import type { MailInbox } from "./ports.js";

/** Closing the inbox cannot hide a corruption or publication failure. */
export function withMailInbox<T>(inbox: MailInbox, use: () => T): T {
  let failure: { error: unknown } | undefined;
  try { return use(); }
  catch (error) { failure = { error }; throw error; }
  finally {
    try { inbox.close(); }
    catch (cleanup) {
      if (failure) throw new AggregateError([failure.error, cleanup], "mailbox operation and cleanup failed");
      throw cleanup;
    }
  }
}

/** A derived mail entry is absent only after a completed absence observation. */
export function mailEntryPresent(observation: ImmutableObservation, description = "mailbox"): boolean {
  if (observation.kind === "corrupt") throw observation.error;
  if (observation.kind === "unavailable")
    throw new StoreError("BROKER_UNAVAILABLE", `${description} observation is unavailable`, { cause: observation.error });
  return observation.kind === "present";
}
