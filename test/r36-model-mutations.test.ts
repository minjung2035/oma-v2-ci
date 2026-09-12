import test from "node:test";
import assert from "node:assert/strict";
import { advance, initialModel, MODEL_CORPUS, type Action, type Model } from "./model/ledger-model.js";
import { minimizeSequence } from "./model/reproducible.js";

function expectedCharge(model: Model): number {
  let total = 0;
  for (const row of model.usage.values()) total += row.outcome === "completed" ? 4 : row.outcome === "cancelled" ? 0 : 10;
  return total;
}
/** Deliberately buggy observation: loss of provider evidence is incorrectly
 * treated as a zero charge. This is never installed in production code.
 */
function mutantCharge(model: Model): number {
  let total = 0;
  for (const row of model.usage.values()) total += row.outcome === "reserved" ? 10 : row.outcome === "completed" ? 4 : 0;
  return total;
}
function detectsMutant(actions: readonly Action[]): boolean {
  const model = initialModel();
  for (const action of actions) {
    advance(model, action);
    if (mutantCharge(model) !== expectedCharge(model)) return true;
  }
  return false;
}
test("R36 model mutant: unknown reservation loss is detected and reduced to an independently replayable pair", async () => {
  const corpus = MODEL_CORPUS[2]!;
  assert.equal(detectsMutant(corpus), true);
  const reduced = await minimizeSequence(corpus, async candidate => detectsMutant(candidate));
  assert.equal(reduced.oneMinimal, true);
  assert.deepEqual(reduced.sequence, [{ kind: "reserve", slot: 0 }, { kind: "settle", slot: 0, outcome: "unknown" }]);
  assert.equal(detectsMutant(reduced.sequence), true);
  for (let index = 0; index < reduced.sequence.length; index++)
    assert.equal(detectsMutant(reduced.sequence.filter((_, position) => position !== index)), false, "no action in the minimized witness is dispensable");
  const model = initialModel();
  for (const action of reduced.sequence) advance(model, action);
  assert.equal(expectedCharge(model), 10); assert.equal(mutantCharge(model), 0);
});
test("R36 model minimizer records exhaustion instead of inventing a minimal witness", async () => {
  const result = await minimizeSequence(MODEL_CORPUS[2]!, async candidate => detectsMutant(candidate), 1);
  assert.equal(result.probes, 1); assert.equal(result.oneMinimal, false);
});
