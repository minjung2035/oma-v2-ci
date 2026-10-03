/** A7: the `InteractiveMode` private members OMA overrides, stated once.
 *
 * 0.87.1 declares every one of these `private` in its own
 * `interactive-mode.d.ts`, so the entries that replace them hold no typed
 * surface for them: each site used to cast `mode as unknown as { ... }` with
 * the member's shape spelled inline, and a rename upstream could only be
 * noticed at runtime. This module names the whole set and types it once;
 * `test/pi-compat.test.ts` asserts the vendored prototype still carries every
 * member as a function, so a drift fails at the boundary. */
import type { InteractiveMode } from "@earendil-works/pi-coding-agent";

/** Every private member an OMA entry replaces or wraps. */
export const PI_INTERACTIVE_PRIVATE_MEMBERS = Object.freeze([
  "handleFatalRuntimeError",
  "renderProjectTrustWarningIfNeeded",
  "suggestBugReport",
  "crashReportInstructions",
  "updateTerminalTitle",
  "handleExportCommand",
  "getPathCommandArgument",
  "getCrashExtensionHint",
  "showManagedToolStatus",
  "shutdown",
  "showSessionSelector",
] as const);

/** The private surface the entries write, typed as the engine implements it. */
export interface InteractiveModeInternals {
  shutdown(): Promise<void>;
  handleFatalRuntimeError(prefix: string, error: unknown): Promise<void>;
  getCrashExtensionHint(error: unknown): string | undefined;
  crashReportInstructions(): string;
  suggestBugReport(): void;
  showManagedToolStatus(status: { type: string; message: string }): void;
  renderProjectTrustWarningIfNeeded(): void;
  showSessionSelector(): void;
  handleExportCommand(text: string): Promise<void>;
  getPathCommandArgument(text: string, command: string): string | undefined;
  updateTerminalTitle(): void;
  /** `ui` is public on `InteractiveMode`; it travels here so overrides that
   * replace a member can still reach the renderer through one handle. */
  readonly ui: { readonly terminal: { setTitle(title: string): void } };
}

/** The one cast: the private surface exists at runtime, the type only says so. */
export function interactiveInternalsOf(mode: InteractiveMode): InteractiveModeInternals {
  return mode as unknown as InteractiveModeInternals;
}
