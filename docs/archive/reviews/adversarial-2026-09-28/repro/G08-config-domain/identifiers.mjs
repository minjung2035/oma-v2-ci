// identifiers/derived: reserved names, topic- prefix, unit-name collisions (P0V-26).
import { isValidActorName, isValidActor, isValidSocietyName, isValidTopicName, RESERVED_ACTOR_NAMES } from "../../../../dist/src/domain/identifiers.js";
import { unitNameFor, residentUnitsFor } from "../../../../dist/src/domain/derived.js";

// reserved & prefix boundaries
for (const n of ["principal", "commons", "residents", "broker", "reconcile", "principal-relay", "topic", "topic-x", "topic-", "Principal", "-x", "a", "a".repeat(32), "a".repeat(33), "1a", "a_b"]) {
  console.log(`actorName ${JSON.stringify(n)}: ${isValidActorName(n)} actor:${isValidActor(n)}`);
}

// unit-name collision: a resident's service/path unit vs broker/reconcile/relay units.
// unitNameFor(society, kind, suffix) -> oma-<society>-<kind>.<suffix>
// A resident named "broker" is rejected (reserved), but check for any collision
// where two distinct (kind) inputs map to the same unit string.
const society = "soc";
const kinds = ["broker", "principal-relay", "reconcile", "principal", "resident", "worker"];
const seen = new Map();
for (const kind of kinds) {
  for (const suffix of ["service", "path", "timer"]) {
    try {
      const u = unitNameFor(society, kind, suffix);
      if (seen.has(u)) console.log(`COLLISION: ${u} from ${seen.get(u)} and ${kind}/${suffix}`);
      seen.set(u, `${kind}/${suffix}`);
    } catch (e) { /* invalid kind */ }
  }
}
console.log("distinct unit names:", seen.size);

// Can a society name contain a '-' that lets society+kind ambiguity? e.g.
// society "soc-broker" resident "x" vs society "soc" kind "broker-x"? kind is closed.
try { console.log("society soc-broker resident worker:", residentUnitsFor("soc-broker", "worker")); } catch (e) { console.log("err", e.message); }
try { console.log("society soc resident worker:", residentUnitsFor("soc", "worker")); } catch (e) { console.log("err", e.message); }
