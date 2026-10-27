// Attack canonical-json: number spelling determinism, -0, 1e21, big ints,
// __proto__ literal key, deep nesting stack overflow, hash collision.
import { canonicalJson, snapshotJson } from "../../../../dist/src/domain/canonical-json.js";

function show(label, fn) {
  try { console.log(label, "=>", JSON.stringify(fn())); }
  catch (e) { console.log(label, "THREW", e.constructor.name, String(e.message).slice(0, 60)); }
}

show("canon(1e21)", () => canonicalJson(1e21));
show("JSON.stringify(1e21)", () => JSON.stringify(1e21));
show("canon(-0)", () => canonicalJson(-0));
show("canon(0)", () => canonicalJson(0));
show("canon(1e-7)", () => canonicalJson(1e-7));
show("JSON.stringify(1e-7)", () => JSON.stringify(1e-7));
show("canon(5e-324)", () => canonicalJson(5e-324));

for (const n of [1e21, 1e-7, 5e-324, 1.5e300, 123456789012345680]) {
  const c = canonicalJson(n);
  let reparsed;
  try { reparsed = JSON.parse(c); } catch { reparsed = "PARSE_FAIL:" + c; }
  console.log(`roundtrip ${n}: canon=${c} reparse=${reparsed} equal=${Object.is(reparsed, n)}`);
}

show("proto key", () => {
  const o = JSON.parse('{"__proto__": {"polluted": 1}, "a": 2}');
  const snap = snapshotJson(o);
  return { canon: canonicalJson(snap), objProtoPolluted: ({}).polluted };
});

for (const depth of [1000, 10000, 100000, 300000]) {
  let s = "";
  for (let i = 0; i < depth; i++) s += "[";
  s += "0";
  for (let i = 0; i < depth; i++) s += "]";
  try {
    const v = JSON.parse(s);
    canonicalJson(v);
    console.log(`deep ${depth}: OK`);
  } catch (e) {
    console.log(`deep ${depth}: ${e.constructor.name} ${String(e.message).slice(0,40)}`);
  }
}

const pairs = [[-0, 0], [1e21, 1000000000000000000000], [9007199254740993, 9007199254740992]];
for (const [a, b] of pairs) {
  const ca = canonicalJson(a), cb = canonicalJson(b);
  console.log(`collide ${a} vs ${b}: ${ca}==${cb} -> ${ca === cb}, Object.is=${Object.is(a,b)}`);
}
