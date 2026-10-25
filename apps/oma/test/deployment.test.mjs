import test from "node:test";
import assert from "node:assert/strict";
import { runtimeAssets } from "../dist/runtime/assets.js";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
test("App owns every executable entry in the deployment", () => {
 for (const entry of Object.values(runtimeAssets("/install").entries)) assert.ok(entry.startsWith("/install/apps/oma/dist/entry/"));
 assert.equal(DEPLOYMENT_LAYOUT.workspaces.filter(w => w.name === "@oma/app").length, 1);
});
