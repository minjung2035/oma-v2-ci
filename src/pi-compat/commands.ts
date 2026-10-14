/** A3/A7: the commands Pi's own editor handles, mirrored from the engine's
 * BUILTIN_SLASH_COMMANDS plus the ones it handles without listing them.
 *
 * 1.0.1 has no public builtin-command registry (the audit's upstream-export
 * request stands), so this is a mirror; `test/interactive-input.test.ts` holds
 * it to the engine's own `core/slash-commands.js` list, and an engine upgrade
 * that changes the set fails there rather than drifting silently.
 */
export const PI_BUILTIN_COMMANDS: ReadonlySet<string> = new Set(["settings", "model", "tree", "thinking", "scoped-models",
  "export", "import", "share", "bug", "copy", "name", "session", "changelog", "hotkeys", "fork", "clone", "trust", "login",
  "logout", "new", "compact", "resume", "reload", "quit", "debug", "arminsayshi", "dementedelves"]);
