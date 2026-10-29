/** Bundled pi-lsp: the vendored payload is verified
 * byte-for-byte before tools register; the adapter pins OMA's workspace
 * root, keeps upstream's per-call process lifecycle, reports a missing
 * server as unavailable rather than clean, and lets `lsp_fix` reach the
 * filesystem only through OMA's contained writer. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// ---------------------------------------------------------------------------
// F5: --check verifies the manifest's own metadata, not just file bytes.
test("BL1/F5: the bundle check refuses a manifest whose metadata drifted from the declared pins", async () => {
    // File bytes and the bundle digest were always compared; round 2 adds the
    // manifest's own words: generated.divergences against the script's
    // OMA_DIVERGENCES and package.* against the pinned upstream identity.
    const specifier = "../../scripts/vendor-pi-lsp.mjs";
    const { manifestMetadataProblems } = await import(specifier) as {
        manifestMetadataProblems: (manifest: {
            generated?: {
                divergences?: unknown;
            };
            package?: unknown;
        }) => string[];
    };
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../../packages/tool-lsp/dist/vendor/pi-lsp/manifest.json", import.meta.url)), "utf8"));
    assert.deepEqual(manifestMetadataProblems(manifest), [], "the checked-in manifest matches its declared metadata");
    const driftedReason = structuredClone(manifest);
    driftedReason.generated.divergences["runner.js"].reason = "something other than the declared reason";
    assert.match(manifestMetadataProblems(driftedReason).join("\n"), /divergences/, "a divergence-reason edit is caught");
    const droppedDivergence = structuredClone(manifest);
    delete droppedDivergence.generated.divergences["files.js"];
    assert.match(manifestMetadataProblems(droppedDivergence).join("\n"), /divergences/, "a dropped divergence record is caught");
    const driftedCommit = structuredClone(manifest);
    driftedCommit.package.commit = "0".repeat(40);
    assert.match(manifestMetadataProblems(driftedCommit).join("\n"), /package|pinned/, "a commit drift is caught");
    const driftedNpm = structuredClone(manifest);
    driftedNpm.package.npm.integrity = "sha512-forged";
    assert.match(manifestMetadataProblems(driftedNpm).join("\n"), /package|pinned/, "an npm integrity drift is caught");
});
