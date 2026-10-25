import test from "node:test";
import assert from "node:assert/strict";
import { JsonlReader, type PiEvent } from "@oma/protocol/jsonl";

const SEED = 0x35c0ffee;
const CASES = 512;
test(`R35 property: JSONL LF/UTF-8 split-merge seed=${SEED} cases=${CASES}`, () => {
  let state = SEED;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
  const texts = ["", "alpha", "한글", "🙂", "line\nnext", "\r", "quote\"slash\\", "\u0000"];
  for (let trial = 0; trial < CASES; trial++) {
    const expected = Array.from({ length: 1 + random() % 12 }, (_, index) => ({ type: "message", id: String(index), text: texts[random() % texts.length]! }));
    const bytes = Buffer.from(expected.map(value => JSON.stringify(value)).join("\n") + "\n");
    const reader = new JsonlReader(1024); const actual: PiEvent[] = [];
    for (let position = 0; position < bytes.length;) {
      const end = Math.min(bytes.length, position + 1 + random() % 31);
      reader.feed(bytes.subarray(position, end), event => actual.push(event)); position = end;
    }
    reader.finish(); assert.deepEqual(actual, expected, `seed=${SEED} case=${trial}`);
  }
});
