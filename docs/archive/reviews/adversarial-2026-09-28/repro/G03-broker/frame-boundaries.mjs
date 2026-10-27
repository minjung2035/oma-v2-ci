// G03-broker frame boundary probe. Imports built dist frame module.
// Exercises: length prefix 0, limit-1, limit, limit+1, huge; partial reads;
// EOF mid-frame; excess trailing; duplicate keys; __proto__ key.
import { FrameParser, ConnectionDecoder, encodeFrame, parseJsonObject, findDuplicateKey } from "../../../../dist/src/frame.js";

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log("FAIL:", msg); } };

const LIMIT = 64; // small frame budget for boundary math

// Helper: build a frame buffer with an arbitrary declared length and body.
function framed(declaredLen, bodyBuf) {
  const head = Buffer.alloc(4); head.writeUInt32BE(declaredLen, 0);
  return Buffer.concat([head, bodyBuf]);
}

// 1. length 0 -> header says 0-byte body; parseJsonObject gets empty -> INVALID
{
  const p = new FrameParser(LIMIT);
  let threw = null;
  try { p.feed(framed(0, Buffer.alloc(0))); } catch (e) { threw = e; }
  ok(threw && threw.code === "INVALID_REQUEST", `len=0 rejected as INVALID_REQUEST (got ${threw && threw.code})`);
}

// 2. exactly limit: a JSON object body of exactly LIMIT bytes accepted
{
  const body = Buffer.from(JSON.stringify({ pad: "x".repeat(LIMIT - 12) }), "utf8");
  // adjust to exact LIMIT
  const p = new FrameParser(body.length);
  const frames = p.feed(framed(body.length, body));
  ok(frames.length === 1, `len==limit accepted (frames=${frames.length}, bodyLen=${body.length})`);
}

// 3. limit+1: declared length one over bound -> FRAME_TOO_LARGE
{
  const p = new FrameParser(LIMIT);
  let threw = null;
  try { p.feed(framed(LIMIT + 1, Buffer.alloc(LIMIT + 1))); } catch (e) { threw = e; }
  ok(threw && threw.code === "FRAME_TOO_LARGE", `len=limit+1 -> FRAME_TOO_LARGE (got ${threw && threw.code})`);
}

// 4. huge value 0xffffffff -> FRAME_TOO_LARGE, not integer overflow
{
  const p = new FrameParser(LIMIT);
  let threw = null;
  try { p.feed(framed(0xffffffff, Buffer.alloc(8))); } catch (e) { threw = e; }
  ok(threw && threw.code === "FRAME_TOO_LARGE", `len=0xffffffff -> FRAME_TOO_LARGE (got ${threw && threw.code})`);
}

// 5. partial read: header split across two chunks, then body split
{
  const body = Buffer.from(JSON.stringify({ a: 1 }), "utf8");
  const full = framed(body.length, body);
  const p = new FrameParser(LIMIT);
  let frames = [];
  for (const b of [full.subarray(0, 1), full.subarray(1, 3), full.subarray(3, 4), full.subarray(4, 5), full.subarray(5)]) {
    frames = frames.concat(p.feed(b));
  }
  ok(frames.length === 1, `header+body split reassembled (frames=${frames.length})`);
}

// 6. EOF inside body -> finish() throws INVALID_REQUEST
{
  const body = Buffer.from(JSON.stringify({ a: 1 }), "utf8");
  const full = framed(body.length, body);
  const p = new FrameParser(LIMIT);
  p.feed(full.subarray(0, full.length - 1));
  let threw = null;
  try { p.finish(); } catch (e) { threw = e; }
  ok(threw && threw.code === "INVALID_REQUEST", `EOF mid-body -> INVALID_REQUEST (got ${threw && threw.code})`);
}

// 7. poison is sticky: after a fatal error, further feed throws same error
{
  const p = new FrameParser(LIMIT);
  let first = null;
  try { p.feed(framed(0xffffffff, Buffer.alloc(4))); } catch (e) { first = e; }
  let second = null;
  try { p.feed(Buffer.from([0,0,0,1,0x7b])); } catch (e) { second = e; }
  ok(second === first, `parser poisoned stays poisoned (same error object=${second === first})`);
}

// 8. duplicate JSON key detection (including escaped spelling)
{
  ok(findDuplicateKey('{"a":1,"a":2}') === "a", "duplicate plain key detected");
  ok(findDuplicateKey('{"a":1,"\\u0061":2}') === "a", "duplicate escaped key detected");
}

// 9. __proto__ key: does JSON.parse reviver poison prototype? parseJsonObject returns plain object.
{
  let threw = null; let raw = null;
  try { raw = parseJsonObject(Buffer.from('{"__proto__":{"polluted":true}}', "utf8")); }
  catch (e) { threw = e; }
  const polluted = ({}).polluted;
  ok(polluted === undefined, `no global prototype pollution via __proto__ (polluted=${polluted}, threw=${threw && threw.code})`);
  if (raw) ok(Object.getPrototypeOf(raw.raw) === Object.prototype || raw.raw.__proto__ !== undefined, "raw parsed");
}

// 10. ConnectionDecoder collected-stream over budget -> FRAME_TOO_LARGE
{
  const d = new ConnectionDecoder(LIMIT, null, LIMIT); // no sink => collected, budget LIMIT
  const ev = d.beginStream(LIMIT + 1);
  ok(ev.length === 1 && ev[0].kind === "invalid" && ev[0].code === "FRAME_TOO_LARGE",
     `collected stream over budget -> FRAME_TOO_LARGE (got ${ev[0] && ev[0].code})`);
}

// 11. ConnectionDecoder control-budget: queued control bytes over bound+4 -> FRAME_TOO_LARGE
{
  const d = new ConnectionDecoder(LIMIT);
  // Feed a header claiming a legal length but never complete; then push excess control bytes while "buffering".
  let threwCode = null;
  const big = Buffer.alloc(LIMIT + 5); // exceeds bound+4
  const ev = d.bufferControl(big);
  if (ev.length && ev[0].kind === "invalid") threwCode = ev[0].code;
  ok(threwCode === "FRAME_TOO_LARGE", `control buffer over bound+4 -> FRAME_TOO_LARGE (got ${threwCode})`);
}

console.log(`\nframe-boundaries: pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
