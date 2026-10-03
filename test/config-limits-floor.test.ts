/** AV-20261003-07: bounds the grammar accepts but the runtime cannot serve
 * must be refused by configuration validation, not discovered later as
 * INTERNAL_ERROR on accepted work.
 *
 * The audited code checked only "positive safe integer" for mailBodyBytes and
 * batchMaxMessages, so it accepted:
 *   - mailBodyBytes <= NOTICE_PART_OVERHEAD: every completion notice part
 *     computes a non-positive chunk budget and splitNotice throws on the
 *     accepted notice (AV-07).
 *   - mailBodyBytes below the smallest thread revision: threadBody's
 *     omission fallback throws INTERNAL_ERROR with accepted thread entries
 *     outstanding.
 *   - batchMaxMessages = 1: an actor whose direct and public mail are both
 *     pending can never drain either class -- selectBatch throws
 *     UNSUPPORTED_PROFILE on work the store already accepted.
 *
 * The floor is measured by the same constants and builders the emission
 * paths use (mail/review-bounds.ts), so these tests pin the boundary, not a
 * duplicated number. */
import test from "node:test";
import assert from "node:assert/strict";
import type { HostConfigV1 } from "../implementation/contracts.js";
import { validateConfig } from "../src/config.js";
import { NOTICE_PART_OVERHEAD, minimumMailBodyBytes } from "../src/mail/review-bounds.js";
import { MIN_MIXED_BATCH_MESSAGES } from "../src/mail/batch-policy.js";
import { createCompleteConfigurationFixture } from "./fixtures/configuration.js";

function withLimits(config: HostConfigV1, limits: Partial<HostConfigV1["limits"]>): HostConfigV1 {
  const copy = structuredClone(config);
  copy.limits = { ...copy.limits, ...limits };
  return copy;
}

test("AV-20261003-07: the shipped limits stay valid above the floor", () => {
  const fixture = createCompleteConfigurationFixture();
  try { assert.doesNotThrow(() => validateConfig(fixture.config)); }
  finally { fixture.close(); }
});

test("AV-20261003-07: mailBodyBytes at or under the notice-part overhead is refused", () => {
  const fixture = createCompleteConfigurationFixture();
  try {
    for (const mailBodyBytes of [1, NOTICE_PART_OVERHEAD - 1, NOTICE_PART_OVERHEAD])
      assert.throws(() => validateConfig(withLimits(fixture.config, { mailBodyBytes })),
        (error: unknown) => error instanceof Error && error.message.includes("limits.mailBodyBytes"),
        `mailBodyBytes=${mailBodyBytes} cannot carry a notice part`);
  } finally { fixture.close(); }
});

test("AV-20261003-07: mailBodyBytes under the smallest thread revision is refused, the floor itself is not", () => {
  const fixture = createCompleteConfigurationFixture();
  try {
    const subjectBytes = fixture.config.limits.subjectBytes;
    const floor = minimumMailBodyBytes(subjectBytes);
    assert.ok(floor > NOTICE_PART_OVERHEAD, "the thread floor is above the notice envelope");
    assert.throws(() => validateConfig(withLimits(fixture.config, { mailBodyBytes: floor - 1 })),
      (error: unknown) => error instanceof Error && error.message.includes("limits.mailBodyBytes"),
      `mailBodyBytes=${floor - 1} cannot always hold a thread revision`);
    assert.doesNotThrow(() => validateConfig(withLimits(fixture.config, { mailBodyBytes: floor })),
      "a bound exactly at the measured floor is still valid");
    // A larger configured subject bound moves the floor with it.
    const taller = withLimits(fixture.config, { subjectBytes: subjectBytes * 2 });
    const tallerFloor = minimumMailBodyBytes(subjectBytes * 2);
    assert.throws(() => validateConfig(withLimits(taller, { mailBodyBytes: tallerFloor - 1 })),
      /limits\.mailBodyBytes/, "the floor follows the configured subjectBytes");
    assert.doesNotThrow(() => validateConfig(withLimits(taller, { mailBodyBytes: tallerFloor })));
  } finally { fixture.close(); }
});

test("AV-20261003-07: a batch that cannot carry both mail classes is refused", () => {
  const fixture = createCompleteConfigurationFixture();
  try {
    assert.throws(() => validateConfig(withLimits(fixture.config, { batchMaxMessages: MIN_MIXED_BATCH_MESSAGES - 1 })),
      (error: unknown) => error instanceof Error && error.message.includes("limits.batchMaxMessages"),
      "batchMaxMessages=1 starves mixed direct/public pending mail");
    assert.doesNotThrow(() => validateConfig(withLimits(fixture.config, { batchMaxMessages: MIN_MIXED_BATCH_MESSAGES })),
      "the smallest mixed-capable batch is still valid");
  } finally { fixture.close(); }
});
