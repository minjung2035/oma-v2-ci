// R02 independent policy oracles; no historical or newly executed PASS is claimed.
import test from "node:test";
import assert from "node:assert/strict";
import { CAPABILITIES, isCapability } from "@oma/domain/capabilities";

import { PROTOCOL_LIMIT_FIELDS, protocolLimitsCheck } from "@oma/domain/limits";
import { capabilitiesOf } from "@oma/domain/authority";
import { resolvedSpecOf } from "@oma/domain/agent-spec";
import { resolvedSpecDigest } from "@oma/domain/spec-identity";
import { StoreError } from "@oma/domain/errors";
import { ALL_CAPS, resolvedSpec } from "./fixtures/spec.js";

// Deliberately independent of the production vocabulary and fixture alias.
const EXPECTED_CAPABILITIES = [
  "mail.send", "route.follow", "agent.create", "agent.manage.self",
  "agent.manage.descendants", "git.submit", "code.integrate", "context.publish",
];
const LIMIT_UNITS = {
  frameBytes: "bytes", mailBodyBytes: "bytes", subjectBytes: "bytes", addresses: "count",
  replyReferences: "count", contextFiles: "count", contextBytes: "bytes", bundleBytes: "bytes",
  logBytes: "bytes", batchMaxMessages: "count", idleStreamSeconds: "seconds", receiptWaitSeconds: "seconds",
};

test("R02: capability vocabulary is exactly the existing ordered eight values", () => {
  assert.deepEqual(CAPABILITIES, EXPECTED_CAPABILITIES);
  assert.deepEqual(ALL_CAPS, EXPECTED_CAPABILITIES);
  for (const capability of EXPECTED_CAPABILITIES) assert.equal(isCapability(capability), true);
  for (const invalid of [null, undefined, "", "admin", "principal", "MAIL.SEND", {}, 1])
    assert.equal(isCapability(invalid), false);
  assert.equal(Object.isFrozen(CAPABILITIES), true);
});

for (const [title, fields, expectedUnits, check] of [
  ["protocol limits", PROTOCOL_LIMIT_FIELDS, LIMIT_UNITS, protocolLimitsCheck],
] as const) {
  test(`R02: ${title} have closed required positive safe integers and unchanged units`, () => {
    assert.deepEqual(Object.keys(fields), Object.keys(expectedUnits));
    const one = Object.fromEntries(Object.keys(expectedUnits).map((key) => [key, 1]));
    assert.equal(check(one), null, "minimum valid control");
    const maxima = Object.fromEntries(Object.entries(fields).map(([key, field]) =>
      [key, "maxInclusive" in field ? field.maxInclusive : Number.MAX_SAFE_INTEGER]));
    assert.equal(check(maxima), null, "declared maximum valid control");
    const units = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.unit]));
    assert.deepEqual(units, expectedUnits);
    for (const [key, field] of Object.entries(fields)) {
      assert.equal(field.minInclusive, 1);
      assert.equal(Object.isFrozen(field), true);
      for (const value of [-1, 0, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1", null, undefined])
        assert.notEqual(check({ ...one, [key]: value }), null, `${key} must reject ${String(value)}`);
      const missing = { ...one };
      delete missing[key];
      assert.notEqual(check(missing), null, `${key} must be present`);
    }
    assert.notEqual(check({ ...one, extra: 1 }), null);
    assert.notEqual(check(Object.create(one)), null, "inherited fields are not required own fields");
    for (const invalid of [null, undefined, [], "record", 1]) assert.notEqual(check(invalid), null);
    assert.equal(Object.isFrozen(fields), true);
  });
}

// Independent schema-4 fixture bytes; the serializer under test does not compute this oracle.
const SPEC_BYTES = '{"name":"alice","modelProfile":"md","from":"0000000000000000000000000000000000000000","brief":"test","profile":"p","capabilities":["mail.send","route.follow","agent.create","agent.manage.self","agent.manage.descendants","git.submit","code.integrate","context.publish"]}';

test("DR46 spec bytes: current frozen identity does not grant capabilities by role", () => {
  assert.equal(resolvedSpec(ALL_CAPS, "p", "alice"), SPEC_BYTES);
  const agent = { name: "alice", profile: "p", specJson: SPEC_BYTES, specHash: resolvedSpecDigest(JSON.parse(SPEC_BYTES)) };
  assert.deepEqual(resolvedSpecOf(agent), JSON.parse(SPEC_BYTES));
  assert.deepEqual([...capabilitiesOf(agent)], EXPECTED_CAPABILITIES);
  assert.equal(capabilitiesOf({ specJson: resolvedSpec([], "p", "principal") }).size, 0);
  const value = JSON.parse(SPEC_BYTES);
  value.modelProfile = "";
  const invalid = { ...agent, specJson: JSON.stringify(value) };
  // MAINTENANCE §10: corruption is not an empty permission set. Both readers
  // fail closed instead of degrading a corrupt durable spec to "no rights".
  assert.throws(() => capabilitiesOf(invalid),
    (error: unknown) => error instanceof StoreError && error.code === "STORE_CORRUPT");
  assert.throws(() => resolvedSpecOf(invalid),
    (error: unknown) => error instanceof StoreError && error.code === "STORE_CORRUPT");
});
