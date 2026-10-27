/** AV5 -- FS-005 as architecture section 4 states it: a change under the state
 * tree acts through a parent resolved once.
 *
 * The transport spool is written, read back and removed after its staging
 * directory was resolved at construction. Replacing that directory's path
 * afterwards -- a process of the same user renaming it and leaving a decoy of
 * the same name -- moves nothing the spool does: it reads the bytes it hashed
 * and removes its own file, and the decoy is neither read nor removed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TransportSpool } from "@oma/storage/transport-spool";

test("AV5 / FS-005: a spool whose staging path is replaced after sealing reads and removes only its own file", async () => {
  const root = mkdtempSync(join(tmpdir(), "oma-av5-"));
  try {
    const staging = join(root, "staging");
    const bytes = Buffer.from("the bundle bytes that were hashed");
    const spool = new TransportSpool(staging, { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    const name = spool.path.slice(staging.length + 1);
    spool.append(bytes); spool.seal();
    // The staging directory is moved away and a decoy put where its path was.
    renameSync(staging, join(root, "moved"));
    mkdirSync(staging); writeFileSync(join(staging, name), "a decoy of the same name");
    const body = spool.handoff();
    const read: Buffer[] = [];
    for await (const chunk of body.chunks) read.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(read), bytes, "the spool read something other than what it hashed");
    body.release();
    assert.equal(readFileSync(join(staging, name), "utf8"), "a decoy of the same name", "the spool removed the decoy");
    assert.deepEqual(readdirSync(join(root, "moved")), [], "the spool left its own file behind");
    assert.ok(existsSync(join(staging, name)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
