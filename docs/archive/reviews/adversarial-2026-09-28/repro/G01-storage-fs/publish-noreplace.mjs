import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishNoReplace, DurabilityFaultError } from "../../../../dist/src/storage/durable-fs.js";

const root = mkdtempSync(join(tmpdir(), "oma-adv-G01-storage-fs-"));
try {
  const target = join(root, "obj");
  console.log("first:", publishNoReplace(target, "AAAA"));
  console.log("bytes:", readFileSync(target, "utf8"));
  // second publish with DIFFERENT bytes must NOT overwrite -> "existing"
  console.log("second(diff):", publishNoReplace(target, "BBBB"));
  console.log("bytes after second:", readFileSync(target, "utf8"), "(must still be AAAA)");
  // no leftover temporaries
  console.log("dir entries after:", readdirSync(root));

  // fault: crash between file-write and fsync leaves temp; a later publish must collect it
  const t2 = join(root, "obj2");
  try {
    publishNoReplace(t2, "CCCC", 0o600, (f) => { if (f.point === "file-fsync" && f.phase === "ambiguous") { throw new DurabilityFaultError(f); } });
  } catch (e) { console.log("injected fault threw:", e?.constructor?.name ?? e); }
  console.log("entries after crash sim (may hold .obj2..tmp):", readdirSync(root).filter(n => n.includes("obj2")));
} finally {
  rmSync(root, { recursive: true, force: true });
}
