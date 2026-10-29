import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { surfaceRuleFindings } from "../scripts/architecture/rules/surface-rules.mjs";

function findings(files) {
  const root = mkdtempSync(join(process.cwd(), ".client-rule-"));
  try {
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), content);
    }
    return surfaceRuleFindings(root).filter(row => ["extension-closure", "extension-dynamic-load"].includes(row.rule));
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("PI-001 admits the shared client and erased contract shapes, not host runtime", () => {
  assert.deepEqual(findings({
    "packages/extension/src/index.ts": "import { client } from \"../../client/src/index.js\";",
    "packages/client/src/index.ts": "import type { Receipt } from \"../../contracts/src/index.js\"; import { connect } from \"node:net\"; export const client = connect;",
    "packages/extension/src/a.ts": "import type { Receipt } from \"../../contracts/src/index.js\";",
  }), []);
  for (const content of [
    'import { Receipt } from "../../implementation/contracts.js";',
    'import type { Store } from "../store.js";',
    'export { Store } from "../store.js";',
    'import { x } from "koffi";',
    'export const load = () => import("../store.js");',
    'import { a } from "../extension/a.js";',
  ]) assert.ok(findings({ "packages/client/src/index.ts": content }).length > 0, content);
});


test("credential and wait codecs are shared, closed, and reject malformed input", async () => {
  const { encodeCredential, decodeCredential, encodeWaitObservation, decodeWaitObservation } = await import("@oma/protocol/client-codecs");
  const grant = { credential: "a".repeat(64), sessionHandle: "b".repeat(32) };
  assert.deepEqual(decodeCredential(encodeCredential(grant).slice(0, -1)), grant);
  for (const line of ["", encodeCredential(grant), `credential ${"A".repeat(64)} ${grant.sessionHandle}`, `credential ${grant.credential} ${grant.sessionHandle} extra`, `credential ${grant.credential}\t${grant.sessionHandle}`])
    assert.equal(decodeCredential(line), null);
  assert.throws(() => encodeCredential({ ...grant, credential: "bad" }));
  for (const accepted of [false, true]) assert.deepEqual(decodeWaitObservation(JSON.parse(encodeWaitObservation({ accepted }))), { accepted });
  for (const value of [null, [], {}, { accepted: 1 }, { accepted: "false" }, { accepted: true, extra: 1 }])
    assert.throws(() => decodeWaitObservation(value), /malformed/);
});
