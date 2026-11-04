/** Actual production leaf in a fresh process; this fixture grants no role. */
import assert from "node:assert/strict";
import { currentDarwinBootId, identifyDarwinCoalition, observeDarwinCoalitionPopulation,
  darwinCoalitionMemberHints, signalDarwinCoalitionMember } from "@oma/native/audit-session";

assert.equal(process.platform, "darwin");
assert.ok(process.getuid() > 0);
const [mode, input, target] = process.argv.slice(2);
let result;
if (mode === "identity") result = identifyDarwinCoalition(Number(input));
else {
  const identity = JSON.parse(input);
  if (mode === "population") result = observeDarwinCoalitionPopulation(identity);
  else if (mode === "hints") result = darwinCoalitionMemberHints(identity);
  else if (mode === "signal") result = signalDarwinCoalitionMember(identity, Number(target));
  else throw new Error("unknown coalition control fixture mode");
}
console.log(JSON.stringify({ mode, pid: process.pid, uid: process.getuid(), bootId: currentDarwinBootId(), result,
  ...(mode === "identity" ? { targetPid: Number(input) } : { identity: JSON.parse(input) }),
  ...(mode === "signal" ? { targetPid: Number(target) } : {}) }));
