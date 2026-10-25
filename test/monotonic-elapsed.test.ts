/** MAC-650 / D-7: the places that measure elapsed time do it on the
 * monotonic clock. A wall clock stepped forward after a sleep would expire
 * their deadlines at once; stepped back, it would hold them open. The broker
 * restart window and the CLI's credential wait have no seam a behaviour test
 * could drive without real processes, so their source is held to it; the
 * principal delivery's spacing is driven in principal-settlement. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const modules: readonly [string, string][] = [
  ["process/restart-policy.js", import.meta.resolve("@oma/process/restart-policy")],
  ["client/transport.js", import.meta.resolve("@oma/client/transport")],
  ["protocol/alarm.js", import.meta.resolve("@oma/protocol/alarm")],
  ["runtime/principal-delivery.js", new URL(import.meta.resolve("#oma-test/app/runtime/principal-delivery")).href],
  ["tui/keys.js", import.meta.resolve("@oma/tui/keys")],
];
for (const [module, location] of modules) {
  test(`MAC-650: ${module} reads no wall clock to measure time`, () => {
    const source = readFileSync(new URL(location), "utf8");
    assert.doesNotMatch(source, /Date\.now\b/);
    assert.match(source, /performance\.now/);
  });
}
