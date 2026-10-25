import { ERROR_METADATA, StoreError, errorCodeOf, primaryFailure } from "@oma/domain/errors";
import { productText } from "@oma/domain/product-text";
import type { PlatformFailure } from "./host-guest.js";

/** A failure the peer answered with, as the caller sees it. */
export class PlatformError extends Error {
  constructor(readonly failure: PlatformFailure, options?: ErrorOptions) { super(`${failure.code}: ${failure.message}`, options); this.name = "PlatformError"; }
}
/** The answer did not arrive, so what the request did is not known. */
export function unknownOutcome(reason: string): PlatformError {
  return new PlatformError({ code: "ENGINE_UNAVAILABLE", message: reason, retry: "same-key" });
}

/** MAC-231/241: all request channels preserve the same error/retry meaning.
 * Local unobserved/internal failures cannot become a permanent input refusal. */
export function platformFailure(error: unknown): PlatformFailure {
  const primary = primaryFailure(error);
  if (primary instanceof PlatformError) {
    const failure = primary.failure;
    return { ...failure, message: productText(failure.message) ? failure.message : failure.code };
  }
  const code = errorCodeOf(error);
  const category = ERROR_METADATA[code].category;
  const retry = code === "STORAGE_FULL" ? "after-repair" :
    category === "transient" || category === "ambiguous" || category === "internal" ? "same-key" : "never";
  const message = primary instanceof StoreError && code !== "INTERNAL_ERROR" && productText(primary.message) ? primary.message : code;
  return { code, message, retry };
}

