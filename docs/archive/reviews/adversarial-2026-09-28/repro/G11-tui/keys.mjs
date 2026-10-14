// G11-tui: keys.ts decoder boundaries.
import { KeyDecoder, decodeKeys } from "../../../../dist/src/tui/keys.js";

const enc = s => new TextEncoder().encode(s);
const ESC = "\x1b";
const PS = `${ESC}[200~`, PE = `${ESC}[201~`;

// 1. Control keys inside a paste must not become commands (enter/ctrl-c etc.)
{
  const d = new KeyDecoder(() => 0);
  const keys = [...d.push(enc(`${PS}ab\r\ncd\x03\x1b[Aef${PE}`)), ...d.finish()];
  console.log("1 paste-with-controls:", JSON.stringify(keys));
}

// 2. Clipboard carrying its own ESC[201~ then a newline in the SAME read
{
  const d = new KeyDecoder(() => 0);
  const keys = [...d.push(enc(`${PS}secret${PE}\nMORE`)), ...d.finish()];
  console.log("2 injected-end-then-newline (same read):", JSON.stringify(keys));
}

// 3. Injected end marker then Enter in a LATER read within burst window
{
  let t = 0;
  const d = new KeyDecoder(() => t);
  const a = d.push(enc(`${PS}secret${PE}`));
  t = 10; // within pasteBurstMs=50
  const b = d.push(enc("\r"));
  console.log("3 end-then-enter-in-burst:", JSON.stringify([...a, ...b]));
}

// 4. Paste with no end marker (unterminated) then flushPending
{
  const d = new KeyDecoder(() => 0);
  const first = d.push(enc(`${PS}partialdata`));
  const flushed = d.flushPending();
  console.log("4 unterminated-paste:", JSON.stringify(first), "flush:", JSON.stringify(flushed));
}

// 5. Very large paste (over pasteBytes=16KiB) -> truncated, dropped whole
{
  const d = new KeyDecoder(() => 0);
  const big = "x".repeat(20000);
  const keys = [...d.push(enc(`${PS}${big}${PE}`)), ...d.finish()];
  console.log("5 large-paste truncated:", keys.map(k => k.kind === "paste" ? {kind:"paste",len:k.value.length,truncated:k.truncated}:k));
}

// 6. Split multibyte UTF-8 across two reads (won-sign U+20A9 = e2 82 a9)
{
  const d = new KeyDecoder(() => 0);
  const full = enc("\u20a9");
  const r1 = d.push(full.subarray(0, 1));
  console.log("6 split-utf8 pendingDelay:", d.pendingDelayMs, "r1:", JSON.stringify(r1));
  const r2 = d.push(full.subarray(1));
  console.log("6 split-utf8 completed:", JSON.stringify(r2));
}

// 7. Non-UTF8 / invalid bytes dropped, not typed
{
  const keys = decodeKeys(Uint8Array.from([0xff, 0xfe, 0x41, 0x80, 0x42]));
  console.log("7 invalid-bytes:", JSON.stringify(keys));
}

// 8. Incomplete escape then unrelated: escape buffer growth bounded
{
  const d = new KeyDecoder(() => 0);
  const junk = ESC + "[" + "1".repeat(200) + "m";
  const keys = [...d.push(enc(junk)), ...d.finish()];
  console.log("8 overlong-csi:", JSON.stringify(keys));
}

// 9. Paste containing NUL and C1 bytes -> pastedText strips them
{
  const d = new KeyDecoder(() => 0);
  const keys = [...d.push(enc(`${PS}a\x00b\x9bc\x07d${PE}`)), ...d.finish()];
  console.log("9 paste-strips-controls:", JSON.stringify(keys));
}
