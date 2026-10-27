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
import fs, { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { loadConfigurationSnapshot, validateConfig } from "@oma/config";
import { collectManagedGenerations, MANAGED_DIRECTORY } from "@oma/config/generations";
import { commitManagedEdit } from "#oma-test/app/application/settings";
import { StoreError } from "@oma/domain/errors";
import { createCompleteConfigurationFixture } from "./fixtures/configuration.js";

type Fixture = ReturnType<typeof createCompleteConfigurationFixture>;

/** Commits one managed edit per value, in order, and returns the generations. */
function commitEach(f: Fixture, agents: readonly number[]): string[] {
  return agents.map(count => {
    const snapshot = loadConfigurationSnapshot(f.path);
    const result = commitManagedEdit(snapshot, validateConfig({ ...snapshot.config, limits: { ...snapshot.config.limits, logBytes: count } }));
    assert.equal(result.kind, "committed");
    return result.generation!;
  });
}
const journalOf = (f: Fixture): string => join(f.output, MANAGED_DIRECTORY, "committed-v2");
const generationsOf = (f: Fixture): string => join(f.output, MANAGED_DIRECTORY, "generations");
const recorded = (f: Fixture): string[] => readFileSync(journalOf(f), "utf8").split("\n").filter(Boolean);
/** The journal without its last record. */
const loseLastRecord = (f: Fixture): void => { writeFileSync(journalOf(f), recorded(f).slice(0, -1).map(line => `${line}\n`).join("")); };
/** P0V-61: a record names the generation its commit replaced. */
const record = (previous: string | undefined, id: string): string => `${previous ?? "-"} ${id}`;

test("AV7 / INV03, P0V-61: each record names the generation its commit replaced, so a record lost before it changes nothing", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const [, second] = commitEach(f, [5, 6]);
    loseLastRecord(f);
    const [third] = commitEach(f, [7]);
    assert.equal(recorded(f).at(-1), record(second, third!));
    collectManagedGenerations(loadConfigurationSnapshot(f.path));
    assert.deepEqual(new Set(readdirSync(generationsOf(f))), new Set([second, third]), "the previous generation was removed");
  } finally { f.close(); }
});

