import test from "node:test";
import assert from "node:assert/strict";
import { StoreError } from "@oma/domain/errors";
import { renderUnit } from "@oma/platform-linux/units/render";
import { UNIT_COMMAND_LIMITS } from "@oma/platform-linux/units/execute";
import { parseProperties, parseUnitObservation, parseCgroupProcs } from "@oma/platform-linux/units/observe";
import { parseCgroupPopulation } from "@oma/domain/cgroup-population";
import { UnitsModule, unitsInstallDir } from "@oma/platform-linux/units";
const values = { node: "/usr/bin/node", libdir: "/opt/oma", state: "/var/oma", society: "sample", agent: "worker" };
const properties = "ActiveState=inactive\nSubState=dead\nResult=success\nExecMainStatus=0\nControlGroup=\nInvocationID=0123456789abcdef0123456789abcdef\n";
const command = (stdout) => ({ kind: "succeeded", stdout, stderr: "", status: 0, signal: null });
test("R26: pure renderer requires explicit accepted profile/model reference and preserves escaping", () => {
    assert.throws(() => renderUnit("MemoryMax=@MEMORY_BYTES@", values));
    assert.throws(() => renderUnit("@PROFILE_HEX@", values));
    assert.equal(renderUnit("@MODEL_PROFILE_HEX@", { ...values, modelProfileHex: "6d64" }), "6d64");
    assert.equal(renderUnit("@NODE@", { ...values, node: "/a b/$c%" }), "/a\\x20b/$$c%%");
    assert.throws(() => renderUnit("@NODE@", { ...values, node: "bad\nnode" }));
    assert.throws(() => renderUnit("@MODEL_PROFILE_HEX@", { ...values, modelProfileHex: "zz" }));
});
test("R26: parser splits at first equals and rejects missing/duplicate/malformed properties", () => {
    assert.equal(parseProperties("Key=a=b\n", ["Key"])?.get("Key"), "a=b");
    assert.equal(parseUnitObservation(command(properties)).activeState, "inactive");
    for (const invalid of [properties.replace("Result=success\n", ""), properties + "ActiveState=active\n", properties.replace("ExecMainStatus=0", "ExecMainStatus=-1"), properties.replace("ControlGroup=", "ControlGroup=/../escape")])
        assert.equal(parseUnitObservation(command(invalid)).activeState, "unknown");
    assert.equal(parseUnitObservation({ ...command(properties), kind: "unknown" }).activeState, "unknown");
});
test("R26: cgroup evidence distinguishes empty, populated and malformed bytes", () => {
    assert.equal(parseCgroupPopulation("populated 0\nfrozen 0\n"), "empty");
    assert.equal(parseCgroupPopulation("populated 1\n"), "populated");
    for (const invalid of ["", "populated 0\npopulated 1\n", "populated 2\n", "populated 0 garbage\n"])
        assert.equal(parseCgroupPopulation(invalid), "unknown");
    assert.deepEqual(parseCgroupProcs(""), []);
    assert.deepEqual(parseCgroupProcs("12\n34\n"), [12, 34]);
    assert.equal(parseCgroupProcs("0\n"), null);
    assert.equal(parseCgroupProcs("12oops\n"), null);
});
test("R26: authoritative reader replaces custom reader; future/unknown observations fail closed", () => {
    const units = new UnitsModule("sample", values, "/unused", () => 99);
    units.observe = () => parseUnitObservation(command(properties));
    units.bindIncarnationReader(() => 2);
    assert.equal(units.confirmDead("worker", 3), false);
    assert.equal(units.confirmDead("worker", 2), true);
    units.observe = () => parseUnitObservation(command(""));
    assert.equal(units.confirmDead("worker", 2), false);
    assert.throws(() => units.cgroupProcs("worker"));
    assert.throws(() => units.ensureResident("worker", "", ""));
});
test("R26: every unit command uses finite output/time limits and explicit kill policy", () => {
    assert.ok(UNIT_COMMAND_LIMITS.timeout > 0);
    assert.ok(UNIT_COMMAND_LIMITS.maxBuffer > 0);
    assert.equal(UNIT_COMMAND_LIMITS.killSignal, "SIGKILL");
});
test("R26: the unit install root is the environment's config root or a named failure, never a guessed /tmp", () => {
    // A process with no XDG_CONFIG_HOME and no HOME has no config root; unit
    // files written under a guessed /tmp would sit in shared space. It is named.
    assert.equal(unitsInstallDir({ XDG_CONFIG_HOME: "/c" }), "/c/systemd/user");
    assert.equal(unitsInstallDir({ HOME: "/h" }), "/h/.config/systemd/user");
    assert.equal(unitsInstallDir({ XDG_CONFIG_HOME: "", HOME: "/h" }), "/h/.config/systemd/user");
    for (const env of [{}, { HOME: "" }, { XDG_CONFIG_HOME: "", HOME: "" }])
        assert.throws(() => unitsInstallDir(env), (error) => error instanceof StoreError && error.code === "UNSUPPORTED_PROFILE" && /HOME/.test(error.message), JSON.stringify(env));
});
