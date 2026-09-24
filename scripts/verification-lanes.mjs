/** Verification tooling, not production runtime. Commands run only when invoked. */
// Mixed files retain all their assertions, but are not local unit/integration proof.
export const systemdTestFiles = Object.freeze([
  "audit.test.js",
  "audit2.test.js",
  "cli.test.js",
  "phase4.test.js",
  "phase5.test.js",
  "phase8.test.js",
  "crash-boundaries.test.js",
  "launch-topology.test.js",
  "cgroup-pin.test.js",
]);
/** Tests a run reported but did not execute.
 *
 * A Node test run exits zero when tests skip, so the exit code alone cannot
 * tell a suite that proved everything from one that quietly proved less --
 * four sandbox tests skipping on a host without bubblewrap looks exactly like
 * a pass. A summary that does not report these counts at all is treated the
 * same way: an unreadable result is not a passing one.
 */
export function unrunTests(summary) {
  const unrun = [];
  for (const field of ["skipped", "todo", "cancelled"]) {
    const line = new RegExp(`^# ${field} (\\d+)$`, "m").exec(summary ?? "");
    if (line === null) unrun.push(`${field}: not reported`);
    else if (Number(line[1]) > 0) unrun.push(`${field}: ${line[1]}`);
  }
  return unrun;
}

/** The individual tests a run marked as not executed, for a report that names
 * them instead of only counting them. */
