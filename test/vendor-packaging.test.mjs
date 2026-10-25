import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NPM_METADATA_PACKAGING, preserveNpmMetadata, vendorPackagingProblems } from "../scripts/vendor-bundle-lib.mjs";
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "oma-vendor-packaging-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "node_modules/isexe"), { recursive: true });
  return root;
}
test("DR46: npm-omitted metadata keeps its original bytes and declared provenance", t => {
  const root = fixture(t), entry = NPM_METADATA_PACKAGING[0];
  const bytes = Buffer.from(".nyc_output/\ncoverage/\n");
  // Exact original tarball metadata bytes, independent of the rename helper.
  assert.equal(bytes.length, 23);
  writeFileSync(join(root, entry.upstreamPath), bytes);
  preserveNpmMetadata(root);
  assert.deepEqual(readFileSync(join(root, entry.storedPath)), bytes);
  assert.equal(existsSync(join(root, entry.upstreamPath)), false);
  const manifest = { generated: { packaging: NPM_METADATA_PACKAGING } };
  assert.deepEqual(vendorPackagingProblems(manifest, root), []);
  preserveNpmMetadata(root);
  assert.notDeepEqual(vendorPackagingProblems({ generated: { packaging: [] } }, root), []);
  writeFileSync(join(root, entry.storedPath), "changed");
  assert.notDeepEqual(vendorPackagingProblems(manifest, root), []);
});
test("DR46: metadata preservation refuses unexpected bytes and occupied destinations without overwriting either", t => {
  const root = fixture(t), entry = NPM_METADATA_PACKAGING[0];
  writeFileSync(join(root, entry.upstreamPath), "unexpected");
  writeFileSync(join(root, entry.storedPath), "occupied");
  assert.throws(() => preserveNpmMetadata(root));
  assert.equal(readFileSync(join(root, entry.upstreamPath), "utf8"), "unexpected");
  assert.equal(readFileSync(join(root, entry.storedPath), "utf8"), "occupied");
});
