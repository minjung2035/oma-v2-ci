// Adversarial repro for src/platform/host/archive-crypto.ts
// Confirms AEAD rejects tampered ciphertext/tag/header/length and truncation,
// and that a fabricated "last" chunk cannot be decrypted to plaintext.
import { encryptArchive, decryptArchive } from "../../../../dist/src/platform/host/archive-crypto.js";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const dir = mkdtempSync(join(tmpdir(), "oma-adv-G12-crypto-"));
const key = randomBytes(32);
let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log("PASS", name); } else { fail++; console.log("FAIL", name); } };

try {
  // Multi-chunk plaintext (>64KiB so there are >=2 chunks).
  const plain = join(dir, "plain.bin");
  const data = randomBytes(200 * 1024);
  writeFileSync(plain, data);
  const enc = join(dir, "a.enc");
  encryptArchive(plain, enc, key);

  // Round-trips cleanly.
  const dec0 = join(dir, "dec0.bin");
  decryptArchive(enc, dec0, key);
  ok("roundtrip", Buffer.compare(readFileSync(dec0), data) === 0);

  const bytes = readFileSync(enc);

  const tamperTest = (name, mutate) => {
    const b = Buffer.from(bytes);
    mutate(b);
    const bad = join(dir, `${name}.enc`);
    writeFileSync(bad, b);
    const out = join(dir, `${name}.out`);
    if (existsSync(out)) rmSync(out);
    let threw = false, leaked = false;
    try { decryptArchive(bad, out, key); }
    catch { threw = true; }
    if (!threw && existsSync(out)) {
      const got = readFileSync(out);
      leaked = Buffer.compare(got, data) === 0 || got.length > 0;
    }
    ok(name, threw && !leaked);
  };

  // Flip one ciphertext byte (after magic(8)+fileId(8)+len(4) = offset 20).
  tamperTest("flip-ciphertext", b => { b[20] ^= 0xff; });
  // Flip a tag byte: tag is last 16 bytes of first chunk. First chunk body = 64KiB.
  tamperTest("flip-tag", b => { const off = 8 + 8 + 4 + 64 * 1024; b[off] ^= 0xff; });
  // Corrupt the magic header.
  tamperTest("bad-magic", b => { b[0] ^= 0xff; });
  // Forge the length field of the first chunk (claim larger).
  tamperTest("forge-length-large", b => { b.writeUInt32BE(0xffffffff, 16); });
  // Truncate after the first full chunk so decrypt sees it as "last".
  {
    const firstEnd = 8 + 8 + 4 + 64 * 1024 + 16;
    const b = bytes.subarray(0, firstEnd);
    const bad = join(dir, "trunc.enc");
    writeFileSync(bad, b);
    const out = join(dir, "trunc.out");
    let threw = false, leaked = false;
    try { decryptArchive(bad, out, key); } catch { threw = true; }
    if (!threw && existsSync(out)) leaked = readFileSync(out).length > 0;
    ok("truncate-to-fake-last", threw && !leaked);
  }
  // Swap fileId (nonce) — should fail tag.
  tamperTest("flip-fileid", b => { b[8] ^= 0xff; });
} finally {
  rmSync(dir, { recursive: true, force: true });
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}
