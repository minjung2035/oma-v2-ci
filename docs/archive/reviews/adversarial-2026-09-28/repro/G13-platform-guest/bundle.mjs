// Probes project.ts pure helpers: bundleObjectFormat header window and the
// BRANCH regex against injection / traversal-ish names.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mod = await import("../../../../dist/src/platform/guest/project.js");
const { bundleObjectFormat } = mod;

const dir = mkdtempSync(join(tmpdir(), "oma-adv-G13-bundle-"));
try {
  // A v3 bundle whose @object-format line sits BEYOND the 4096-byte window.
  const pad = "# padding ref line ".padEnd(200, "x") + "\n";
  let header = "# v3 git bundle\n";
  while (header.length < 4100) header += pad;
  header += "@object-format=sha256\n\n";
  const p = join(dir, "far.bundle");
  writeFileSync(p, header);
  let got;
  try { got = bundleObjectFormat(p); } catch (e) { got = "throw:" + e.message; }
  console.log("1) @object-format beyond 4096 bytes read as:", got,
    got === "sha1" ? "<-- MISREAD (declared sha256)" : "");

  const q = join(dir, "near.bundle");
  writeFileSync(q, "# v3 git bundle\n@object-format=sha256\n\n");
  console.log("2) @object-format within window:", bundleObjectFormat(q));

  const r = join(dir, "not.bundle");
  writeFileSync(r, "not a bundle at all\n");
  try { bundleObjectFormat(r); console.log("3) non-bundle: PROBLEM accepted"); }
  catch (e) { console.log("3) non-bundle rejected:", e.message); }
} finally { rmSync(dir, { recursive: true, force: true }); }

const BRANCH = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!\/)[A-Za-z0-9._/-]{1,200}(?<!\/)(?<!\.lock)$/;
for (const b of ["main", "../evil", "a/../b", "-x", "/abs", "a//b", "refs/heads/x", "x.lock", "a b", "a;rm -rf", "a\n b"])
  console.log("BRANCH", JSON.stringify(b), "=>", BRANCH.test(b));