export function unrunDirectives(summary) {
  return (summary ?? "").split("\n").filter(line => / # (SKIP|TODO)\b/.test(line)).map(line => line.trim());
}

export function localTestFiles(compiled) {
  for (const required of systemdTestFiles)
    if (!compiled.includes(required))
      throw new Error(`required systemd test file missing: ${required}`);
  return compiled.filter((file) => !systemdTestFiles.includes(file));
}
// Entry lanes probe the current production quota gate after a fresh build.
// The requested bytes match the positive entry fixture; this is not an allow flag.
export const lanes = Object.freeze({
  fast: {
    files: [
      "config-edit-descriptors.test.js",
      "domain-identifiers.test.js",
      "domain-policy.test.js",
      "id-contracts.test.js",
      "r29-reconcile-accounting.test.js",
      "systemd-cleanup.test.js",
      "verification-oracles.test.js",
      "p24-owner-guards.test.js",
      "f2-cli-request.test.js",
      "f3-log-frame.test.js",
      "f4-cli-frame.test.js",
      "operations-config.test.js",
      "status-observation.test.js",
      "wire-byte-limits.test.js",
      "r15-response-codec.test.js",
      "audit-cli-text.test.js",
      "audit-git-known.test.js",
      "protocol-method-descriptors.test.js",
      "method-resource-categories.test.js",
      "launch-location.test.js",
      "host-entry.test.js",
    ],
    sourceFiles: [
      "test/consistency-decisions.test.mjs",
      "test/config-bundle-owner.test.mjs",
      "test/systemd-test-policy.test.mjs",
      "test/verification-policy.test.mjs",
      "test/exploration-policy.test.mjs",
      "test/traceability-policy.test.mjs",
      "test/r34-owner-policy.test.mjs",
      "test/production-inventory.test.mjs",
      "test/operation-registry-policy.test.mjs",
      "test/broker-composition-policy.test.mjs",
      "test/public-validation-policy.test.mjs",
      "test/architecture-oracles.test.mjs",
      "test/architecture-rule-modules.test.mjs",
      "test/architecture-evolution.test.mjs",
      "test/dependency-lattice.test.mjs",
      "test/p11-p12-dispatch.test.mjs",
      "test/same-uid-namespace.test.mjs",
      "test/society-lease-identity.test.mjs",
      "test/receipt-supersession.test.mjs",
    ],
    requiredNames: [
      "V29A: the request-hash set-field recipe",
      "D03 launched location",
      "D03 resident unit",
      "D03: a host unit without the rendered run root",
      "D03: a runner unit without the whole rendered location",
      "V01A:",
      "V01B:",
      "V02A:",
      "V11B:",
      "V21A:",
      "S-06/FS-005:",
      "AUTH-003: a broker handed society A's lease",
      "REC-007: a settled receipt survives",
      "OPS config:",
      "WP25.03 / D05: a Resident runs",
      "WP23.02:",
      "V26C:",
      "V29A: the exit-owner rule",
      "R15: envelope version ID discriminator",
      "WP23.03:",
      "CLI text:",
      "CLI submit: git.known",
      "F2:",
      "F3:",
      "F4:",
      "V01",
      "V02",
      "V03-S1",
      "V03-S2",
      "V03-S3",
      "V04",
      "V05",
      "P08:",
      "A02:",
      "ID-002",
      "R29",
      "R39",
      "R34 C04",
      "R38 C05",
      "P1 operation registry",
      "P1 composition root",
      "P1 public validation",
      "P10 full Program",
      "P11 handler closure",
      "P12 capability closure",
      "P13 every semantic zone",
      "P14 declaration-only",
      "P15 SCC agrees",
    ],
    environment: "node",
    timeoutSeconds: 600,
    proof:
      "type/schema/AST, deterministic domain/owner guards and local fixture checks (including SQLite/flock); not user-manager qualification",
  },
  durable: {
    files: [
      "inference-relay.test.js",
      "engine-inference-chain.test.js",
      "resident-sandbox-live.test.js",
      "resident-confinement.test.js",
      "cli-receipt-replay.test.js",
      "r14-connection-lifecycle.test.js",
      "r15-channel-generations.test.js",
      "principal-session-ownership.test.js",
      "delivery-deadlines.test.js",
      "settings-apply-time.test.js",
      "principal-settlement.test.js",
      "project-binding.test.js",
      "extension-editing.test.js",
      "rollover-settlement.test.js",
      "config-generations.test.js",
      "config-editing.test.js",
      "preaccept-scope.test.js",
      "delivery-receipt-publication.test.js",
      "config-snapshot.test.js",
      "checkpoint-driver.test.js",
      "store-open.test.js",
      "durable-boundary.test.js",
      "mail-integrity.test.js",
      "mail-recovery-integrity.test.js",
      "context-file-identity.test.js",
      "r30-views.test.js",
      "r31-owner-seams.test.js",
      "r37-async-process.test.js",
      "r37-preparation-boundaries.test.js",
      "r37-recovery-observation.test.js",
      "r37-shutdown-observation.test.js",
      "phase2.test.js",
      "r25-action-replay.test.js",
      "p24-deployment-gates.test.js",
      "p24-mail-boundaries.test.js",
      "preaccept-ownership.test.js",
      "mail-submit-scope.test.js",
      "action-admission.test.js",
      "settlement-headroom.test.js",
      "git-effect-evidence.test.js",
      "r21-context-workflow.test.js",
      "r21-context-stream.test.js",
      "receipt-observation.test.js",
      "receipt-settlement.test.js",
      "p24-git-import.test.js",
      "f1-reply-boundary.test.js",
      "audit-eml-admission.test.js",
      "audit-cli-submit.test.js",
    ],
    sourceFiles: [],
    requiredNames: [
      "V27A:",
      "V27B:",
      "T113",
      "T114",
      "T116",
      "T117",
      "V26B:",
      "WP26: a receipt the request cache cannot record",
      "actual CLI uses authoritative receipts",
      "R14: fatal UTF-8/JSON/length/EOF never allows",
      "R14: disconnect preserves dispatched ownership",
      "R15: reconnect after a partial header",
      "V09A:",
      "V09B:",
      "V09C:",
      "V10A:",
      "V10C:",
      "V15A:",
      "V15B:",
      "V08A:",
      "V08B:",
      "V16A:",
      "V16B:",
      "V14A:",
      "V14B:",
      "V07A:",
      "V07B:",
      "D02 generation identity",
      "V13A:",
      "V13B:",
      "V13C:",
      "V02B:",
      "V11A:",
      "V17A:",
      "V17B:",
      "V05A:",
      "V05B:",
      "V12A:",
      "V12B:",
      "V18A:",
      "V18B:",
      "V06A:",
      "V06B local:",
      "V19A:",
      "V19B:",
      "V20A:",
      "V20B:",
      "V21B:",
      "V22B:",
      "V24A:",
      "V24B:",
      "V04A:",
      "V04B:",
      "EML admission:",
      "CLI submit: incremental sha256",
      "CLI submit: self-contained sha256",
      "CLI submit: already-known sha256",
      "CLI submit: git failure",
      "CLI submit: read failure",
      "F1:",
      "R30",
      "R31",
      "R37",
      "T03",
      "R25 C01/C02",
      "P01:",
      "P02:",
      "P03:",
      "P04:",
      "P05:",
      "P06:",
      "PRE-1:",
      "PRE-4:",
      "PRE-8:",
      "P07: sha1",
      "P07: sha256",
    ],
    environment: "git-fs",
    timeoutSeconds: 1200,
    proof:
      "real SQLite/Git/filesystem/native child boundaries and actual lifecycle dispatch; controlled units are not actual systemd or power-loss proof",
  },
  kernel: {
    files: [
      ...systemdTestFiles.filter((file) => file !== "crash-boundaries.test.js"),
      "peer-pid.test.js",
      "native-leaf.test.js",
      "runner-channel.test.js",
      "compliance.test.js",
    ],
    sourceFiles: [],
    requiredNames: [
      "AUTH-003 native",
      "UNIT-004",
      "LIFE-009 entry:",
      "D1: READY=1",
      "C1: two concurrent git.submit",
      "P0-1/2/3 + P1-7/8",
      "V03A/V03B product topology",
      "V03B unsupported",
      "V07B kernel",
      "T36:",
      "V25A:",
      "WP25.03 / D05: a Resident's unit",
      "V23B:",
    ],
    environment: "systemd",
    timeoutSeconds: 3600,
    entryStorageBytes: 1,
    proof:
      "actual user-systemd/native/socket/cgroup oracles; unsupported environment is not a pass",
  },
  crash: {
    files: ["crash-boundaries.test.js", "global-invariants.test.js"],
    sourceFiles: [],
    requiredNames: [
      "T18",
      "T23",
      "T57",
      "T39",
      "R33 existing SIGKILL",
      "S-05 recovery",
    ],
    environment: "systemd",
    timeoutSeconds: 3600,
    proof:
      "primitive SIGSTOP/parent-SIGKILL and restart; not an entrypoint-crash or VM-power-loss attestation",
  },
  property: {
    files: [
      "config-validation.test.js",
      "effect-observation.test.js",
      "verification-property.test.js",
      "r36-model.test.js",
      "r36-model-mutations.test.js",
      "r36-parser-fuzz.test.js",
      "r36-lifecycle-sequences.test.js",
    ],
    sourceFiles: [],
    requiredNames: [
      "V02C:",
      "V11C:",
      "R35 property",
      "R36 model seed=",
      "R36 parser corpus",
      "R36 model mutant",
      "R36 lifecycle replay seed=",
      "R36 lifecycle replay C01/C02 corpus",
    ],
    environment: "git-fs",
    timeoutSeconds: 600,
    proof:
      "seeded independent models vs SQLite/mail and actual lifecycle retries with controlled unit effects; R33 invariants and bounded parser corpus; not kernel or provider proof",
  },
  stress: {
    files: ["verification-stress.test.js", "r36-resource-stress.test.js", "storage-reservation.test.js", "status-responsiveness.test.js"],
    sourceFiles: [],
    requiredNames: [
      "R35 stress",
      "R36 stress native transport",
      "R36 stress no-progress",
      "V22A:",
      "V23A:",
      "V23A / WP23.03:",
      "V23A / WP23.05:",
    ],
    environment: "git-fs",
    timeoutSeconds: 600,
    proof:
      "finite real Linux socket/pidfd/cgroup-FD and direct-child pipe cleanup, measured test RSS and queue bounds; not provider throughput, kernel quota or process-tree death certification",
  },
  all: {
    files: "all",
    sourceFiles: [
      "test/consistency-decisions.test.mjs",
      "test/config-bundle-owner.test.mjs",
      "test/verification-policy.test.mjs",
      "test/exploration-policy.test.mjs",
      "test/traceability-policy.test.mjs",
      "test/r34-owner-policy.test.mjs",
      "test/production-inventory.test.mjs",
      "test/operation-registry-policy.test.mjs",
      "test/broker-composition-policy.test.mjs",
      "test/public-validation-policy.test.mjs",
      "test/architecture-oracles.test.mjs",
      "test/dependency-lattice.test.mjs",
      "test/p11-p12-dispatch.test.mjs",
      "test/same-uid-namespace.test.mjs",
      "test/society-lease-identity.test.mjs",
      "test/receipt-supersession.test.mjs",
    ],
    requiredNames: [
      "V01A:",
      "V01B:",
      "V02A:",
      "V02B:",
      "V02C:",
      "V11A:",
      "V11B:",
      "V11C:",
      "V17A:",
      "V17B:",
      "V05A:",
      "V05B:",
      "V12A:",
      "V12B:",
      "V18A:",
      "V18B:",
      "V06A:",
      "V06B local:",
      "V19A:",
      "V19B:",
      "V20A:",
      "V20B:",
      "V21A:",
      "V21B:",
      "V22A:",
      "V22B:",
      "V24A:",
      "V24B:",
      "V04A:",
      "V04B:",
      "S-06/FS-005:",
      "AUTH-003: a broker handed society A's lease",
      "REC-007: a settled receipt survives",
      "ID-002",
      "T18",
      "T39",
      "AUTH-003 native",
      "R36 model seed=",
      "R36 parser corpus",
      "R37",
      "R39",
      "R25 C01/C02",
      "R34 C04",
      "R38 C05",
      "R36 lifecycle replay seed=",
      "P1 operation registry",
      "P1 composition root",
      "P1 public validation",
      "P10 full Program",
      "P11 handler closure",
      "P12 capability closure",
      "P13 every semantic zone",
      "P14 declaration-only",
      "P15 SCC agrees",
      "LIFE-009 entry:",
      "D1: READY=1",
      "C1: two concurrent git.submit",
      "P0-1/2/3 + P1-7/8",
      "V01",
      "V02",
      "V03-S1",
      "V03-S2",
      "V03-S3",
      "V04",
      "V05",
      "P01:",
      "P02:",
      "P03:",
      "P04:",
      "P05:",
      "P06:",
      "P07: sha1",
      "P07: sha256",
      "P08:",
      "A02:",
    ],
    entryStorageBytes: 1,
    environment: "systemd",
    timeoutSeconds: 7200,
    proof: "full serial suite; each oracle retains its own proof scope",
  },
});
export function parseTap(raw) {
  const totals = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = /^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/.exec(
      line,
    );
    if (match) totals[match[1]] = Number(match[2]);
  }
  const names = [];
  const skippedNames = [];
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*(?:not )?ok \d+(?: -)? (.+)$/.exec(line);
    if (!match) continue;
    names.push(match[1].replace(/\s+# (?:SKIP|TODO).*$/i, ""));
    if (/\s+# (?:SKIP|TODO)(?:\s|$)/i.test(match[1]))
      skippedNames.push(match[1]);
  }
  return { totals, names, skippedNames };
}
export function evaluateExecution({
  exitCode,
  signal = null,
  tap,
  requiredNames = [],
  baselineNames,
}) {
  const parsed = parseTap(tap);
  const errors = [];
  if (exitCode !== 0 || signal !== null)
    errors.push("test-process-did-not-exit-cleanly");
  for (const key of ["tests", "pass", "fail", "cancelled", "skipped", "todo"])
    if (!Number.isSafeInteger(parsed.totals[key]) || parsed.totals[key] < 0)
      errors.push(`missing-or-invalid-summary:${key}`);
  if (!(parsed.totals.tests > 0)) errors.push("empty-or-unstarted-test-suite");
  if (parsed.totals.fail !== 0 || parsed.totals.cancelled !== 0)
    errors.push("test-failure-or-cancellation");
  if (
    parsed.totals.skipped !== 0 ||
    parsed.totals.todo !== 0 ||
    parsed.skippedNames.length !== 0
  )
    errors.push("skip-or-todo-not-permitted");
  if (
    parsed.totals.tests !==
    parsed.totals.pass +
      parsed.totals.fail +
      parsed.totals.cancelled +
      parsed.totals.skipped +
      parsed.totals.todo
  )
    errors.push("test-summary-does-not-balance");
  for (const required of requiredNames)
    if (!parsed.names.some((name) => name.includes(required)))
      errors.push(`critical-oracle-not-executed:${required}`);
  if (baselineNames)
    for (const name of new Set(baselineNames))
      if (!parsed.names.includes(name))
        errors.push(`baseline-oracle-removed:${name}`);
  return {
    status: errors.length === 0 ? "PASS" : "FAIL",
    errors,
    ...parsed,
    baselineComparison: baselineNames ? "COMPARED" : "NOT_AVAILABLE",
  };
}
/** SIGKILL alone is not proof of reaching the intended effect boundary. */
export function validateCrashObservation({
  requestedPoint,
  reachedPoint,
  signal,
  restarted,
}) {
  return (
    typeof requestedPoint === "string" &&
    requestedPoint.length > 0 &&
    requestedPoint === reachedPoint &&
    signal === "SIGKILL" &&
    restarted === true
  );
}
