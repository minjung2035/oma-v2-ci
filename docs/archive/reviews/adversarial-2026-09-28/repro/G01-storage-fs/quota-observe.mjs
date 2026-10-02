import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, linkSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { observedStorageBytes, assertStorageQuotaAdmission } from "../../../../dist/src/storage/quota.js";

const root = mkdtempSync(join(tmpdir(), "oma-adv-G01-storage-fs-"));
try {
  // 1. hardlink dedup: two names, one inode -> counted once
  const dir = join(root, "tree");
  mkdirSync(dir);
  const a = join(dir, "a");
  writeFileSync(a, Buffer.alloc(4096, 1));
  linkSync(a, join(dir, "b")); // hardlink
  const bytesHard = observedStorageBytes(dir);
  console.log("hardlink two-names bytes:", bytesHard);

  // 2. symlink: not followed, counted as its own small size
  symlinkSync("/etc/passwd", join(dir, "link"));
  const bytesWithLink = observedStorageBytes(dir);
  console.log("with symlink bytes:", bytesWithLink, "delta:", bytesWithLink - bytesHard);

  // 3. absent root -> 0
  console.log("absent root:", observedStorageBytes(join(root, "nope")));

  // 4. unreadable directory -> unavailable, NOT 0 (INV02)
  const sealed = join(root, "sealed");
  mkdirSync(sealed);
  writeFileSync(join(sealed, "x"), Buffer.alloc(10));
  chmodSync(sealed, 0o000);
  try {
    const v = observedStorageBytes(sealed);
    console.log("SEALED-DIR RETURNED:", v, "(running as root? EACCES bypassed)");
  } catch (e) {
    console.log("sealed dir threw:", e.code ?? e.constructor.name, e.message);
  } finally { chmodSync(sealed, 0o755); }

  // 5. quota boundary values
  try { assertStorageQuotaAdmission(dir, 0); console.log("quota 0 admitted (BUG unless tree empty)"); }
  catch (e) { console.log("quota storageBytes=0:", e.code); }
  try { assertStorageQuotaAdmission(dir, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER); console.log("quota MAX/MAX admitted"); }
  catch (e) { console.log("quota MAX reserve=MAX:", e.code); }
  try { assertStorageQuotaAdmission(dir, 100, -1); console.log("quota negative reserve admitted (BUG)"); }
  catch (e) { console.log("quota negative reserve:", e.code); }
} finally {
  rmSync(root, { recursive: true, force: true });
}
