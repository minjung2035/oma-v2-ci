// Verifies: contained-files fd-based primitives refuse symlink escape,
// dir-symlink components, hardlink-to-outside writes, absolute/traversal/NUL.
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, linkSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const files = await import("../../../../dist/src/extension/contained-files.js");
const guard = await import("../../../../dist/src/extension/workspace-guard.js");

const base = mkdtempSync(join(tmpdir(), "oma-adv-G10-"));
const ws = join(base, "workspace");
const outside = join(base, "outside");
mkdirSync(ws); mkdirSync(outside);
writeFileSync(join(outside, "secret.txt"), "TOP SECRET\n");

const results = [];
function check(name, fn) {
  try { const v = fn(); results.push([name, "NO-REFUSAL", JSON.stringify(v)?.slice(0,60)]); }
  catch (e) { results.push([name, "refused", (e && e.name) + ": " + (e && e.message)?.slice(0,50)]); }
}

symlinkSync(join(outside, "secret.txt"), join(ws, "link.txt"));
check("readWithin symlink->outside", () => files.readWithin(ws, "link.txt").toString());

symlinkSync(outside, join(ws, "esc"));
check("readWithin dir-symlink esc/secret.txt", () => files.readWithin(ws, "esc/secret.txt").toString());
check("writeWithin dir-symlink esc/new.txt", () => { files.writeWithin(ws, "esc/new.txt", "x"); return "wrote"; });

try {
  linkSync(join(outside, "secret.txt"), join(ws, "hard.txt"));
  check("writeWithin hardlink(nlink>1)", () => { files.writeWithin(ws, "hard.txt", "OVERWRITTEN"); return "wrote"; });
  results.push(["outside-after-hardlink", "content", readFileSync(join(outside,"secret.txt"),"utf8").trim()]);
} catch (e) { results.push(["hardlink-setup", "skipped", String(e.message).slice(0,40)]); }

check("componentsWithin /etc/passwd", () => files.componentsWithin(ws, "/etc/passwd"));
check("componentsWithin ../outside", () => files.componentsWithin(ws, "../outside/secret.txt"));
check("componentsWithin NUL", () => files.componentsWithin(ws, "a\0b"));

results.push(["workspaceUsage(big)", "bytes", String(guard.workspaceUsage(ws, 10*1024*1024))]);

console.log(results.map(r => r.join(" | ")).join("\n"));
rmSync(base, { recursive: true, force: true });
