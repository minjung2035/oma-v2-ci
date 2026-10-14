// placeholderFor must return a value that is never equal to, and never
// contains, the secret (and vice-versa), or refuse. Fuzz a range of key shapes.
import { placeholderFor } from "../../../../dist/src/runtime/engine-auth.js";
import { randomBytes } from "node:crypto";

const shapes = [
  "sk-" + "a".repeat(40),
  "sk-proj-" + "b".repeat(50),
  "AAAA.BBBB.CCCCCCCCCCCCCCCCCC",                 // JWT-like
  "header.payload." + "s".repeat(40),
  "x".repeat(16),                                  // exactly min, no separators
  "ab_cd_" + "z".repeat(20),
  "short-short-short",                             // all short segments (<=8)
  "-".repeat(20),                                  // only separators
  "____" + "q".repeat(20),
  "sk-" + "1".repeat(30),                          // digits
  "Bearer_" + "k".repeat(20),
];
let bad = 0;
for (const s of shapes) {
  let out, err = null;
  try { out = placeholderFor(s); } catch (e) { err = String(e.code ?? e.message ?? e); }
  const leak = out !== undefined && (out === s || out.includes(s) || s.includes(out));
  if (leak) bad++;
  console.log(JSON.stringify({ key: s.slice(0,20)+"…", out: out?.slice(0,24), err, leak }));
}
// Random fuzz
for (let i = 0; i < 500; i++) {
  const len = 16 + (randomBytes(1)[0] % 40);
  const s = randomBytes(len).toString("base64url").slice(0, len);
  let out; try { out = placeholderFor(s); } catch { continue; }
  if (out === s || out.includes(s) || s.includes(out)) { bad++; console.log("RANDOM LEAK:", s, out); }
}
console.log("LEAKS FOUND:", bad);
