import { StoreError } from "@oma/domain/errors";

/** Product composition refuses an unsupported OS before state/config/history
 * effects. A missing capability is refused by its own owner at that effect. */
export function assertNativeRuntime(): void {
  if (process.platform !== "linux" && process.platform !== "darwin")
    throw new StoreError("UNSUPPORTED_PROFILE", "OMA native execution requires Linux or macOS");
}
