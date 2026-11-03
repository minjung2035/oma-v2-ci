/** Bundled pi-web-access: the vendored payload is verified
 * byte-for-byte before tools register; the adapter drives upstream's own
 * extension factory through a facade that admits exactly the four
 * web research tools; the Society web policy keeps every ambient-
 * discovery escape closed; and the egress pin is the only proxy value the
 * vendored code may carry. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const SRC_BUNDLE = fileURLToPath(new URL("../../packages/tool-web/src/vendor/pi-web-access/", import.meta.url));
// ---------------------------------------------------------------------------
// Manifest metadata
test("001. Manifest metadata binds the pinned identity, dependency closure and divergence table", async () => {
    const specifier = "../../scripts/vendor-pi-web-access.mjs";
    const { manifestMetadataProblems } = await import(specifier) as {
        manifestMetadataProblems: (manifest: {
            generated?: {
                divergences?: unknown;
                dependencies?: unknown;
            };
            package?: unknown;
        }) => string[];
    };
    const manifest = JSON.parse(readFileSync(join(SRC_BUNDLE, "manifest.json"), "utf8"));
    assert.deepEqual(manifestMetadataProblems(manifest), [], "the checked-in manifest matches its declared metadata");
    const driftedReason = JSON.parse(JSON.stringify(manifest));
    driftedReason.generated.divergences["utils.js"].reason = "hand-edited";
    assert.match(manifestMetadataProblems(driftedReason).join("\n"), /divergences/);
    const droppedDivergence = JSON.parse(JSON.stringify(manifest));
    delete droppedDivergence.generated.divergences["utils.js"];
    assert.match(manifestMetadataProblems(droppedDivergence).join("\n"), /divergences/);
    const driftedCommit = JSON.parse(JSON.stringify(manifest));
    driftedCommit.package.commit = "0".repeat(40);
    assert.match(manifestMetadataProblems(driftedCommit).join("\n"), /package|pinned/);
    const driftedNpm = JSON.parse(JSON.stringify(manifest));
    driftedNpm.package.npm.integrity = "sha512-" + "A".repeat(86);
    assert.match(manifestMetadataProblems(driftedNpm).join("\n"), /package|pinned/);
    const driftedDep = JSON.parse(JSON.stringify(manifest));
    driftedDep.generated.dependencies["undici"].version = "0.0.0";
    assert.match(manifestMetadataProblems(driftedDep).join("\n"), /dependencies|dependency/);
});
