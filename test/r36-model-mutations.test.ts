import test from "node:test";
import assert from "node:assert/strict";
import { advance, initialModel, MODEL_CORPUS, type Action, type Model } from "./model/ledger-model.js";
import { minimizeSequence } from "./model/reproducible.js";

function stateOf(model: Model, slot: number): string | undefined {
  return model.operations.get(slot)?.state;
}
/** Deliberately buggy transition: a reconciliation that only completes
 * operations still marked pending and forgets the ones whose outcome was
 * uncertain. This is never installed in production code.
 */
function mutantAdvance(model: Model, action: Action): void {
  const unknown = action.kind === "reconcile"
    ? [...model.operations.values()].filter(operation => operation.state === "unknown")
    : [];
  advance(model, action);
  for (const operation of unknown) { operation.state = "unknown"; operation.published = false; }
}
function detectsMutant(actions: readonly Action[]): boolean {
  const expected = initialModel(), mutant = initialModel();
  for (const action of actions) {
    advance(expected, action); mutantAdvance(mutant, action);
    for (const slot of new Set([...expected.operations.keys(), ...mutant.operations.keys()]))
      if (stateOf(expected, slot) !== stateOf(mutant, slot)) return true;
  }
  return false;
}
test("R36 model mutant: reconciliation losing an unknown operation is detected and reduced to an independently replayable triple", async () => {
  const corpus = MODEL_CORPUS[2]!;
  assert.equal(detectsMutant(corpus), true);
  const reduced = await minimizeSequence(corpus, async candidate => detectsMutant(candidate));
  assert.equal(reduced.oneMinimal, true);
  assert.deepEqual(reduced.sequence, [
    { kind: "request", slot: 0, variant: 0, boundary: "accepted" }, { kind: "unknown", slot: 0 }, { kind: "reconcile" }]);
  assert.equal(detectsMutant(reduced.sequence), true);
  for (let index = 0; index < reduced.sequence.length; index++)
    assert.equal(detectsMutant(reduced.sequence.filter((_, position) => position !== index)), false, "no action in the minimized witness is dispensable");
  const model = initialModel();
  for (const action of reduced.sequence) advance(model, action);
  assert.equal(stateOf(model, 0), "succeeded");
});
test("R36 model minimizer records exhaustion instead of inventing a minimal witness", async () => {
  const result = await minimizeSequence(MODEL_CORPUS[2]!, async candidate => detectsMutant(candidate), 1);
  assert.equal(result.probes, 1); assert.equal(result.oneMinimal, false);
});
