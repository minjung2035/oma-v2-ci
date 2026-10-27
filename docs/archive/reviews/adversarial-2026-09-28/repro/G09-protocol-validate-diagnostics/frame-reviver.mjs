// G09 repro: confirm the JSON.parse-reviver overflow threshold and that it is
// surfaced as a caught FrameError, plus the frame byte cost of the attack.
import { parseJsonObject, FrameParser, ConnectionDecoder } from "../../../../dist/src/frame.js";

const deepObject = (n) => '{"a":'.repeat(n) + "1" + "}".repeat(n);

// Find the depth where the reviver overflows and the frame byte size there.
for (const depth of [500, 800, 1000, 1200, 2000]) {
  const body = `{"v":1,"id":"x","method":"mail.ack","params":${deepObject(depth)},"request":"k"}`;
  try {
    parseJsonObject(Buffer.from(body, "utf8"));
    console.log(`depth ${depth} (${body.length} bytes): parsed OK`);
  } catch (e) {
    console.log(`depth ${depth} (${body.length} bytes): ${e.name}/${e.code}: ${String(e.message).slice(0,30)}`);
  }
}

// FrameParser.feed wraps parseJsonObject; a reviver RangeError -> poison as FrameError?
const fp = new FrameParser(256 * 1024);
const body = Buffer.from(`{"v":1,"id":"x","method":"mail.ack","params":${deepObject(3000)},"request":"k"}`, "utf8");
const framed = Buffer.alloc(4 + body.length); framed.writeUInt32BE(body.length, 0); body.copy(framed, 4);
try { fp.feed(framed); console.log("FrameParser.feed(deep): returned frames (no throw)"); }
catch (e) { console.log(`FrameParser.feed(deep): threw ${e.name}/${e.code} (poisoned=${fp.poisoned})`); }

// ConnectionDecoder.push returns events, converting FrameError to {kind:"invalid"} — no throw?
const cd = new ConnectionDecoder(256 * 1024);
const events = cd.push(framed);
console.log(`ConnectionDecoder.push(deep): events=${JSON.stringify(events.map(e => e.kind + (e.code ? "/" + e.code : "")))}`);
