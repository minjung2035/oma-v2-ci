// G11-tui: does displayable()/fit()/wrap() strip terminal-dangerous bytes?
// view/text.ts is a pure module. Feed hostile model/mail output and inspect the
// output bytes in hex to see whether ESC(0x1b), C1(0x80-0x9f), or bidi/format
// controls survive to the terminal.
import { displayable, fit, wrap, cellWidth } from "../../../../dist/src/tui/view/text.js";

function hex(s) {
  return [...Buffer.from(s, "utf8")].map(b => b.toString(16).padStart(2, "0")).join(" ");
}
function hasESC(s) { return [...Buffer.from(s, "utf8")].includes(0x1b); }
function hasC1(s) { return [...s].some(c => { const n = c.codePointAt(0); return n >= 0x80 && n <= 0x9f; }); }

const csi = "\x1b[2Jred\x1b[31m";
const osc52 = "\x1b]52;c;aGVsbG8=\x07clip";
const osc8 = "\x1b]8;;http://evil\x07link\x1b]8;;\x07";
for (const [name, inp] of [["CSI", csi], ["OSC52", osc52], ["OSC8", osc8]]) {
  const out = displayable(inp);
  console.log(`${name}: ESC_in=${hasESC(inp)} ESC_out=${hasESC(out)} out_hex=${hex(out)}`);
}

const c1 = "a\u0090b\u009bc";
{
  const out = displayable(c1);
  console.log(`C1: C1_in=${hasC1(c1)} C1_out=${hasC1(out)} out_hex=${hex(out)}`);
}

const bidi = "user\u202Eevil.txt";
const isolate = "a\u2066\u2067b\u2069c";
const zwsp = "a\u200Bb\u200Db";
for (const [name, inp] of [["RLO_U+202E", bidi], ["ISOLATES", isolate], ["ZW", zwsp]]) {
  const out = displayable(inp);
  const survived = [...out].some(c => {
    const n = c.codePointAt(0);
    return (n >= 0x200b && n <= 0x200f) || (n >= 0x202a && n <= 0x202e) || (n >= 0x2066 && n <= 0x2069);
  });
  console.log(`${name}: format_survived=${survived} out=${JSON.stringify(out)} out_hex=${hex(out)}`);
}

const body = "line1\x1b[31m\u202Emalicious\nline2";
console.log("wrap:", JSON.stringify(wrap(body, 40)));

console.log("combining fit:", JSON.stringify(fit("a\u0301\u0301\u0301b", 10)), "width(comb)=", cellWidth("\u0301"));
