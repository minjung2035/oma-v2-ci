import test from "node:test";
import assert from "node:assert/strict";
import { VERSION, InteractiveMode } from "@earendil-works/pi-coding-agent";
import { adaptInteractiveMode, assertInteractiveCompatibility,
  PI_INTERACTIVE_PRIVATE_MEMBERS as members } from "../dist/pi-compat/interactive-mode.js";
function mode() {
  const calls = [], value = Object.fromEntries(members.map(name => [name, (...args) => calls.push([name, ...args])]));
  Object.assign(value, { hideThinkingBlock: true,
    getPathCommandArgument: () => undefined, getCrashExtensionHint: () => undefined,
    toggleThinkingBlockVisibility() { calls.push(["thinking"]); this.hideThinkingBlock = !this.hideThinkingBlock; } });
  Object.defineProperty(value, "ui", { get() { throw new Error("private renderer must not be accessed"); } });
  return { value, calls, terminal: { setTitle: title => calls.push(["title", title]) } };
}
test("SDK adapter validates the actual pinned prototype and refuses version/shape drift before patching", () => {
  assertInteractiveCompatibility(Object.assign(Object.create(InteractiveMode.prototype), { hideThinkingBlock: true }), VERSION);
  const valid = mode().value;
  for (const version of ["0.0.0", "1.0.2", ""]) assert.throws(() => assertInteractiveCompatibility(valid, version), { code: "UNSUPPORTED_PROFILE" });
  for (const name of members) for (const replacement of [undefined, false, "function"])
    assert.throws(() => adaptInteractiveMode({ ...valid, [name]: replacement }), { code: "UNSUPPORTED_PROFILE" }, name);
  for (const hideThinkingBlock of [undefined, 0, "true"]) assert.throws(() => adaptInteractiveMode({ ...valid, hideThinkingBlock }), { code: "UNSUPPORTED_PROFILE" });
  for (const value of [null, undefined, false]) assert.throws(() => assertInteractiveCompatibility(value, VERSION), { code: "UNSUPPORTED_PROFILE" });
});
test("SDK adapter preserves deterministic thinking, Society identity and awaited failure cleanup", async () => {
  const { value, calls, terminal } = mode(), control = adaptInteractiveMode(value);
  assert.equal(control.setThinkingHidden(true), false);
  assert.equal(control.setThinkingHidden(false), true);
  assert.equal(control.setThinkingHidden(false), false);
  assert.equal(calls.filter(call => call[0] === "thinking").length, 1);
  let finish;
  control.configureSociety({ dispose: () => new Promise(resolve => { finish = resolve; }),
    session: { sessionManager: { getSessionName: () => "work" }, sessionFile: "/sessions/a.jsonl" } }, "/project", terminal);
  value.updateTerminalTitle();
  assert.equal(calls.at(-1)[1], "oma - work - project");
  assert.equal(value.crashReportInstructions(), "Start oma and reopen this session with /resume.");
  value.suggestBugReport(); value.renderProjectTrustWarningIfNeeded();
  value.showManagedToolStatus({ type: "info", message: "quiet" });
  assert.equal(calls.filter(call => call[0] === "showManagedToolStatus").length, 0);
  value.showManagedToolStatus({ type: "warning", message: "visible" });
  assert.equal(calls.at(-1)[1].message, "visible");
  const problem = new Error("original"), failing = control.fail("runtime", problem);
  await Promise.resolve(); assert.equal(calls.some(call => call[0] === "handleFatalRuntimeError"), false);
  finish(); await failing; assert.deepEqual(calls.at(-1), ["handleFatalRuntimeError", "runtime", problem]);
});
test("SDK adapter retains Personal history and original failure before cleanup failure", async () => {
  const { value, calls, terminal } = mode(), primary = new Error("effect"), cleanup = new Error("cleanup");
  const control = adaptInteractiveMode(value);
  control.configurePersonal({ async dispose() { throw cleanup; }, session: {} }, () => calls.push(["history"]), terminal);
  value.showSessionSelector(); value.updateTerminalTitle();
  assert.deepEqual(calls.slice(-2), [["history"], ["title", "oma — Personal"]]);
  assert.equal(value.crashReportInstructions(), "Start oma --mode personal and reopen this session with /resume.");
  await control.fail("failure", primary);
  assert.deepEqual(calls.at(-1)[2].errors, [primary, cleanup]);
  await control.shutdown(); assert.equal(calls.at(-1)[0], "shutdown");
});