test("P0V-47 / F1, P0-3: a record an append left unfinished is closed off, so the next record and the previous generation survive", () => {
  // The append of the last record stopped part-way: after the whole record
  // but before its newline, or in the middle of it.
  const cuts: ((line: string) => string)[] = [line => line, line => line.slice(0, 40)];
  for (const cut of cuts) {
    const f = createCompleteConfigurationFixture();
    try {
      const [first, second] = commitEach(f, [5, 6]);
      writeFileSync(journalOf(f), `${recorded(f)[0]}\n${cut(record(first, second!))}`);
      const [third] = commitEach(f, [7]);
      assert.equal(recorded(f).at(-1), record(second, third!), `the next record was glued onto the unfinished one: ${JSON.stringify(recorded(f))}`);
      collectManagedGenerations(loadConfigurationSnapshot(f.path));
      assert.deepEqual(new Set(readdirSync(generationsOf(f))), new Set([second, third]), "the previous generation, the basis of a rollback, was removed");
    } finally { f.close(); }
  }
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

test("AV7 / INV02, P0V-61: when no record says what the current generation's commit replaced, every generation is kept", () => {
  const f = createCompleteConfigurationFixture();
  try {
    const committed = commitEach(f, [5, 6, 7]);
    loseLastRecord(f);
    const unrecorded = `g-${"a".repeat(64)}`;
    mkdirSync(join(generationsOf(f), unrecorded));
    collectManagedGenerations(loadConfigurationSnapshot(f.path));
    assert.deepEqual(new Set(readdirSync(generationsOf(f))), new Set([...committed, unrecorded]));
    // A current append cut after its first generation and later closed off
    // cannot say either. These are partial current records, not old decoding.
    writeFileSync(journalOf(f), committed.map(id => `${id}\n`).join(""));
    collectManagedGenerations(loadConfigurationSnapshot(f.path));
    assert.deepEqual(new Set(readdirSync(generationsOf(f))), new Set([...committed, unrecorded]));
  } finally { f.close(); }
});

test("DR46: retired journal names refuse load, edit and collection without changing existing bytes", () => {
  const f = createCompleteConfigurationFixture();
  try {
    commitEach(f, [5, 6, 7]);
    const snapshot = loadConfigurationSnapshot(f.path);
    const manifest = readFileSync(f.path);
    const journal = readFileSync(journalOf(f));
    const generations = readdirSync(generationsOf(f)).sort();
    const retired = join(f.output, MANAGED_DIRECTORY, "committed");
    writeFileSync(retired, "earlier development journal\n");
    const mismatch = (error: unknown) => error instanceof StoreError && error.code === "INVALID_REQUEST" &&
      /new development state directory/.test(error.message);
    assert.throws(() => loadConfigurationSnapshot(f.path), mismatch);
    assert.throws(() => commitManagedEdit(snapshot, validateConfig({ ...snapshot.config,
      limits: { ...snapshot.config.limits, logBytes: 8 } })), mismatch);
    assert.throws(() => collectManagedGenerations(snapshot), mismatch);
    assert.deepEqual(readFileSync(f.path), manifest);
    assert.deepEqual(readFileSync(journalOf(f)), journal);
    assert.deepEqual(readdirSync(generationsOf(f)).sort(), generations);
    assert.equal(readFileSync(retired, "utf8"), "earlier development journal\n");
  } finally { f.close(); }
});

test("P0V-61 / R06, P0-3: a configuration that returns (A, B, A) keeps B, the generation its last commit replaced", () => {
  // Needs a user a mode of 0400 refuses to append for, as every lane runs as.
  const f = createCompleteConfigurationFixture();
  try {
    // What the manifest named before each commit that was made.
    const made: { previous: string | undefined; id: string }[] = [];
    let manifest: string | undefined;
    const attempt = (count: number): void => {
      const snapshot = loadConfigurationSnapshot(f.path);
      let result;
      try { result = commitManagedEdit(snapshot, validateConfig({ ...snapshot.config, limits: { ...snapshot.config.limits, logBytes: count } })); }
      catch { return; }
      if (result.kind === "committed") { made.push({ previous: manifest, id: result.generation! }); manifest = result.generation!; }
    };
    attempt(5);
    // Every append to the journal fails from here: A -> B -> A.
    chmodSync(journalOf(f), 0o400);
    attempt(6); attempt(5);
    chmodSync(journalOf(f), 0o600);
    collectManagedGenerations(loadConfigurationSnapshot(f.path));
    const last = made.at(-1)!;
    assert.equal(last.id, manifest);
    if (last.previous !== undefined)
      assert.ok(existsSync(join(generationsOf(f), last.previous)), `the generation the last commit replaced (${last.previous}) was removed`);
    // A commit is made only with its record.
    const records = recorded(f);
    for (const { previous, id } of made) assert.ok(records.includes(record(previous, id)), `commit ${id} has no record`);
  } finally { f.close(); }
});

test("P0V-72 / F5, P0-5: a journal read that returns less than was asked is read on, and one that ends early keeps everything", async t => {
  const f = createCompleteConfigurationFixture();
  t.after(() => { syncBuiltinESMExports(); f.close(); });
  // A, B, C and A again: the current generation is A, and C is what its last commit replaced.
  const [a, , c] = commitEach(f, [5, 6, 7, 5]);
  const real = fs.readSync;
  // The first read returns only the journal's first record, as read(2) may.
  let reads = 0; let endEarly = false;
  t.mock.method(fs, "readSync", ((fd: number, buffer: Buffer, offset: number, length: number, position: number | null) => {
    reads += 1;
    if (reads === 1) {
      const whole = Buffer.alloc(length);
      const got = real(fd, whole, 0, length, position);
      const first = whole.subarray(0, got).indexOf(0x0a) + 1;
      whole.copy(buffer, offset, 0, first);
      return first;
    }
    return endEarly ? 0 : real(fd, buffer, offset, length, position);
  }) as typeof fs.readSync);
  syncBuiltinESMExports();
  const snapshot = loadConfigurationSnapshot(f.path);
  reads = 0;
  collectManagedGenerations(snapshot);
  assert.ok(reads >= 2, "the journal was not read on after a short read");
  assert.ok(existsSync(join(generationsOf(f), a!)) && existsSync(join(generationsOf(f), c!)), "C was removed after a short read");
  // An end of file before the window is whole is not the journal's end.
  const again = createCompleteConfigurationFixture();
  try {
    const committed = commitEach(again, [5, 6, 7, 5]);
    const before = loadConfigurationSnapshot(again.path);
    reads = 0; endEarly = true;
    collectManagedGenerations(before);
    endEarly = false;
    assert.deepEqual(new Set(readdirSync(generationsOf(again))), new Set(committed), "a journal read that ended early removed a generation");
  } finally { again.close(); }
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
    assert.throws(() => commitManagedEdit(snapshot, validateConfig({ ...snapshot.config, limits: { ...snapshot.config.limits, logBytes: 5 } })),
      (error: unknown) => !(error instanceof StoreError && /holds other bytes/.test(error.message)) && (error as NodeJS.ErrnoException).code === "EACCES");
  } finally { f.close(); }
});

test("DR46 / P0-5: a journal append that writes zero bytes refuses without replacing the manifest", t => {
  const f = createCompleteConfigurationFixture();
  const real = fs.writeSync;
  try {
    commitEach(f, [5]);
    const snapshot = loadConfigurationSnapshot(f.path);
    const manifest = readFileSync(f.path), journal = readFileSync(journalOf(f));
    t.mock.method(fs, "writeSync", ((fd: number, ...args: unknown[]) => {
      if (fs.readlinkSync(`/proc/self/fd/${fd}`) === journalOf(f)) return 0;
      return Reflect.apply(real, fs, [fd, ...args]);
    }) as typeof fs.writeSync);
    syncBuiltinESMExports();
    assert.throws(() => commitManagedEdit(snapshot, validateConfig({ ...snapshot.config,
      limits: { ...snapshot.config.limits, logBytes: 6 } })),
      (error: unknown) => error instanceof StoreError && error.code === "BROKER_UNAVAILABLE");
    assert.deepEqual(readFileSync(f.path), manifest);
    assert.deepEqual(readFileSync(journalOf(f)), journal);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); f.close(); }
});
