import test from "node:test";
import assert from "node:assert/strict";
import { createCompleteConfigurationFixture } from "./fixtures/configuration.js";
import {
  EDITABLE_FIELDS,
  EDITABLE_FIELD_DESCRIPTORS,
  EXTENSIONS,
  fieldsOf,
  readSettings,
} from "#oma-test/app/application/settings";

test("V11B: one own-key descriptor registry covers every editable field and policy", () => {
  assert.equal(Object.getPrototypeOf(EDITABLE_FIELD_DESCRIPTORS), null);
  assert.deepEqual(Object.keys(EDITABLE_FIELD_DESCRIPTORS).sort(), [...EDITABLE_FIELDS].sort());
  assert.equal(Object.hasOwn(EDITABLE_FIELD_DESCRIPTORS, EXTENSIONS), false);
  assert.equal(Object.hasOwn(EDITABLE_FIELD_DESCRIPTORS, "toString"), false);
  const fixture = createCompleteConfigurationFixture();
  try {
    const settings = readSettings(fixture.input);
    const projected = fieldsOf(settings.config, settings.workerProfile);
    for (const id of EDITABLE_FIELDS) {
      const field = projected.find(candidate => candidate.id === id);
      const descriptor = EDITABLE_FIELD_DESCRIPTORS[id];
      assert.ok(field && field.kind !== "link", `${id} was not projected`);
      assert.equal(field.label, descriptor.label);
      assert.equal(field.apply, descriptor.apply);
    }
  } finally {
    fixture.close();
  }
});
