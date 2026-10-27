// Repro for the archive publication gap (archive-crypto.ts + service.ts §archive):
// encryptArchive writes directly to the FINAL path with O_EXCL (no temp+rename).
// service.ts guards re-encryption with `if (!existsSync(target))`. So a crash
// mid-encryption leaves a partial .omaarchive at the final path; a same-key
// retry sees existsSync=true, skips encryption, and returns success pointing at
// an incomplete, un-decryptable archive.
import { encryptArchive, decryptArchive } from "../../../../dist/src/platform/host/archive-crypto.js";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, truncateSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const dir = mkdtempSync(join(tmpdir(), "oma-adv-G12-arch-"));
const key = randomBytes(32);
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log("PASS", name); } else { fail++; console.log("FAIL", name); } };

try {
  const plain = join(dir, "plain.tar");
  writeFileSync(plain, randomBytes(200 * 1024));

  // Simulate a crash mid-encrypt: encryptArchive writes to the final path, then
  // SIGKILL leaves a partial file there (emulated by truncating a complete one).
  const target = join(dir, "society-def456.omaarchive");
  encryptArchive(plain, target, key);
  const full = readFileSync(target).length;
  truncateSync(target, Math.floor(full / 2));   // the "crash" leaves a partial file

  // The service guard: `if (!existsSync(target)) encryptArchive(...)`.
  const wouldReEncrypt = !existsSync(target);
  ok("partial file exists at final path", existsSync(target));
  ok("service guard SKIPS re-encryption (bug)", wouldReEncrypt === false);

  // The archive service returns { path: target } as success, but the file is
  // not a decryptable archive.
  const out = join(dir, "restore.tar");
  let decErr = null;
  try { decryptArchive(target, out, key); } catch (e) { decErr = e; }
  ok("partial archive fails to decrypt (yet reported as success)", decErr !== null);
  console.log("   -> incomplete artifact promoted to a completed archive (P0-5 / P0-4).");
} finally {
  rmSync(dir, { recursive: true, force: true });
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}
