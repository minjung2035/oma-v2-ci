/** AV7 -- INV02 and INV03 applied to the configuration history (WP13).
 *
 * A quiescent collection keeps the current generation and the one committed
 * before it, the basis of a rollback. Which one that is lives in a journal the
 * committer appends after its commit point, and the collection read it as the
 * whole truth: a journal it could not read was an empty history, so every
 * generation but the current was removed; and a commit whose record was lost --
 * a crash between the manifest's rename and the append -- was removed by the
 * next collection although it was the previous generation. The manifest is what
 * says a generation was committed (INV03), and a journal that cannot vouch for
 * the order is not permission to delete (INV02).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfigurationSnapshot, validateConfig } from "../src/config.js";
import { collectManagedGenerations, MANAGED_DIRECTORY } from "../src/config/generations.js";
import { commitManagedEdit } from "../src/tui/sources/settings.js";
import { StoreError } from "../src/domain/errors.js";
import { createCompleteConfigurationFixture } from "./fixtures/configuration.js";

type Fixture = ReturnType<typeof createCompleteConfigurationFixture>;

/** Commits one managed edit per value, in order, and returns the generations. */
function commitEach(f: Fixture, agents: readonly number[]): string[] {
  return agents.map(count => {
    const snapshot = loadConfigurationSnapshot(f.path);
    const result = commitManagedEdit(snapshot, validateConfig({ ...snapshot.config, quota: { ...snapshot.config.quota, societyAgents: count } }));
    assert.equal(result.kind, "committed");
    return result.generation!;
  });
}
const journalOf = (f: Fixture): string => join(f.output, MANAGED_DIRECTORY, "committed");
const generationsOf = (f: Fixture): string => join(f.output, MANAGED_DIRECTORY, "generations");
const recorded = (f: Fixture): string[] => readFileSync(journalOf(f), "utf8").split("\n").filter(Boolean);
/** The journal as a crash between a commit point and its append leaves it. */
const loseLastRecord = (f: Fixture): void => { writeFileSync(journalOf(f), recorded(f).slice(0, -1).map(id => `${id}\n`).join("")); };

test("AV7 / INV03: a commit whose record was lost is written back by the next commit, and collection keeps it as the previous generation", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const [first, second] = commitEach(f, [5, 6]);
    loseLastRecord(f);
    const [third] = commitEach(f, [7]);
    assert.deepEqual(recorded(f).slice(-3), [first, second, third], "the committer did not record the generation the manifest named before its own");
    collectManagedGenerations(loadConfigurationSnapshot(f.path));
    assert.deepEqual(new Set(readdirSync(generationsOf(f))), new Set([second, third]), "the previous generation was removed");
  } finally { f.close(); }
});

test("AV7 / INV02: a journal that cannot be read removes no generation, only what was never committed", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const committed = commitEach(f, [5, 6, 7]);
    // Unreadable for any user, root included: a directory where the file was.
    rmSync(journalOf(f));
    mkdirSync(journalOf(f));
    mkdirSync(join(generationsOf(f), ".staging-leftover"));
    const removed = collectManagedGenerations(loadConfigurationSnapshot(f.path));
    assert.deepEqual(new Set(readdirSync(generationsOf(f))), new Set(committed), "a journal that could not be read was taken for an empty history");
    assert.deepEqual(removed, [".staging-leftover"]);
  } finally { f.close(); }
});

test("AV7 / INV02: when the current generation's record was lost, the last recorded one and every unrecorded one are kept", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const [first, second, third] = commitEach(f, [5, 6, 7]);
    loseLastRecord(f);
    // A generation the journal does not name: nothing says it is older than the previous one.
    const unrecorded = `g-${"a".repeat(64)}`;
    mkdirSync(join(generationsOf(f), unrecorded));
    collectManagedGenerations(loadConfigurationSnapshot(f.path));
    assert.deepEqual(new Set(readdirSync(generationsOf(f))), new Set([second, third, unrecorded]));
    assert.equal(existsSync(join(generationsOf(f), first!)), false, "a generation recorded before the last one is older than the previous and is collected");
  } finally { f.close(); }
});

test("AV7 / INV02: an existing generation that cannot be read is not reported as holding other bytes", () => {
  // Needs a user a mode of 000 refuses, as every verification lane runs as.
  const f = createCompleteConfigurationFixture();
  try {
    const [first] = commitEach(f, [5, 6]);
    const generation = join(generationsOf(f), first!);
    chmodSync(join(generation, "host.json"), 0o000);
    // Going back to the first value publishes the first generation again, which
    // must be compared with the one on disk before it is reused.
    const snapshot = loadConfigurationSnapshot(f.path);
    assert.throws(() => commitManagedEdit(snapshot, validateConfig({ ...snapshot.config, quota: { ...snapshot.config.quota, societyAgents: 5 } })),
      (error: unknown) => !(error instanceof StoreError && /holds other bytes/.test(error.message)) && (error as NodeJS.ErrnoException).code === "EACCES");
  } finally { f.close(); }
});
