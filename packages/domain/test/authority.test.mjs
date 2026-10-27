import test from "node:test";
import assert from "node:assert/strict";
import { capabilitiesOf } from "@oma/domain/authority";
import { StoreError } from "@oma/domain/errors";
import { resolvedSpec } from "./fixtures/agent-spec.mjs";
/** MAINTENANCE §10: a corrupt durable spec is not an empty permission set. */
const rejects = (specJson) => {
    assert.throws(() => capabilitiesOf({ specJson }), (error) => error instanceof StoreError && error.code === "STORE_CORRUPT", specJson);
};
test("authority accepts only a closed resolved spec", () => {
    const base = JSON.parse(resolvedSpec(["mail.send"], "child", "agent"));
    for (const bad of [
        { ...base, modelProfile: undefined },
        { ...base, modelProfile: "" },
    ])
        rejects(JSON.stringify(bad));
    assert.deepEqual([...capabilitiesOf({ specJson: JSON.stringify(base) })], ["mail.send"]);
    rejects(JSON.stringify({ ...base, extra: true }));
    rejects(JSON.stringify({ ...base, capabilities: ["unknown"] }));
    rejects(JSON.stringify({ ...base, from: "not-an-oid" }));
});
