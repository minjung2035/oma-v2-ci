import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolvedSpecOf } from "@oma/domain/agent-spec";
import { resolvedSpecDigest } from "@oma/domain/spec-identity";
import { resolvedSpec, ALL_CAPS } from "./fixtures/spec.js";

test("LIFE-008: stored identity and frozen model references reject stale or mismatched records", () => {
  const specJson = resolvedSpec(ALL_CAPS, "p", "a");
  const agent = { name: "a", profile: "p", specJson, specHash: resolvedSpecDigest(JSON.parse(specJson)) };
  const spec = resolvedSpecOf(agent);
  // P0V-91 (R6-14): the digest is always checked; a row whose spec is not the one it was accepted with is corrupt.
  assert.throws(() => resolvedSpecOf({ ...agent, specHash: "0".repeat(64) }), /identity mismatch/);
  assert.equal(spec.modelProfile, "md");
  assert.throws(() => resolvedSpecOf({ ...agent, specJson: JSON.stringify({ ...spec, modelProfile: "other" }) }), /identity mismatch/);
  assert.throws(() => resolvedSpecOf({ ...agent, name: "b" }), /identity mismatch/);
});

// Retired manager-specific oracles remain in the raw archive. Current stop
// ordering is in process/resident-supervisor; actual death/unknown and pinned
// scope replacement are in native-process-scope/native-resident-runtime.

test("LOC-008: pinned cloc counts code, comments, strings and duplicate sources", () => {
  assert.equal(execFileSync("cloc", ["--version"], { encoding: "utf8" }).trim(), "2.08");
  const out = execFileSync("cloc", ["--list-file=files.txt", "--by-file", "--skip-uniqueness",
    "--read-lang-def=../../cloc-systemd.lang", "--json", "--quiet"], {
    cwd: "implementation/tests/loc-fixtures", encoding: "utf8",
  });
  assert.equal(JSON.parse(out).SUM.code, 7);
});
