/** A7: the engine's ambient surface -- the environment names it exports into
 * subprocesses it starts, and the exit text its interactive UI prints.
 *
 * Pi 1.0.1 names a session to the commands it runs (`core/tools/bash.js`
 * deletes each of these from a subprocess's inherited environment, then
 * re-exports them when session context is asked for). An `oma` started from
 * inside such a command inherits them, and an engine spawned without clearing
 * them would carry a parent session's identity into a new one. The strip list
 * is stated once here so the oracle test can hold it to the vendored engine's
 * own list instead of a hand-mirrored copy.
 */
export const PI_SESSION_ENV_NAMES = Object.freeze([
  "PI_SESSION_ID",
  "PI_SESSION_FILE",
  "PI_PROVIDER",
  "PI_MODEL",
  "PI_REASONING_LEVEL",
] as const);

/** Pi's fullscreen exit ends with how to resume the session it ran
 * (`modes/interactive/interactive-mode.js`). OMA resumes its own session and
 * drops the line; the literal is pinned here so an upstream wording change is
 * caught by the oracle test rather than passing a stale substring. */
export const PI_RESUME_HINT = "To resume this session:";
