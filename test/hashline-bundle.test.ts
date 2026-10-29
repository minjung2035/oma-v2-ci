/** Bundled pi-hashline-edit-pro: the vendored payload is
 * verified byte-for-byte before any vendored module evaluates; the adapter
 * registers the anchored read and three mutations;
 * reads are admitted through the same boundary the workspace guard applies
 * and writes reach the filesystem only through OMA's shared contained
 * writer — serialization, and the read snapshot's
 * inode-identity check included. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const BUNDLE_SOURCE = fileURLToPath(new URL("../../packages/tool-hashline/dist/vendor/pi-hashline-edit-pro/", import.meta.url));
test("BL3/F5: the bundle check refuses a manifest whose metadata drifted from the declared pins", async () => {
    const specifier = "../../scripts/vendor-pi-hashline.mjs";
    const { manifestMetadataProblems } = await import(specifier) as {
        manifestMetadataProblems: (manifest: {
            generated?: {
                divergences?: unknown;
                dependencies?: unknown;
            };
            package?: unknown;
        }) => string[];
    };
    const manifest = JSON.parse(readFileSync(join(BUNDLE_SOURCE, "manifest.json"), "utf8"));
    assert.deepEqual(manifestMetadataProblems(manifest), [], "the checked-in manifest matches its declared metadata");
    const driftedReason = structuredClone(manifest);
    driftedReason.generated.divergences["commit.js"].reason = "something other than the declared reason";
    assert.match(manifestMetadataProblems(driftedReason).join("\n"), /divergences/, "a divergence-reason edit is caught");
    const droppedDivergence = structuredClone(manifest);
    delete droppedDivergence.generated.divergences["fs-write.js"];
    assert.match(manifestMetadataProblems(droppedDivergence).join("\n"), /divergences/, "a dropped divergence record is caught");
    const driftedCommit = structuredClone(manifest);
    driftedCommit.package.commit = "0".repeat(40);
    assert.match(manifestMetadataProblems(driftedCommit).join("\n"), /package|pinned/, "a commit drift is caught");
    const driftedDep = structuredClone(manifest);
    driftedDep.generated.dependencies["diff"].version = "0.0.0";
    assert.match(manifestMetadataProblems(driftedDep).join("\n"), /dependenc/, "a dependency pin drift is caught");
});
