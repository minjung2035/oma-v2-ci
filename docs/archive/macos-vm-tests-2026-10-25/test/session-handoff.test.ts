/** MODE-005/006 and MAC-230: path-free requests and exact terminal outcomes. */
import test from "node:test";
import assert from "node:assert/strict";
import { FrameParser, encodeFrame } from "@oma/protocol/frame";
import { TerminalFrameParser, encodeTerminalFrame, isNewSessionHandoff, parseTerminalExit } from "@oma/protocol/host-guest";

const exit = (value: unknown) => parseTerminalExit(Buffer.from(JSON.stringify(value)));
test("host handoff codec: old exits remain exits; only a successful exact exit requests a new birth", () => {
  assert.deepEqual(exit({ code: 7, signal: null }), { code: 7, signal: null });
  assert.deepEqual(exit({ code: null, signal: "SIGTERM" }), { code: null, signal: "SIGTERM" });
  assert.deepEqual(exit({ code: 0, signal: null, next: "new" }), { code: 0, signal: null, next: "new" });
});
for (const value of [null, [], {}, { code: 0 }, { code: "0", signal: null }, { code: -1, signal: null },
  { code: 0.5, signal: null }, { code: 0, signal: "" }, { code: 0, signal: null, next: "personal" },
  { code: 0, signal: null, next: null }, { code: 7, signal: null, next: "new" },
  { code: 0, signal: "SIGTERM", next: "new" }, { code: 0, signal: null, next: "new", cwd: "/guest" }])
  test(`host handoff codec: invalid outcome ${JSON.stringify(value)} is not a new birth`, () => assert.equal(exit(value), null));
test("host handoff codec: duplicate JSON keys and damaged encoding are refused", () => {
  assert.equal(parseTerminalExit(Buffer.from('{"code":7,"code":0,"signal":null,"next":"new"}')), null);
  assert.equal(parseTerminalExit(Buffer.from([0xff])), null);
});
test("host handoff codec: the private request is exactly one path-free choice", () => {
  assert.equal(isNewSessionHandoff({ next: "new" }), true);
  for (const value of [{}, { next: "personal" }, { next: "new", cwd: "/guest" }, { next: "new", argv: [] }])
    assert.equal(isNewSessionHandoff(value), false);
  const parser = new FrameParser(64 * 1024 - 1), frame = encodeFrame({ next: "new" });
  assert.deepEqual(parser.feed(frame.subarray(0, 5)), []);
  assert.equal(isNewSessionHandoff(parser.feed(frame.subarray(5))[0]!.raw), true);
  assert.doesNotThrow(() => parser.finish());
});
test("host handoff codec: a complete exit followed by partial terminal bytes does not prove complete EOF", () => {
  const parser = new TerminalFrameParser();
  const bytes = encodeTerminalFrame("exit", Buffer.from('{"code":0,"signal":null,"next":"new"}'));
  assert.equal(parser.feed(Buffer.concat([bytes, Buffer.from([0])])).length, 1);
  assert.throws(() => parser.finish(), /EOF inside/);
});
