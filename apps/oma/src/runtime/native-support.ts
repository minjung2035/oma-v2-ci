import { StoreError } from "@oma/domain/errors";

/** Product composition refuses before state/config/history effects. These are
 * unresolved guarantees, not caller-selectable permission or feature flags. */
export function assertNativeRuntime(): void {
  if (process.platform !== "linux" && process.platform !== "darwin")
    throw new StoreError("UNSUPPORTED_PROFILE", "OMA native execution requires Linux or macOS");
  if (process.platform === "darwin")
    throw new StoreError("UNSUPPORTED_PROFILE",
      "Native macOS execution is blocked by G-PROCESS, G-FILES and G-AUTH. VM support has been retired; existing data is preserved.");
}
