// Declared bounds are data, so they are checked as data. The structural rules
// that used to live here (no inlined bounds, no bare Error, exhaustive
// switches, one owner per engine primitive, one placement table) read the
// syntax tree now: scripts/architecture/rules/surface-rules.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { SURFACE_BOUNDS } from "../src/tui/limits.js";
import { LAYOUT_BOUNDS } from "../src/tui/view/layout.js";
import { SURFACE_LIMITS } from "../src/domain/tool-surface.js";

test("every declared bound is positive, finite and explains itself", () => {
  for (const [name, bound] of Object.entries({ ...SURFACE_BOUNDS, ...LAYOUT_BOUNDS })) {
    assert.ok(Number.isSafeInteger(bound.value) && bound.value > 0, `${name} must be a positive safe integer`);
    assert.ok(bound.why.length > 0, `${name} must say why`);
    assert.ok(["cells", "lines", "bytes", "count"].includes(bound.unit), `${name} needs a unit`);
  }
  for (const [name, value] of Object.entries(SURFACE_LIMITS))
    assert.ok(Number.isSafeInteger(value) && value > 0, `tool surface ${name} must be a positive safe integer`);
});

