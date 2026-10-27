/** These run the actual host's POSIX oracle. Linux results cannot become a
 * Darwin observation, and parser mutations below are data, not kernel facts. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { validateDescriptorCapabilityObservation } from "../scripts/descriptor-capability-observation.mjs";
import { validateDarwinObservation } from "../scripts/darwin-cases.mjs";
import { assertActualDescriptorOracle } from "./helpers/descriptor-oracle-assertions.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const work = mkdtempSync(join(tmpdir(), "oma-descriptor-oracle-"));
let observed;
try {
  const source = join(root, "test/fixtures/descriptor-capabilities-oracle.c"), binary = join(work, "oracle");
  const command = process.platform === "darwin" ? "/usr/bin/xcrun" : "/usr/bin/cc";
  const args = [...(process.platform === "darwin" ? ["clang"] : []), "-Wall", "-Wextra", "-Werror", source, "-o", binary];
  const compiled = spawnSync(command, args, { encoding: "utf8", timeout: 30000 });
  assert.equal(compiled.error, undefined); assert.equal(compiled.signal, null); assert.equal(compiled.status, 0, compiled.stderr);
  const executed = spawnSync(binary, [], { cwd: work, encoding: "utf8", timeout: 30000 });
  assert.equal(executed.error, undefined); assert.equal(executed.signal, null); assert.equal(executed.status, 0, executed.stderr);
  observed = JSON.parse(executed.stdout);
} finally { rmSync(work, { recursive: true, force: true }); }

test("descriptor oracle: actual kernel identity, cursor positions and exec markers are distinct observations", t => {
  assert.equal(observed.case, "descriptor-oracle-controls");
  const value = observed.fileDescriptors;
  t.diagnostic(JSON.stringify({ oracle: "descriptor-capabilities", observed: value }));
  assertActualDescriptorOracle(value);
  if (process.platform === "linux") {
    assert.throws(() => validateDarwinObservation("file-descriptors", { fileDescriptors: value }), /did not run on Darwin/);
  } else {
    assert.doesNotThrow(() => validateDarwinObservation("file-descriptors", { fileDescriptors: value }));
  }
});

for (const [name, change] of [
  ["missing cursor", row => { delete row.devFd.sourceAfter; }],
  ["missing inode", row => { delete row.devFd.sameInode; }],
  ["open-only success", row => { row.devFd = { attempted: true, openReturn: 4, openErrno: 0 }; }],
  ["boolean cursor", row => { row.devFd.sourceBefore = true; }],
  ["negative cursor", row => { row.devFd.duplicateBefore = -1; }],
  ["NaN errno", row => { row.devFd.openErrno = NaN; }],
  ["failed open with success facts", row => { row.devFd.openReturn = -1; row.devFd.openErrno = 13; }],
  ["unattempted open with facts", row => { row.devFd.attempted = false; }],
  ["missing namespace observation", row => { delete row.namespace.heldAfterUnlink; }],
  ["string namespace verdict", row => { row.namespace.heldAfterSwap = "true"; }],
  ["exit zero without original marker", row => { row.exec.direct.reply = "none"; }],
  ["replacement mistaken for original", row => { row.exec.direct = structuredClone(row.exec.namedAfterSwap); }],
  ["missing replacement negative control", row => { delete row.exec.namedAfterSwap; }],
  ["original mistaken for replacement", row => { row.exec.namedAfterSwap = structuredClone(row.exec.direct); }],
  ["invented exec errno", row => { row.exec.fdAfterSwap.execErrno = 13; row.exec.fdAfterSwap.reply = "original"; }],
  ["no actual child termination", row => { row.exec.fdAfterUnlink.exitCode = null; row.exec.fdAfterUnlink.signal = null; }],
  ["exit and signal at once", row => { row.exec.direct.signal = 9; }],
  ["missing fileport attempt", row => { delete row.fileport.duplicate.attempted; }],
  ["unavailable fileport with result", row => { row.fileport.available = false; row.fileport.makeportReturn = 0; }],
  ["unknown fileport return", row => { row.fileport.available = true; row.fileport.makeportReturn = 1; row.fileport.makeportErrno = 0; }],
  ["failed fileport without errno", row => { row.fileport.available = true; row.fileport.makeportReturn = -1; row.fileport.makeportErrno = 0; }],
  ["extra support claim", row => { row.supported = true; }],
  ["NUL-joined extra fields", row => { row["exec\0fileport"] = row.exec; delete row.exec; delete row.fileport; }],
]) test(`descriptor evidence grammar refuses ${name}`, () => {
  const row = structuredClone(observed.fileDescriptors); change(row);
  assert.throws(() => validateDescriptorCapabilityObservation(row));
});
