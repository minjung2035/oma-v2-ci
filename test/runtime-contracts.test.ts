import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolvedSpecOf } from "../src/authority.js";
import { resolvedSpec, ALL_CAPS } from "./fixtures/spec.js";
import { UnitsModule } from "../src/units.js";

test("LIFE-008: stored identity and frozen resources reject stale or mismatched records", () => {
  const agent = { name: "a", profile: "p", specJson: resolvedSpec(ALL_CAPS, "p", "a") };
  const spec = resolvedSpecOf(agent);
  assert.equal(spec.modelProfile, "md");
  assert.equal(spec.resources.tasks, 128);
  assert.throws(() => resolvedSpecOf({ ...agent, name: "b" }), /identity mismatch/);
  const { resources, ...stale } = spec;
  assert.throws(() => resolvedSpecOf({ ...agent, specJson: JSON.stringify(stale) }), /migration required/);
  assert.throws(() => resolvedSpecOf({ ...agent, specJson: JSON.stringify({ ...spec, resources: { ...resources, tasks: 0 } }) }), /unsupported/);
});

test("UNIT-007: unavailable unit observation is not proven cgroup death", () => {
  const society = `missing-${process.pid}`;
  const units = new UnitsModule(society, {
    node: process.execPath, libdir: "/nonexistent", state: "/nonexistent", society, agent: "a",
  });
  // Fault seam: failed systemctl calls return no usable properties.
  Reflect.set(units, "run", () => "");
  const observation = units.observe("a");
  assert.equal(observation.activeState, "unknown");
  assert.equal(observation.execMainStatus, -1);
  assert.equal(units.confirmDead("a", 0), false);
});

test("SEQ-002: stop attempts revocation then service termination despite earlier faults", () => {
  for (const fault of ["path", "revoke"]) {
    const units = new UnitsModule("probe", { node: process.execPath, libdir: "/unused", state: "/unused", society: "probe", agent: "a" });
    const steps: string[] = [];
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
    assert.throws(() => units.stop("a", 1), new RegExp(`${fault} failure`));
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
