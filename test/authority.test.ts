import test from "node:test";
import assert from "node:assert/strict";
import { capabilitiesOf } from "../src/authority.js";
import { resolvedSpec } from "./fixtures/spec.js";

test("authority accepts only a closed resolved spec", () => {
  const base = JSON.parse(resolvedSpec(["mail.send"], "child", "agent"));
  for (const bad of [
    { ...base, modelProfile: undefined },
    { ...base, resources: undefined },
    { ...base, modelProfile: "" },
    { ...base, resources: { ...base.resources, memoryBytes: 0 } },
    { ...base, resources: { ...base.resources, unexpected: 1 } },
  ]) assert.equal(capabilitiesOf({ specJson: JSON.stringify(bad) }).size, 0);
  assert.deepEqual(
    [...capabilitiesOf({ specJson: JSON.stringify(base) })],
    ["mail.send"],
  );
  assert.equal(
    capabilitiesOf({ specJson: JSON.stringify({ ...base, extra: true }) }).size,
    0,
  );
  assert.equal(
    capabilitiesOf({
      specJson: JSON.stringify({ ...base, capabilities: ["unknown"] }),
    }).size,
    0,
  );
  assert.equal(
    capabilitiesOf({
      specJson: JSON.stringify({ ...base, from: "not-an-oid" }),
    }).size,
    0,
  );
});
