import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

test("E27/E30: dead process plumbing and the unused incarnation environment are absent", () => {
  // The shim that re-exported fence helpers under a removed process's name.
  assert.equal(existsSync("packages/extension/src/cli-process.ts"), false);
  assert.doesNotMatch(readFileSync("packages/extension/src/mail-tools.ts", "utf8"), /runCliProcess|runCli\(|OMA_CLI_PATH|cli-process/);
  // The credential-descriptor contract died with the extension-spawned CLI.
  assert.doesNotMatch(readFileSync("apps/oma/src/cli/transport.ts", "utf8"), /OMA_PRINCIPAL_CREDENTIAL_FD|readPresentedGrant|presentedGrant/);
  assert.doesNotMatch(readFileSync("packages/platform-linux/src/sandbox.ts", "utf8"), /OMA_INCARNATION/);
  for (const path of ["packages/protocol/src/host-channel.ts", "packages/extension/src/principal-channel.ts"])
    assert.match(readFileSync(path, "utf8"), /client-codecs/);
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
