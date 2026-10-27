import test from "node:test";
import assert from "node:assert/strict";
import { INITIAL, step, type ConfigField, type PanelData } from "@oma/tui/model";
import { render } from "@oma/tui/view/screens";

const fields: ConfigField[] = [
  { kind: "link", id: "principal-model", label: "Principal model", value: "anthropic/claude-opus-4-8-with-a-long-name · high", blocked: null },
  { kind: "link", id: "worker-model", label: "Worker model", value: "Same as the Principal", blocked: null },
  { kind: "choice", id: "worker-profile", label: "Worker profile", value: "default", options: ["cheap", "default", "large"], apply: "next-activation", blocked: null },
];
const data = { config: fields, extensions: [], mail: [], mailUnreadable: null, mailOmitted: 0,
  dashboard: { status: { kind: "unknown", observedAtMs: 0, reason: "n/a" }, configuredWorkers: 0, unread: 0,
    principalModel: { configured: "default", session: null },  } } as unknown as PanelData;
const screen = (state: typeof INITIAL): string => render({ state, data, transcript: [], body: null, notice: null, busy: false, columns: 100, rows: 20 }).join("\n");

test("Config: a choice being edited shows every option, not only the one in view", () => {
  let state = { ...INITIAL, open: true, category: 1 };
  state = step(state, { kind: "down" }, data, 262144).state;
  state = step(state, { kind: "down" }, data, 262144).state;
  state = step(state, { kind: "enter" }, data, 262144).state;
  const shown = screen(state);
  for (const option of ["○ cheap", "● default (current)", "○ large"]) assert.ok(shown.includes(option), shown);
  state = step(state, { kind: "down" }, data, 262144).state;
  assert.ok(screen(state).includes("● large"));
  const committed = step(state, { kind: "enter" }, data, 262144);
  assert.deepEqual(committed.effects, [{ kind: "set-choice", field: "worker-profile", value: "large" }]);
});

test("DR24: each model is one row -- model and effort -- that opens the engine's own lists, and a long model is shown whole", () => {
  const state = { ...INITIAL, open: true, category: 1 };
  const shown = screen(state);
  // The model is shown whole, not cut to the column; the screen's edge cuts its note instead.
  assert.match(shown, /Principal model\s+anthropic\/claude-opus-4-8-with-a-long-name · high \(Enter/);
  assert.match(shown, /Worker model\s+Same as the Principal/);
  assert.doesNotMatch(shown, /Effort/, "effort is part of the model's row");
  const opened = step(state, { kind: "enter" }, data, 262144);
  assert.deepEqual(opened.effects, [{ kind: "engine-command", command: "principal-model" }]);
  assert.equal(opened.state.open, false, "the engine's list takes the screen");
  const worker = step(step(state, { kind: "down" }, data, 262144).state, { kind: "enter" }, data, 262144);
  assert.deepEqual(worker.effects, [{ kind: "engine-command", command: "worker-model" }]);
  const blocked = { ...data, config: [{ ...fields[0]!, blocked: "Available while the conversation is open" }] } as PanelData;
  assert.deepEqual(step(state, { kind: "enter" }, blocked, 262144).effects, []);
});
