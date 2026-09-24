import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { resolvedSpecOf } from "../src/authority.js";
import { StoreError } from "../src/domain/errors.js";
import { resolvedSpec, ALL_CAPS } from "./fixtures/spec.js";
import { UnitsModule } from "../src/units.js";

test("LIFE-008: stored identity and frozen resources reject stale or mismatched records", () => {
  const agent = { name: "a", profile: "p", specJson: resolvedSpec(ALL_CAPS, "p", "a") };
  const spec = resolvedSpecOf(agent);
  assert.equal(spec.modelProfile, "md");
  assert.equal(spec.resources.tasks, 128);
  assert.throws(() => resolvedSpecOf({ ...agent, name: "b" }), /identity mismatch/);
  // A stored spec that predates the frozen resource block is corrupt durable
  // state, not a record to silently upgrade (MAINTENANCE §6, §13).
  const { resources, ...stale } = spec;
  assert.throws(() => resolvedSpecOf({ ...agent, specJson: JSON.stringify(stale) }),
    (error: unknown) => error instanceof StoreError && error.code === "STORE_CORRUPT");
  assert.throws(() => resolvedSpecOf({ ...agent, specJson: JSON.stringify({ ...spec, resources: { ...resources, tasks: 0 } }) }),
    (error: unknown) => error instanceof StoreError && error.code === "STORE_CORRUPT");
});

test("UNIT-007: unavailable unit observation is not proven cgroup death", () => {
  const society = `missing-${process.pid}`;
  const units = new UnitsModule(society, {
    node: process.execPath, libdir: "/nonexistent", state: "/nonexistent", society, agent: "a", config: join("/nonexistent", "config.json"), run: join("/nonexistent", "oma", society), brokerUnit: ""
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
    const units = new UnitsModule("probe", { node: process.execPath, libdir: "/unused", state: "/unused", society: "probe", agent: "a", config: join("/unused", "config.json"), run: join("/unused", "oma", "probe"), brokerUnit: "" });
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
