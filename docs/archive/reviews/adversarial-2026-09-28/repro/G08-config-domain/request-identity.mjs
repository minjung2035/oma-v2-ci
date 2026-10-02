// request-identity: does deep nesting produce an uncaught RangeError rather
// than a domain StoreError? And does the set-field recipe change request hash
// identity in a way that collides distinct requests or splits equal ones?
import { buildRequestIdentity, canonicalRequestParams, requestParamsEqual } from "../../../../dist/src/domain/request-identity.js";

// 1. deep nesting through a non-set-field method's params
function deep(depth) { let v = 0; for (let i = 0; i < depth; i++) v = [v]; return v; }
for (const depth of [1000, 20000, 200000]) {
  try { buildRequestIdentity("mail.send", { to: ["a@b"], body: deep(depth) }); console.log(`depth ${depth}: OK`); }
  catch (e) { console.log(`depth ${depth}: ${e.constructor.name} code=${e.code} ${String(e.message).slice(0,40)}`); }
}

// 2. set-field dedup/sort: two DIFFERENT recipient orders/dups -> same hash (intended)
const h1 = buildRequestIdentity("mail.send", { to: ["b", "a", "a"] }).hash;
const h2 = buildRequestIdentity("mail.send", { to: ["a", "b"] }).hash;
console.log("dup/order collapse (intended):", h1 === h2);

// 3. Does a method NOT in the recipe skip normalization so order matters?
const g1 = buildRequestIdentity("agent.create", { to: ["b", "a"] }).hash;
const g2 = buildRequestIdentity("agent.create", { to: ["a", "b"] }).hash;
console.log("non-recipe method keeps order (distinct):", g1 !== g2);

// 4. -0 vs 0 in params -> same hash? both canonicalize to "0"
const z1 = buildRequestIdentity("x.y", { n: -0 }).hash;
const z2 = buildRequestIdentity("x.y", { n: 0 }).hash;
console.log("-0 vs 0 params hash equal:", z1 === z2);
