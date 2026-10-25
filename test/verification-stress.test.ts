import test from "node:test";
import assert from "node:assert/strict";
import { JsonlReader } from "@oma/protocol/jsonl";

test("R35 stress: 10000 bounded JSONL events dispatch without a retained event queue", () => {
  const reader = new JsonlReader(128); let events = 0;
  const line = Buffer.from('{"type":"notification","text":"bounded"}\n');
  for (let index = 0; index < 10000; index++) {
    reader.feed(line, () => { events++; }); assert.equal(reader.pendingBytes, 0);
  }
  reader.finish(); assert.equal(events, 10000);
});
