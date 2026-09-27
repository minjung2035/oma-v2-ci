// Priority 0, fifth review (external whole-codebase review of 18421f0, R01-R13):
// regressions that belong to no single owner's test file. Each test names the
// finding (P0V) and the review's id (R).
import test from "node:test";
import assert from "node:assert/strict";
import { KeyDecoder, type Key } from "../src/tui/keys.js";
import { INITIAL, step, type MailRow, type Notice, type PanelData, type State } from "../src/tui/model.js";
import { mailScrollLimit, render } from "../src/tui/view/index.js";
import { unknownDashboard } from "./fixtures/dashboard.js";

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

test("P0V-68 / R13, P0-2: the last line of a long message can be scrolled to while a notice or the busy line is shown", () => {
  const row: MailRow = { id: "m-a", from: "worker-a", kind: "message", subject: "long", unread: false, path: "/mail/m-a" };
  const data: PanelData = Object.freeze({ dashboard: unknownDashboard(), config: Object.freeze([]), extensions: Object.freeze([]), mail: Object.freeze([row]), mailUnreadable: null, mailOmitted: 0 });
  let state = step(INITIAL, { kind: "panel" } as Key, data, 262144).state;
  for (const kind of ["right", "right", "enter"] as const) state = step(state, { kind } as Key, data, 262144).state;
  const body = { text: Array.from({ length: 60 }, (_, index) => `line ${index + 1}`).join("\n"), truncated: false };
  const notices: [Notice | null, boolean][] = [[null, false], [null, true], [{ kind: "unchanged", label: "x", value: "1" }, false]];
  for (const [notice, busy] of notices) {
    const input = { state, data, transcript: [], body, notice, busy, columns: 60, rows: 12 };
    const bottom = { ...input, state: { ...state, detail: { ...state.detail, scroll: mailScrollLimit(input) } } as State };
    assert.match(render(bottom).join("\n"), /^line 60\s*$/m, `the last line is out of reach (notice ${notice !== null}, busy ${busy})`);
  }
});
