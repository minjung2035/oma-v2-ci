import test from "node:test";
import assert from "node:assert/strict";
import { capabilitiesOf } from "../src/authority.js";

test("authority accepts only a closed resolved spec", () => {
  const base = {
    name: "agent",
    from: "0".repeat(40),
    brief: "brief",
    profile: "child",
    capabilities: ["mail.send"],
  };
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
