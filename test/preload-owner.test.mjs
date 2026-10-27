import { residentEngineEffects } from "#oma-test/app/engine/resident-effects";
/** Deployment composition: the extension does not own the client's process preload. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { planPiSpawn } from "@oma/engine/pi-spawn-plan";
import { residentOptions } from "../dist/test/fixtures/resident.js";

test("DR46: a Resident preloads the actual installation client owner independently of the extension directory", t => {
  const state = mkdtempSync(join(tmpdir(), "oma-preload-owner-"));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  const libdir = process.cwd(), preload = "apps/oma/dist/runtime/client-preload.js";
  assert.ok(existsSync(join(libdir, preload)), "the asserted preload is a real built installation asset");
  const plan = planPiSpawn(residentEngineEffects.sandbox, residentOptions(state, libdir));
  const at = plan.args.lastIndexOf("NODE_OPTIONS");
  assert.equal(plan.args[at - 1], "--setenv");
  assert.equal(plan.args[at + 1], `--import=${pathToFileURL(join("/opt/oma", preload)).href}`);
});
