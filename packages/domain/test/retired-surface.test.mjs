/** DR72: no executable v2 generator/catalog survives in the installed domain.
 * Historical strings are fixture data; they never pass through a v2 builder. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { collaborationProfilePrompt } from "../dist/collaboration-prompts.js";
import { collaborationSurface, requireCollaborationSurface } from "../dist/collaboration-surface.js";

test("001. Domain package has no retired builder export or installed module artifacts", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(Object.hasOwn(manifest.exports, "./tool-surface"), false);
  for (const suffix of [".js", ".d.ts", ".js.map", ".d.ts.map"])
    assert.equal(existsSync(new URL(`../dist/tool-surface${suffix}`, import.meta.url)), false, suffix);
});

for (const role of ["principal", "resident"]) test(`002. Retired surface: ${role}: closed current catalog and profile refusal need no legacy builder`, () => {
  assert.deepEqual(requireCollaborationSurface(JSON.stringify(collaborationSurface(role)), role), collaborationSurface(role));
  for (const raw of [undefined, JSON.stringify({ version: 2, defaultMode: "DISABLED", direct: ["oma_mail_send"], optional: ["ls"], disabled: [] })])
    assert.throws(() => requireCollaborationSurface(raw, role), { code: "UNSUPPORTED_PROFILE" });
  for (const name of ["toolset", "oma_mail_send", "oma_agent_control", "oma_context_publish", "oma_review_respond"])
    assert.throws(() => collaborationProfilePrompt(role, `Use ${name} to complete the task.`), { code: "UNSUPPORTED_PROFILE" });
  const authored = "Read the project guidance, preserve existing work, and verify actual outcomes.";
  assert.equal(collaborationProfilePrompt(role, authored), authored);
  const otherRoleTool = role === "principal" ? "oma_spawn" : "oma_goal";
  assert.throws(() => collaborationProfilePrompt(role, `Call ${otherRoleTool}.`), { code: "UNSUPPORTED_PROFILE" });
});
