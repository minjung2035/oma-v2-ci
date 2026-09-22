/** WP01: document coverage and existing contract gates, NOT runtime qualification. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  assertSupportedIntegration,
  snapshotIntegrationPolicy,
} from "../dist/src/git/integration-policy.js";

const root = new URL("../", import.meta.url);
const document = new URL("implementation/consistency-decisions.md", root);
function decisions() {
  assert.ok(
    existsSync(document),
    "WP01 requires an adopted decision record, not implicit agreement",
  );
  return readFileSync(document, "utf8");
}
function rows(text) {
  return text
    .split("\n")
    .filter((line) => line.startsWith("| "))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
}
const spec = readFileSync(new URL("implementation-spec.md", root), "utf8");


test('V01B: WP01 profile review cannot imply unexecuted runtime qualification', () => {
  const profiles = rows(decisions()).filter(row => row[0].startsWith('profile.'));
  assert.deepEqual(profiles.map(row => row[0]).sort(), [
    'profile.confined', 'profile.engine-fixture', 'profile.foreground',
    'profile.provider', 'profile.systemd-managed', 'profile.unconfined',
  ]);
  for (const row of profiles) {
    assert.equal(row.length, 5);
    assert.equal(row[3], 'NOT_RUN', 'WP01 is a decision review, not a runtime lane');
    assert.match(row[4], /^WP\d{2}(, WP\d{2})*$/);
  }
});
test("V01A: every domain names facts, relations, phase and current authority", () => {
  const table = rows(decisions());
  for (const domain of [
    "delivery",
    "config",
    "preaccept",
    "quota",
    "lifecycle",
    "Git",
    "protocol",
  ]) {
    const found = table.filter((row) => row[0] === domain);
    assert.equal(
      found.length,
      1,
      `${domain}: exactly one domain responsibility row`,
    );
    assert.equal(
      found[0].length,
      9,
      `${domain}: fact/store/view/relation/commit/authority/owner/requirement`,
    );
    assert.ok(
      found[0].every((cell) => cell.length > 0),
      `${domain}: no empty responsibility`,
    );
    for (const id of found[0][8].split(", "))
      assert.ok(spec.includes(`[${id}`), `actual requirement ${id}`);
  }
});

const expectedCases = [
  "D01.exact",
  "D01.absent",
  "D01.unavailable",
  "D01.conflicting",
  "D01.completed",
  "D01.legacy-mismatch",
  "D02.inline",
  "D02.manual",
  "D02.managed",
  "D02.conflict",
  "D02.outcome-unconfirmed",
  "D03.location",
  "D03.foreground",
  "D03.systemd",
  "D04.read",
  "D04.admit",
  "D04.settle",
  "D04.safety",
  "D04.recovery",
  "D05.bootstrap",
  "D05.apply-time",
  "D05.binding",
  "D06.acceptance-unknown",
  "D06.no-op",
  "D06.applied",
  "D06.unsupported",
  "D06.power-loss",
  "preaccept.acceptance-unknown",
];
function checkCases(text) {
  const cases = rows(text).filter((row) =>
    /^(D0[1-6]\.|preaccept\.)/.test(row[0]),
  );
  assert.deepEqual(
    cases.map((row) => row[0]).sort(),
    [...expectedCases].sort(),
    "all decision cases, including unknown and legacy mismatch",
  );
  for (const row of cases) {
    assert.equal(
      row.length,
      7,
      `${row[0]}: case/existing/decision/WP/oracle/compatibility/requirement`,
    );
    assert.ok(row.every((cell) => cell.length > 0));
    assert.match(row[3], /^WP\d{2}(, WP\d{2})*$/);
    assert.match(row[4], /^V\d{2}[A-C](, V\d{2}[A-C])*$/);
    assert.match(row[5], /^C[012]$/);
    for (const id of row[6].split(", "))
      assert.ok(spec.includes(`[${id}`), `actual requirement ${id}`);
  }
}
test("V01A: all proposed cases have existing rule, owner, oracle and compatibility", () =>
  checkCases(decisions()));
test("V01A negative controls: deleting uncertainty or legacy mismatch fails review", () => {
  const text = decisions();
  checkCases(text);
  for (const id of [
    "D01.unavailable",
    "D01.legacy-mismatch",
    "D06.acceptance-unknown",
    "preaccept.acceptance-unknown",
  ]) {
    const without = text
      .split("\n")
      .filter((line) => !line.startsWith(`| ${id} |`))
      .join("\n");
    assert.notEqual(without, text);
    assert.throws(() => checkCases(without), assert.AssertionError);
  }
});
test("V01A: existing normative requirements explicitly carry their reviewed decision", () => {
  for (const [requirement, decision] of [
    ["BATCH-004", "D01"],
    ["CFG-005", "D02"],
    ["UNIT-004", "D03"],
    ["TUI-019", "D05"],
    ["INT-004", "D06"],
    ["PR-002", "D06"],
  ]) {
    const line = spec
      .split("\n")
      .find((value) => value.startsWith(`**MUST [${requirement}]`));
    assert.ok(
      line?.includes(decision),
      `${requirement} must explicitly resolve ${decision}, not leave conflicting defaults`,
    );
  }
});

test('V01A: N-001 identifies the reviewed architecture bytes', () => {
  const architecture = readFileSync(new URL('architecture.md', root));
  const digest = createHash('sha256').update(architecture).digest('hex');
  const rule = spec.split('\n').find(line => line.startsWith('**MUST [N-001]'));
  assert.ok(rule?.includes(digest), 'N-001 architecture hash is not the reviewed source');
});

test("V01B: conceptual states do not silently become v1 SQL state or entities", () => {
  const ddl = readFileSync(new URL("implementation/schema-v1.sql", root));
  assert.equal(
    createHash("sha256").update(ddl).digest("hex"),
    "c97f2a15b71c87ce6ce753f95878931ee8adb0193b341263a6d594e1d93526e4",
    "a v1 DDL change needs separate C3 approval, not a golden refresh",
  );
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(ddl.toString());
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 1);
    assert.deepEqual(
      db
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name",
        )
        .all()
        .map((row) => row.name),
      [
        "agents",
        "batches",
        "deliveries",
        "operations",
        "subscriptions",
        "usage",
      ],
    );
  } finally {
    db.close();
  }
});

test("V01B: the actual unsupported integration gate is not generic success or retry", () => {
  const policy = { policyRevision: "wp01", protectedPaths: [], checks: [] };
  assert.doesNotThrow(() =>
    assertSupportedIntegration(snapshotIntegrationPolicy(policy)),
  );
  for (const restricted of [
    {
      ...policy,
      checks: [
        {
          id: "unqualified",
          argv: ["/usr/bin/true"],
          env: {},
          timeoutSeconds: 1,
        },
      ],
    },
    { ...policy, protectedPaths: ["/"] },
  ])
    assert.throws(
      () => assertSupportedIntegration(snapshotIntegrationPolicy(restricted)),
      (error) => error.code === "SPIKE_UNRESOLVED",
    );
});
