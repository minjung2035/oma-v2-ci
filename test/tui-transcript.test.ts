/** T120 / TUI-023 / arch §23.6: what the conversation surface keeps.
 *
 * The bound these tests hold is on the conversation, not on how many times a
 * producer called append. Each positive assertion is paired with a control
 * that shows the weaker rule -- counting appends, or counting lines without a
 * byte ceiling -- failing on the same input, so a passing run means the bound
 * is doing work rather than the fixture being small.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Transcript, storedLines } from "@oma/tui/transcript";
import { CONVERSATION_BOUNDS } from "@oma/domain/surface-bounds";

const LINES = CONVERSATION_BOUNDS.transcriptLines.value;
const TOTAL_BYTES = CONVERSATION_BOUNDS.transcriptBytes.value;
const LINE_BYTES = CONVERSATION_BOUNDS.transcriptLineBytes.value;

const bytesOf = (text: string): number => Buffer.byteLength(text, "utf8");

/** The rule this module replaced: one append is one entry. */
function appendCounting(texts: readonly string[]): string[] {
  const entries: string[] = [];
  for (const text of texts) {
    entries.push(text);
    while (entries.length > LINES) entries.shift();
  }
  return entries;
}

test("TUI-023: one produced reply is bounded by its lines, not by being one append", () => {
  const reply = Array.from({ length: LINES * 4 }, (_, index) => `l${index}`).join("\n");
  const transcript = new Transcript();
  transcript.append(reply);
  assert.ok(transcript.lines.length <= LINES,
    `the transcript held ${transcript.lines.length} lines past a bound of ${LINES}`);
  assert.equal(transcript.lines.at(-1), `l${LINES * 4 - 1}`, "the newest line must survive the trim");
  assert.equal(transcript.lines.at(0), `l${LINES * 3}`);

  const control = appendCounting([reply]);
  assert.equal(control.length, 1, "the control kept the reply as one entry");
  assert.equal(control.join("\n").split("\n").length, LINES * 4,
    "the control did not reproduce the defect this test exists for");
});

test("TUI-023: one produced line is bounded by bytes, not left to hold a megabyte", () => {
  const huge = "a".repeat(LINE_BYTES * 8);
  assert.deepEqual(storedLines("short"), ["short"]);
  const pieces = storedLines(huge);
  assert.equal(pieces.join(""), huge, "splitting a line must not lose any of it");
  for (const piece of pieces) assert.ok(bytesOf(piece) <= LINE_BYTES, `a stored line held ${bytesOf(piece)} bytes`);

  const transcript = new Transcript();
  transcript.append("a".repeat(TOTAL_BYTES * 2));
  assert.ok(transcript.heldBytes <= TOTAL_BYTES,
    `the transcript held ${transcript.heldBytes} bytes past a bound of ${TOTAL_BYTES}`);
  assert.ok(transcript.lines.length <= LINES);

  // Control: counting lines alone -- the rule without the byte ceiling -- is
  // satisfied by the same input while holding twice the declared total.
  const byLinesOnly = ["a".repeat(TOTAL_BYTES * 2)];
  assert.ok(byLinesOnly.length <= LINES);
  assert.ok(bytesOf(byLinesOnly.join("")) > TOTAL_BYTES,
    "the control did not reproduce the defect this test exists for");
});

test("TUI-023: a bounded line is still valid UTF-8, and a cluster is not split where it need not be", () => {
  const korean = "가".repeat(LINE_BYTES);
  for (const piece of storedLines(korean)) {
    assert.ok(bytesOf(piece) <= LINE_BYTES);
    assert.equal(piece.includes("�"), false, "a stored line held a replacement character");
    assert.equal(Buffer.from(piece, "utf8").toString("utf8"), piece, "a stored line was not valid UTF-8");
    assert.equal(piece.replace(/가/g, ""), "", "a code point was cut in half");
  }
  assert.equal(storedLines(korean).join(""), korean);

  const family = "👨‍👩‍👧‍👦";
  const many = family.repeat(Math.ceil(LINE_BYTES / bytesOf(family)) * 3);
  const pieces = storedLines(many);
  assert.equal(pieces.join(""), many);
  for (const piece of pieces) {
    assert.ok(bytesOf(piece) <= LINE_BYTES);
    assert.equal(Buffer.from(piece, "utf8").toString("utf8"), piece);
    assert.equal(piece.replace(new RegExp(family, "g"), ""), "", "a grapheme cluster was split");
  }

  // One cluster that is itself over the bound cannot be honoured, and the cut
  // still lands on a code point boundary rather than inside one.
  const oneCluster = `a${"́".repeat(LINE_BYTES)}`;
  const cut = storedLines(oneCluster);
  assert.ok(cut.length > 1, "an unbounded cluster must not make an unbounded line");
  assert.equal(cut.join(""), oneCluster);
  for (const piece of cut) {
    assert.ok(bytesOf(piece) <= LINE_BYTES);
    assert.equal(Buffer.from(piece, "utf8").toString("utf8"), piece);
  }
});

test("TUI-023: every producer's line breaks are line breaks, whatever the terminal wrote", () => {
  const transcript = new Transcript();
  transcript.append("a\r\nb\rc\nd");
  assert.deepEqual(transcript.lines, ["a", "b", "c", "d"]);
  assert.equal(transcript.heldBytes, 4);

  const empty = new Transcript();
  empty.append("");
  assert.deepEqual(empty.lines, [""], "an empty produced line is still a line");
  assert.equal(empty.heldBytes, 0);
});

test("TUI-023: one enormous append leaves only the tail, and many small ones agree with it", () => {
  // The implementation trims as each line arrives rather than once at the end,
  // so a reply far larger than the bound is never first held in full. Peak
  // memory inside one call is not observable from here and is not claimed: what
  // is asserted is that both arrival shapes end at the same bounded state.
  const lines = Array.from({ length: LINES * 10 }, (_, index) => `line ${index}`);

  const single = new Transcript();
  single.append(lines.join("\n"));
  assert.ok(single.lines.length <= LINES, `one append left ${single.lines.length} lines`);
  assert.ok(single.heldBytes <= TOTAL_BYTES);
  assert.equal(single.lines.at(-1), `line ${LINES * 10 - 1}`);

  const incremental = new Transcript();
  for (const line of lines) {
    incremental.append(line);
    assert.ok(incremental.lines.length <= LINES, "the bound must hold at every step, not only at the end");
  }
  assert.deepEqual(incremental.lines, single.lines,
    "how a reply was delivered must not change what the conversation keeps");
  assert.equal(incremental.heldBytes, single.heldBytes);
});
