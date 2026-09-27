// Priority 0, fifth review (external whole-codebase review of 18421f0, R01-R13):
// regressions that belong to no single owner's test file. Each test names the
// finding (P0V) and the review's id (R).
import test from "node:test";
import assert from "node:assert/strict";
import { KeyDecoder } from "../src/tui/keys.js";

test("P0V-67 / R12, P0-2: where the terminal's reads are cut does not change the text -- a U+FEFF after the cut is kept", () => {
  const bom = [...Buffer.from("﻿", "utf8")];
  const typed = (...reads: number[][]): string => {
    const decoder = new KeyDecoder(() => 0);
    const keys = [...reads.flatMap(read => decoder.push(Uint8Array.from(read))), ...decoder.finish()];
    return keys.map(key => (key.kind === "char" ? key.value : "")).join("");
  };
  const whole = [...Buffer.from("A"), ...bom, ...Buffer.from("B")];
  assert.equal(typed(whole), "A﻿B");
  for (let cut = 1; cut < whole.length; cut += 1)
    assert.equal(typed(whole.slice(0, cut), whole.slice(cut)), "A﻿B", `cut after byte ${cut}`);
  // A read that starts with the character is not the start of a document.
  assert.equal(typed([...bom, ...Buffer.from("x")]), "﻿x");
});
