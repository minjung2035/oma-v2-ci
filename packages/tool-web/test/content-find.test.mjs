import test from "node:test";
import assert from "node:assert/strict";
import { findContent } from "../dist/vendor/pi-web-access/runtime/content-find.js";

test("001. Case-insensitive excerpts use original offsets after Unicode case expansion", () => {
  const result = findContent("İ".repeat(600) + "Needle" + "x".repeat(1000), ["needle"], "case-insensitive");
  assert.equal(result.matchCount, 1);
  assert.equal(result.returnedMatches, 1);
  assert.match(result.text, /Needle/);
});

test("002. Text search preserves literal punctuation and case-sensitive matching", () => {
  const text = "[a+b] [A+B] aab";
  assert.equal(findContent(text, ["[a+b]"], "case-insensitive").matchCount, 2);
  assert.equal(findContent(text, ["[a+b]"], "exact").matchCount, 1);
});
