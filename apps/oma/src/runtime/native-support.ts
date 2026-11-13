import { StoreError } from "@oma/domain/errors";

/** Product composition refuses an unsupported OS before state/config/history
 * effects. A missing capability is refused by its own owner at that effect. */
export function assertNativeRuntime(): void {
  if (process.platform !== "linux" && process.platform !== "darwin")
    throw new StoreError("UNSUPPORTED_PROFILE", "OMA native execution requires Linux or macOS");
  // The macOS target is Apple silicon; an Intel Mac has no qualified native path.
  if (process.platform === "darwin" && process.arch !== "arm64")
    throw new StoreError("UNSUPPORTED_PROFILE", "OMA on macOS requires Apple silicon (arm64)");
}
