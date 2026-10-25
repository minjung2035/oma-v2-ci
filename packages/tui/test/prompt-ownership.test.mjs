import test from "node:test";
import assert from "node:assert/strict";
import { pastePrompt, submitPrompt, erasePrompt } from "../dist/prompt.js";

test("a truncated paste cannot become an accepted prompt or erase recoverable input", () => {
  const pasted = pastePrompt({ text: "already typed", overflow: null }, "the visible part", true, 4096);
  const submission = submitPrompt(pasted.draft);
  assert.equal(submission.kind, "show-limit");
  assert.equal(submission.draft.text, "already typed");
  assert.notEqual(submission.draft.overflow, null);
  assert.equal(submitPrompt(erasePrompt(submission.draft).draft).text, "already typed");
});
