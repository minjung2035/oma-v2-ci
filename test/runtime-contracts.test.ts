import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { resolvedSpecOf } from "@oma/domain/agent-spec";
import { resolvedSpecDigest } from "@oma/domain/spec-identity";
import { StoreError } from "@oma/domain/errors";
import { resolvedSpec, ALL_CAPS } from "./fixtures/spec.js";
import { UnitsModule } from "@oma/platform-linux/units";

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

test("UNIT-007: unavailable unit observation is not proven cgroup death", () => {
  const society = `missing-${process.pid}`;
  const units = new UnitsModule(society, {
    node: process.execPath, libdir: "/nonexistent", state: "/nonexistent", society, agent: "a", config: join("/nonexistent", "config.json"), run: join("/nonexistent", "oma", society)
  });
  // Fault seam: the unit command boundary reports an unavailable observation.
  // Observation uses the command boundary, not the effect `run` helper.
  Reflect.set(units, "command", () => ({ kind: "unknown", stdout: "", stderr: "", status: null, signal: null }));
  const observation = units.observe("a");
  assert.equal(observation.activeState, "unknown");
  assert.equal(observation.execMainStatus, -1);
  assert.equal(units.confirmDead("a", 0), false);
});

test("SEQ-002: stop attempts revocation then service termination despite earlier faults", () => {
  for (const fault of ["path", "revoke"]) {
    const units = new UnitsModule("probe", { node: process.execPath, libdir: "/unused", state: "/unused", society: "probe", agent: "a", config: join("/unused", "config.json"), run: join("/unused", "oma", "probe") });
    const steps: string[] = [];
    // Unit existence/observation goes through the command boundary; effects go
    // through `run`. Both are controlled so the ordering oracle is the subject.
    Reflect.set(units, "command", (argv: string[]) => {
      if (argv[0] === "show" && argv.includes("--property=LoadState"))
        return { kind: "succeeded", stdout: "loaded\n", stderr: "", status: 0, signal: null };
      return { kind: "succeeded", stderr: "", status: 0, signal: null,
        stdout: "ActiveState=inactive\nSubState=dead\nResult=success\nExecMainStatus=0\nControlGroup=\nInvocationID=\n" };
    });
    Reflect.set(units, "run", (argv: string[]) => {
      steps.push(argv.join(" "));
      if (fault === "path" && argv[0] === "stop" && argv[1]?.endsWith(".path")) throw new Error("path failure");
      if (argv.includes("--property=ActiveState")) return "inactive";
      if (argv.includes("--property=UnitFileState")) return "disabled";
      return "ActiveState=inactive\nSubState=dead\nResult=success\nExecMainStatus=0\nControlGroup=";
    });
    units.onRevokeRun = () => {
      steps.push("revoke");
      if (fault === "revoke") throw new Error("revoke failure");
    };
    // A failed step must not stop the remaining revoke/stop/death-check actions.
    // The surfaced failure is the closed RUN_TERMINATION_UNKNOWN outcome; the
    // ordering below is what this oracle pins.
    assert.throws(() => units.stop("a", 1),
      (error: unknown) => error instanceof StoreError && error.code === "RUN_TERMINATION_UNKNOWN");
    assert.ok(steps.indexOf("disable oma-probe-a.path") < steps.indexOf("revoke"));
    assert.ok(steps.indexOf("revoke") < steps.indexOf("stop oma-probe-a.service"));
  }
});

test("LOC-008: pinned cloc counts code, comments, strings and duplicate sources", () => {
  assert.equal(execFileSync("cloc", ["--version"], { encoding: "utf8" }).trim(), "2.08");
  const out = execFileSync("cloc", ["--list-file=files.txt", "--by-file", "--skip-uniqueness",
    "--read-lang-def=../../cloc-systemd.lang", "--json", "--quiet"], {
    cwd: "implementation/tests/loc-fixtures", encoding: "utf8",
  });
  assert.equal(JSON.parse(out).SUM.code, 7);
});
