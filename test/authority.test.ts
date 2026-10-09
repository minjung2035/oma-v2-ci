import test from "node:test";
import assert from "node:assert/strict";
import { capabilitiesOf } from "../src/authority.js";
import { StoreError } from "../src/domain/errors.js";
import { resolvedSpec } from "./fixtures/spec.js";

/** MAINTENANCE §10: a corrupt durable spec is not an empty permission set. */
const rejects = (specJson: string): void => {
  assert.throws(() => capabilitiesOf({ specJson }),
    (error: unknown) => error instanceof StoreError && error.code === "STORE_CORRUPT", specJson);
};

test("authority accepts only a closed resolved spec", () => {
  const base = JSON.parse(resolvedSpec(["mail.send"], "child", "agent"));
  for (const bad of [
    { ...base, modelProfile: undefined },
    { ...base, resources: undefined },
    { ...base, modelProfile: "" },
    { ...base, resources: { ...base.resources, memoryBytes: -1 } },
    { ...base, resources: { ...base.resources, unexpected: 1 } },
  ]) rejects(JSON.stringify(bad));
  assert.deepEqual(
    [...capabilitiesOf({ specJson: JSON.stringify(base) })],
    ["mail.send"],
  );
  rejects(JSON.stringify({ ...base, extra: true }));
  rejects(JSON.stringify({ ...base, capabilities: ["unknown"] }));
  rejects(JSON.stringify({ ...base, from: "not-an-oid" }));
});
