import test from "node:test";
import assert from "node:assert/strict";
import fs, { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RESULT_PAGE_BYTES, createResult, readResult } from "../dist/results.js";

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oma-results-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function stored(root, bytes, id = ID) {
  const writer = createResult(root, id);
  writer.append(bytes);
  return { file: join(root, `${id}.result`), reference: writer.finish() };
}
function descriptorTargets(fd, file) {
  for (const base of ["/proc/self/fd", "/dev/fd"]) {
    try { if (fs.readlinkSync(`${base}/${fd}`) === file) return true; } catch { /* not this one */ }
  }
  return false;
}
/** The audited same-inode schedule: a co-operating writer rewrites the stored
 * result at the instant the descriptor's last validation sample returns --
 * after the verified pass, at the point the page bytes would have been read. */
function racerAtLastSample(file, mutate) {
  const real = fs.fstatSync;
  let samples = 0, fired = false;
  fs.fstatSync = (fd, ...args) => {
    const value = real(fd, ...args);
    if (!fired && descriptorTargets(fd, file) && ++samples === 2) { fired = true; mutate(); }
    return value;
  };
  syncBuiltinESMExports();
  return { fired: () => fired, restore: () => { fs.fstatSync = real; syncBuiltinESMExports(); } };
}
/** A writer that lands inside the verified pass itself. */
function racerDuringPass(file, mutate) {
  const real = fs.readSync;
  let fired = false;
  fs.readSync = (fd, ...args) => {
    const count = real(fd, ...args);
    if (!fired && descriptorTargets(fd, file)) { fired = true; mutate(); }
    return count;
  };
  syncBuiltinESMExports();
  return { fired: () => fired, restore: () => { fs.readSync = real; syncBuiltinESMExports(); } };
}

test("001. A same-inode rewrite after the verified pass cannot change the bytes a page reports", t => {
  const root = fixture(t), original = Buffer.from("ORIGINAL");
  const { file, reference } = stored(root, original);
  const racer = racerAtLastSample(file, () => writeFileSync(file, "MUTATED!"));
  let page;
  try { page = readResult(root, reference.reference); }
  finally { racer.restore(); }
  assert.equal(racer.fired(), true, "the racer never reached the post-verification window");
  assert.equal(page.text, "ORIGINAL", "page bytes disagree with the validated snapshot");
  assert.equal(page.sha256, reference.sha256);
  assert.equal(page.bytes, original.length);
  assert.equal(page.next, null);
  assert.equal(readFileSync(file, "utf8"), "MUTATED!", "the racer's write did not happen");
});

test("002. A page taken at an offset that spans verification blocks stays with the verified snapshot", t => {
  const root = fixture(t);
  const head = "A".repeat(RESULT_PAGE_BYTES + 4096), tail = "TAIL", original = Buffer.from(head + tail);
  const { file, reference } = stored(root, original);
  const offset = RESULT_PAGE_BYTES - 2;
  const racer = racerAtLastSample(file, () => writeFileSync(file, "B".repeat(RESULT_PAGE_BYTES + 4096) + tail));
  let page;
  try { page = readResult(root, reference.reference, { byteOffset: offset, byteLimit: 8 }); }
  finally { racer.restore(); }
  assert.equal(racer.fired(), true, "the racer never reached the post-verification window");
  assert.equal(page.text, "AA".repeat(4));
  assert.equal(page.byteOffset, offset);
  assert.equal(page.next, offset + 8);
  assert.equal(page.bytes, original.length);
  assert.equal(page.sha256, reference.sha256);
  assert.equal(readFileSync(file, "utf8").slice(offset, offset + 8), "BBBBBBBB");
});

