// G09 repro: does the admission path bound nesting depth BEFORE the unbounded
// recursion in canonical-json.ts (snapshotJson line ~16, appendCanonical line ~58)?
// Run: node deep-nesting.mjs
import { snapshotJson, canonicalJson } from "../../../../dist/src/domain/canonical-json.js";
import { buildRequestIdentity } from "../../../../dist/src/domain/request-identity.js";
import { parseJsonObject } from "../../../../dist/src/frame.js";
import { checkObject, checkString, checkArray } from "../../../../dist/src/validate.js";

function deepArray(n) {
  // Build "[[[[...]]]]" as a string so JSON.parse (iterative in V8) builds it.
  return "[".repeat(n) + "]".repeat(n);
}
function deepObject(n) {
  return '{"a":'.repeat(n) + "1" + "}".repeat(n);
}

// 1. Does V8 JSON.parse itself throw on deep nesting?
for (const depth of [1000, 10000, 100000, 1000000]) {
  try {
    JSON.parse(deepArray(depth));
    console.log(`JSON.parse array depth ${depth}: OK (no throw)`);
  } catch (e) {
    console.log(`JSON.parse array depth ${depth}: ${e.constructor.name}: ${String(e.message).slice(0,40)}`);
  }
}

// 2. snapshotJson recursion (the G08 line ~16 concern) on already-parsed value.
for (const depth of [1000, 5000, 20000, 100000]) {
  let v;
  try { v = JSON.parse(deepArray(depth)); }
  catch { console.log(`snapshotJson depth ${depth}: skipped (parse failed)`); continue; }
  try {
    snapshotJson(v);
    console.log(`snapshotJson array depth ${depth}: OK`);
  } catch (e) {
    console.log(`snapshotJson array depth ${depth}: ${e.constructor.name}: ${String(e.message).slice(0,50)}`);
  }
}

// 3. canonicalJson (appendCanonical line ~58) on deep object.
for (const depth of [1000, 5000, 20000, 100000]) {
  let v;
  try { v = JSON.parse(deepObject(depth)); }
  catch { console.log(`canonicalJson depth ${depth}: skipped (parse failed)`); continue; }
  try {
    canonicalJson(v);
    console.log(`canonicalJson object depth ${depth}: OK`);
  } catch (e) {
    console.log(`canonicalJson object depth ${depth}: ${e.constructor.name}: ${String(e.message).slice(0,50)}`);
  }
}

// 4. buildRequestIdentity — the request-identity path. Does hashing bound depth?
//    Use a method with no set-field recipe so params passes through as-is.
for (const depth of [20000, 100000]) {
  let v;
  try { v = JSON.parse(deepObject(depth)); }
  catch { console.log(`buildRequestIdentity depth ${depth}: skipped`); continue; }
  try {
    buildRequestIdentity("mail.ack", v);
    console.log(`buildRequestIdentity depth ${depth}: OK`);
  } catch (e) {
    console.log(`buildRequestIdentity depth ${depth}: ${e.constructor.name}: ${String(e.message).slice(0,50)}`);
  }
}

// 5. Can a RangeError from deep recursion escape UNCAUGHT if invoked where only
//    TypeError/StoreError are expected? request-codec.decodeMutationPayload calls
//    snapshotJson FIRST. Simulate: snapshotJson throwing RangeError is not a TypeError.
for (const depth of [100000]) {
  let v = JSON.parse(deepArray(depth));
  try { snapshotJson(v); }
  catch (e) {
    console.log(`snapshotJson RangeError? isRangeError=${e instanceof RangeError} name=${e.constructor.name}`);
  }
}
