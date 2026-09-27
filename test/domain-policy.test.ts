// R02 independent policy oracles; no historical or newly executed PASS is claimed.
import test from "node:test";
import assert from "node:assert/strict";
import { CAPABILITIES, isCapability } from "../src/domain/capabilities.js";
import { RESOURCE_FIELDS, resourceLimitsCheck } from "../src/domain/resources.js";
import { PROTOCOL_LIMIT_FIELDS, protocolLimitsCheck } from "../src/domain/limits.js";
import { capabilitiesOf, resolvedSpecOf } from "../src/authority.js";
import { resolvedSpecDigest } from "../src/domain/spec-identity.js";
import { StoreError } from "../src/store.js";
import { ALL_CAPS, resolvedSpec } from "./fixtures/spec.js";

// Deliberately independent of the production vocabulary and fixture alias.
const EXPECTED_CAPABILITIES = [
  "mail.send", "route.follow", "agent.create", "agent.manage.self",
  "agent.manage.descendants", "git.submit", "code.integrate", "context.publish",
];
const RESOURCE_UNITS = {
  memoryBytes: "bytes", tasks: "count", cpuQuotaPercent: "percent", tmpBytes: "bytes",
  workspaceBytes: "bytes", stagingBytes: "bytes", checkTimeoutSeconds: "seconds",
};
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
  ["resources", RESOURCE_FIELDS, RESOURCE_UNITS, resourceLimitsCheck],
  ["protocol limits", PROTOCOL_LIMIT_FIELDS, LIMIT_UNITS, protocolLimitsCheck],
] as const) {
  test(`R02: ${title} have closed required positive safe integers and unchanged units`, () => {
    assert.deepEqual(Object.keys(fields), Object.keys(expectedUnits));
    const one = Object.fromEntries(Object.keys(expectedUnits).map((key) => [key, 1]));
    assert.equal(check(one), null, "minimum valid control");
    assert.equal(check(Object.fromEntries(Object.keys(expectedUnits).map((key) => [key, Number.MAX_SAFE_INTEGER]))), null);
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

// Exact pre-refactor fixture bytes; neither the descriptor nor serializer under test
// computes this expectation. Keeping these bytes preserves every deterministic hash of them.
const SPEC_BYTES = '{"name":"alice","modelProfile":"md","resources":{"memoryBytes":3221225472,"tasks":128,"cpuQuotaPercent":200,"tmpBytes":1048576,"workspaceBytes":1048576,"stagingBytes":1048576,"checkTimeoutSeconds":30},"from":"0000000000000000000000000000000000000000","brief":"test","profile":"p","capabilities":["mail.send","route.follow","agent.create","agent.manage.self","agent.manage.descendants","git.submit","code.integrate","context.publish"]}';

test("R02: policy deduplication preserves resolved-spec bytes and does not grant by role", () => {
  assert.equal(resolvedSpec(ALL_CAPS, "p", "alice"), SPEC_BYTES);
  const agent = { name: "alice", profile: "p", specJson: SPEC_BYTES, specHash: resolvedSpecDigest(JSON.parse(SPEC_BYTES)) };
  assert.deepEqual(resolvedSpecOf(agent), JSON.parse(SPEC_BYTES));
  assert.deepEqual([...capabilitiesOf(agent)], EXPECTED_CAPABILITIES);
  assert.equal(capabilitiesOf({ specJson: resolvedSpec([], "p", "principal") }).size, 0);
  const value = JSON.parse(SPEC_BYTES);
  value.resources.tasks = 0;
  const invalid = { ...agent, specJson: JSON.stringify(value) };
  // MAINTENANCE §10: corruption is not an empty permission set. Both readers
  // fail closed instead of degrading a corrupt durable spec to "no rights".
  assert.throws(() => capabilitiesOf(invalid),
    (error: unknown) => error instanceof StoreError && error.code === "STORE_CORRUPT");
  assert.throws(() => resolvedSpecOf(invalid),
    (error: unknown) => error instanceof StoreError && error.code === "STORE_CORRUPT");
});