test("003. A line page reports the validated line even when the writer lands after the pass", t => {
  const root = fixture(t);
  const lines = Buffer.from(`first\n${"x".repeat(RESULT_PAGE_BYTES)}\nomega\n`);
  const { file, reference } = stored(root, lines);
  const racer = racerAtLastSample(file, () => writeFileSync(file, Buffer.from(`FIRST\n${"y".repeat(RESULT_PAGE_BYTES)}\nOMEGA\n`)));
  let page;
  try { page = readResult(root, reference.reference, { line: 3, byteLimit: 5 }); }
  finally { racer.restore(); }
  assert.equal(racer.fired(), true, "the racer never reached the post-verification window");
  assert.equal(page.text, "omega");
  assert.equal(page.byteOffset, 6 + RESULT_PAGE_BYTES + 1);
  assert.equal(lines.subarray(page.byteOffset, page.byteOffset + 6).toString(), "omega\n");
  assert.equal(page.next, page.byteOffset + 5, "the page ends before the line's own newline");
  assert.equal(readFileSync(file, "utf8").slice(0, 5), "FIRST");
});

for (const [description, content, mutate] of [
  ["appends to a result", "ORIGINAL", file => writeFileSync(file, "ORIGINAL+")],
  ["rewrites a later block of a large result", "A".repeat(200_000), file => writeFileSync(file, "B".repeat(200_000))],
]) test(`004. A writer that ${description} during the verified pass refuses instead of paging a torn result`, t => {
  const root = fixture(t);
  const { file, reference } = stored(root, Buffer.from(content));
  const racer = racerDuringPass(file, () => mutate(file));
  try {
    assert.throws(() => readResult(root, reference.reference), error =>
      error.message === "result changed or its digest does not match");
  } finally { racer.restore(); }
  assert.equal(racer.fired(), true, "the writer never reached the verified pass");
});

test("005. A result whose stored bytes no longer match the reference digest refuses", t => {
  const root = fixture(t);
  const { file, reference } = stored(root, Buffer.from("ORIGINAL"));
  writeFileSync(file, "MUTATED!");            // same length: only the digest can catch it
  assert.throws(() => readResult(root, reference.reference), /result changed or its digest does not match/);
  writeFileSync(file, "ORIGINAL");
  assert.equal(readResult(root, reference.reference).text, "ORIGINAL");
});

test("006. Result pages still follow offsets, lines, base64 and range refusals", t => {
  const root = fixture(t);
  const content = Buffer.from(`alpha\nbeta\n${"x".repeat(RESULT_PAGE_BYTES)}\nomega\n`);
  const { reference } = stored(root, content);
  const full = readResult(root, reference.reference, { byteLimit: 4 });
  assert.equal(full.text, "alph");
  assert.equal(full.byteOffset, 0);
  assert.equal(full.next, 4);
  assert.equal(full.bytes, content.length);
  assert.equal(full.sha256, reference.sha256);
  const offset = readResult(root, reference.reference, { byteOffset: 6, byteLimit: 4 });
  assert.equal(offset.text, "beta");
  assert.equal(offset.next, 10);
  const base64 = readResult(root, reference.reference, { byteOffset: 6, byteLimit: 4, encoding: "base64" });
  assert.equal(base64.dataBase64, Buffer.from("beta").toString("base64"));
  const line = readResult(root, reference.reference, { line: 4, byteLimit: 5 });
  assert.equal(line.text, "omega");
  assert.equal(line.byteOffset, 11 + RESULT_PAGE_BYTES + 1);
  assert.equal(content.subarray(line.byteOffset, line.byteOffset + 6).toString(), "omega\n");
  assert.equal(line.next, line.byteOffset + 5, "the page ends before the line's own newline");
  const whole = readResult(root, reference.reference, { byteLimit: RESULT_PAGE_BYTES });
  assert.equal(whole.next, RESULT_PAGE_BYTES, "a short page must continue at its own end");
  assert.equal(whole.text.length, RESULT_PAGE_BYTES);
  assert.throws(() => readResult(root, reference.reference, { byteOffset: content.length + 1 }), /past the end/);
  assert.throws(() => readResult(root, reference.reference, { byteLimit: 3 }), /invalid result byte or line range/);
  assert.throws(() => readResult(root, reference.reference, { line: 1, byteOffset: 0 }), /invalid result byte or line range/);
  const wide = stored(root, Buffer.from("é"), OTHER_ID);
  assert.throws(() => readResult(root, wide.reference.reference, { byteOffset: 1, byteLimit: 4 }), /not a UTF-8 boundary/);
  assert.throws(() => readResult(root, "oma-result:not-a-reference"), /invalid result reference/);
});
