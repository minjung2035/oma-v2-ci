import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { interactiveHostFindings } from "../scripts/check-modules.mjs";
const inspect = text => interactiveHostFindings(ts.createSourceFile("host.ts", text, ts.ScriptTarget.Latest, true));
test("DR47: hosts cannot reintroduce a private SDK handle or named member through types or property access", () => {
  for (const text of ['import type { InteractiveModeInternals } from "./compat.js";',
    'const raw = interactiveInternalsOf(mode);', 'mode.hideThinkingBlock = false;',
    'mode["toggleThinkingBlockVisibility"]();', 'const { handleFatalRuntimeError } = mode;'])
    assert.equal(inspect(text).length, 1, text);
  assert.deepEqual(inspect('controls.setThinkingHidden(false); controls.fail("failure", error); controls.shutdown();'), []);
});
