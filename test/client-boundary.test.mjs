import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    "src/pi-extension.ts": 'import { client } from "./client/index.js";',
    "src/client/index.ts": 'import type { Receipt } from "../../implementation/contracts.js"; import { connect } from "node:net"; export const client = connect;',
    "src/extension/a.ts": 'import type { Receipt } from "../../implementation/contracts.js";',
  }), []);
  for (const content of [
    'import { Receipt } from "../../implementation/contracts.js";',
    'import type { Store } from "../store.js";',
    'export { Store } from "../store.js";',
    'import { x } from "koffi";',
    'export const load = () => import("../store.js");',
    'import { a } from "../extension/a.js";',
  ]) assert.ok(findings({ "src/client/index.ts": content }).length > 0, content);
});

test("E27/E30: dead process plumbing and the unused incarnation environment are absent", () => {
  assert.doesNotMatch(readFileSync("src/extension/cli-process.ts", "utf8"), /spawn|credential|argv|stdout|runCliProcess/);
  assert.doesNotMatch(readFileSync("src/extension/mail-tools.ts", "utf8"), /runCliProcess|runCli\(|OMA_CLI_PATH/);
  assert.doesNotMatch(readFileSync("src/sandbox.ts", "utf8"), /OMA_INCARNATION/);
  for (const path of ["src/protocol/host-channel.ts", "src/extension/principal-channel.ts"])
    assert.match(readFileSync(path, "utf8"), /client\/codecs\.js/);
});

test("credential and wait codecs are shared, closed, and reject malformed input", async () => {
  const { encodeCredential, decodeCredential, encodeWaitObservation, decodeWaitObservation } = await import("../dist/src/client/codecs.js");
  const grant = { credential: "a".repeat(64), sessionHandle: "b".repeat(32) };
  assert.deepEqual(decodeCredential(encodeCredential(grant).slice(0, -1)), grant);
  for (const line of ["", encodeCredential(grant), `credential ${"A".repeat(64)} ${grant.sessionHandle}`, `credential ${grant.credential} ${grant.sessionHandle} extra`, `credential ${grant.credential}\t${grant.sessionHandle}`])
    assert.equal(decodeCredential(line), null);
  assert.throws(() => encodeCredential({ ...grant, credential: "bad" }));
  for (const accepted of [false, true]) assert.deepEqual(decodeWaitObservation(JSON.parse(encodeWaitObservation({ accepted }))), { accepted });
  for (const value of [null, [], {}, { accepted: 1 }, { accepted: "false" }, { accepted: true, extra: 1 }])
    assert.throws(() => decodeWaitObservation(value), /malformed/);
});
