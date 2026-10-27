import test from "node:test";
import assert from "node:assert/strict";
import { FrameParser, encodeFrame, parseJsonObject } from "@oma/protocol/frame";
import { decodeReceipt, receiptSupersession } from "@oma/protocol/receipt-codec";

test("framed UTF-8 survives every split; a partial frame is never an answered message", () => {
  const value = { v: 1, id: "질문", params: { body: "답변 😀" } };
  const frame = encodeFrame(value);
  for (let split = 0; split <= frame.length; split++) {
    const parser = new FrameParser(1024);
    const parsed = [...parser.feed(frame.subarray(0, split)), ...parser.feed(frame.subarray(split))];
    parser.finish();
    assert.deepEqual(parsed.map(item => item.raw), [value]);
  }
  const incomplete = new FrameParser(1024);
  assert.deepEqual(incomplete.feed(frame.subarray(0, -1)), []);
  assert.throws(() => incomplete.finish(), { code: "INVALID_REQUEST" });
  assert.throws(() => parseJsonObject(Buffer.from('{"state":"pending","state":"succeeded"}')), { code: "INVALID_REQUEST" });
});
test("receipt decoding preserves unknown and refuses a terminal downgrade", () => {
  const operation = "op-00000000-0000-4000-8000-000000000001";
  const terminal = { operation, state: "failed", error: { code: "CAPABILITY_DENIED", message: "recorded", retry: "never" } };
  const unknown = { operation, state: "unknown", reason: "effect not observed" };
  assert.equal(decodeReceipt(unknown).ok, true);
  assert.equal(decodeReceipt({ ...unknown, result: { kind: "society.set", state: "open" } }).ok, false);
  assert.equal(receiptSupersession(terminal, unknown), "stale");
});
