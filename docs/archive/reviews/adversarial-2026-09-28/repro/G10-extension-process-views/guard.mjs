// Exercises the guardWorkspaceTools tool_call hook (the only gate for grep/find,
// which contained-tools does NOT re-register). Confirms whether a pre-existing
// dir-symlink start path is refused, and shows the check is path-based.
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const guard = await import("../../../../dist/src/extension/workspace-guard.js");

const base = mkdtempSync(join(tmpdir(), "oma-adv-G10-"));
const ws = join(base, "workspace");
const outside = join(base, "outside");
mkdirSync(ws); mkdirSync(outside);
writeFileSync(join(outside, "secret.txt"), "SECRET\n");
symlinkSync(outside, join(ws, "esc")); // pre-existing dir symlink inside ws

let hook;
guard.guardWorkspaceTools({ on: (_n, fn) => { hook = fn; } }, ws, 1024 * 1024, false);

const out = [];
function call(tool, input) {
  const r = hook({ toolName: tool, input });
  out.push([tool, JSON.stringify(input), r ? ("BLOCK: " + r.reason) : "ALLOWED"]);
}
call("grep", { path: "esc" });               // start path is a symlink dir
call("grep", { path: "esc/secret.txt" });    // through the symlink
call("find", { path: "esc" });
call("read", { path: "esc/secret.txt" });
call("grep", { path: "." });                 // legit
call("bash", { command: "id" });             // shell refused on host
call("grep", { path: "../outside" });        // traversal
console.log(out.map(r => r.join(" | ")).join("\n"));
rmSync(base, { recursive: true, force: true });
