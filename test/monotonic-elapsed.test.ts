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

const dist = join(fileURLToPath(new URL(".", import.meta.url)), "..", "src");
for (const module of ["runtime/broker-supervisor.js", "cli/transport.js", "runtime/principal-delivery.js"]) {
  test(`MAC-650: ${module} reads no wall clock to measure time`, () => {
    const source = readFileSync(join(dist, module), "utf8");
    assert.doesNotMatch(source, /Date\.now\b/);
    assert.match(source, /performance\.now/);
  });
}
