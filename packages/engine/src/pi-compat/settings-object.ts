import { StoreError } from "@oma/domain/errors";

/** Shared byte validation, with no dependency on the interactive SDK. */
export function settingsObject(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new StoreError("UNSUPPORTED_PROFILE", "engine settings must be an object");
  return value as Record<string, unknown>;
}
