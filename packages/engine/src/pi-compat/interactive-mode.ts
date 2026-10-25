/** Checked compatibility boundary for the pinned interactive SDK. Product hosts
 * use semantic controls; this module alone owns the private member inventory. */
import { VERSION, type InteractiveMode, type ToolDefinition, type AgentSession } from "@earendil-works/pi-coding-agent";
import { ProcessTerminal } from "@earendil-works/pi-tui";
import { StoreError } from "@oma/domain/errors";
import contacts from "./contacts.json" with { type: "json" };
import { safeToolPresentation } from "../interactive-display.js";
import { omaCrashHint, omaExportCommand, omaTerminalTitle } from "../interactive-commands.js";

/** Supply Pi's default terminal through its public option. Title policy uses
 * this same handle instead of reaching into the private renderer. */
export function createInteractiveTerminal(): ProcessTerminal { return new ProcessTerminal(); }

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
  "getRegisteredToolDefinition",
  "toggleThinkingBlockVisibility",
] as const);

/** Private instance fields OMA reads. They live on instances rather than the
 * prototype, so `test/pi-compat.test.ts` pins them against the vendored
 * source instead. */
export const PI_INTERACTIVE_PRIVATE_FIELDS = Object.freeze([
  "hideThinkingBlock",
] as const);

/** The private surface the entries write, typed as the engine implements it. */
interface InteractiveModeInternals {
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
  /** The render components' one definition lookup: the extension registry's
   * entry, with the engine's own built-in renderers merged over what a tool
   * did not declare. OMA wraps this seam for presentation policy rather
   * than writing Pi's registry. */
  getRegisteredToolDefinition(toolName: string): ToolDefinition | undefined;
  /** B2: 1.0.1's visibility surface is this field plus a toggle that flips
   * it, persists it through the settings manager and repaints. OMA reads the
   * field and calls the toggle only on a difference, so `/thinking show` and
   * `/thinking hide` are sets, never an inversion of what was showing. */
  hideThinkingBlock: boolean;
  toggleThinkingBlockVisibility(): void;

}

export interface ThinkingVisibility {
  isHidden(): boolean;
  toggle(): void;
}
/** Preserve the upstream toggle/persist/repaint operation; sets never invert an already matching value. */
export function setThinkingBlockHidden(visibility: ThinkingVisibility, hidden: boolean): boolean {
  if (visibility.isHidden() === hidden) return false;
  visibility.toggle();
  return true;
}
interface ModeRuntime {
  dispose(): Promise<void>;
  readonly session: Pick<AgentSession, "sessionManager" | "sessionFile">;
}
export interface InteractiveModeControl {
  shutdown(): Promise<void>;
  fail(prefix: string, error: unknown): Promise<void>;
  setThinkingHidden(hidden: boolean): boolean;
  configureSociety(runtime: ModeRuntime, project: string, terminal: Pick<ProcessTerminal, "setTitle">): void;
  configurePersonal(runtime: ModeRuntime, history: () => void, terminal: Pick<ProcessTerminal, "setTitle">): void;
}
/** Validate the pinned contract before exposing product operations; no raw handle leaves this module. */
export function assertInteractiveCompatibility(mode: unknown, version: string): void {
  if (version !== contacts.versions["@earendil-works/pi-coding-agent"] || mode === null || typeof mode !== "object")
    throw new StoreError("UNSUPPORTED_PROFILE", "the bundled interactive engine is incompatible");
  for (const name of PI_INTERACTIVE_PRIVATE_MEMBERS)
    if (typeof Reflect.get(mode, name) !== "function")
      throw new StoreError("UNSUPPORTED_PROFILE", `the bundled interactive engine lacks ${name}`);
  for (const name of PI_INTERACTIVE_PRIVATE_FIELDS)
    if (typeof Reflect.get(mode, name) !== "boolean")
      throw new StoreError("UNSUPPORTED_PROFILE", `the bundled interactive engine has an invalid ${name}`);
}
export function adaptInteractiveMode(mode: InteractiveMode): InteractiveModeControl {
  assertInteractiveCompatibility(mode, VERSION);
  // The only cast follows version and every private member/field validation.
  const own = mode as unknown as InteractiveModeInternals;
  const failure = (runtime: ModeRuntime, label: string): void => {
    const fatal = own.handleFatalRuntimeError.bind(mode);
    own.handleFatalRuntimeError = async (prefix, error) => {
      try { await runtime.dispose(); }
      catch (cleanup) { error = new AggregateError([error, cleanup], `${label} failure and cleanup failed`); }
      await fatal(prefix, error);
    };
  };
  return {
    shutdown: () => own.shutdown(),
    fail: (prefix, error) => own.handleFatalRuntimeError(prefix, error),
    setThinkingHidden: hidden => setThinkingBlockHidden({ isHidden: () => own.hideThinkingBlock,
      toggle: () => own.toggleThinkingBlockVisibility() }, hidden),
    configureSociety(runtime, project, terminal) {
      failure(runtime, "Interactive");
      own.renderProjectTrustWarningIfNeeded = () => {};
      own.suggestBugReport = () => {};
      own.crashReportInstructions = () => "Start oma and reopen this session with /resume.";
      own.updateTerminalTitle = () => terminal.setTitle(omaTerminalTitle(runtime.session.sessionManager.getSessionName(), project));
      const engineExport = own.handleExportCommand.bind(mode);
      own.handleExportCommand = text => engineExport(omaExportCommand(own.getPathCommandArgument(text, "/export"), project, runtime.session.sessionFile) ?? text);
      const crashHint = own.getCrashExtensionHint.bind(mode);
      own.getCrashExtensionHint = error => omaCrashHint(crashHint(error));
      const definition = own.getRegisteredToolDefinition.bind(mode);
      own.getRegisteredToolDefinition = name => {
        const value = definition(name); return value === undefined ? undefined : safeToolPresentation(value);
      };
      const status = own.showManagedToolStatus.bind(mode);
      own.showManagedToolStatus = value => { if (value.type === "warning") status(value); };
    },
    configurePersonal(runtime, history, terminal) {
      failure(runtime, "Personal");
      own.renderProjectTrustWarningIfNeeded = () => {};
      own.crashReportInstructions = () => "Start oma --mode personal and reopen this session with /resume.";
      own.updateTerminalTitle = () => terminal.setTitle("oma — Personal");
      own.showSessionSelector = history;
    },
  };
}
