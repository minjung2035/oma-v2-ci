/** Verification tooling, not production runtime. Commands run only when invoked. */
export const lanes = Object.freeze({
  fast: { files: ["domain-identifiers.test.js", "domain-policy.test.js", "id-contracts.test.js", "r27-resource-phases.test.js", "r29-reconcile-accounting.test.js"],
    sourceFiles: ["test/verification-policy.test.mjs", "test/exploration-policy.test.mjs", "test/traceability-policy.test.mjs",
      "test/r34-owner-policy.test.mjs", "test/production-inventory.test.mjs", "test/operation-registry-policy.test.mjs",
      "test/broker-composition-policy.test.mjs", "test/public-validation-policy.test.mjs"],
    requiredNames: ["ID-002", "R27", "R29", "R39", "R34 C04", "R38 C05", "P1 operation registry", "P1 composition root", "P1 public validation"], environment: "node", timeoutSeconds: 600,
    proof: "type/schema/AST and deterministic domain behavior" },
  durable: { files: ["durable-boundary.test.js", "mail-integrity.test.js", "mail-recovery-integrity.test.js", "context-file-identity.test.js", "r30-views.test.js", "r31-owner-seams.test.js",
      "r37-async-process.test.js", "r37-preparation-boundaries.test.js", "r37-recovery-observation.test.js", "r37-shutdown-observation.test.js",
      "phase2.test.js", "r25-action-replay.test.js"],
    sourceFiles: [], requiredNames: ["R30", "R31", "R37", "T03", "R25 C01/C02"], environment: "git-fs", timeoutSeconds: 1200,
    proof: "real SQLite/Git/filesystem/native child boundaries and actual lifecycle dispatch; controlled units are not actual systemd or power-loss proof" },
  kernel: { files: ["audit.test.js", "audit2.test.js", "phase4.test.js", "phase5.test.js", "peer-pid.test.js", "native-leaf.test.js", "runner-channel.test.js", "compliance.test.js"],
    sourceFiles: [], requiredNames: ["AUTH-003 native", "UNIT-004"], environment: "systemd", timeoutSeconds: 3600,
    proof: "actual user-systemd/native/socket/cgroup oracles; unsupported environment is not a pass" },
  crash: { files: ["crash-boundaries.test.js", "global-invariants.test.js"], sourceFiles: [],
    requiredNames: ["T18", "T23", "T57", "T39", "R33 existing SIGKILL", "S-05 recovery"], environment: "systemd", timeoutSeconds: 3600,
    proof: "primitive SIGSTOP/parent-SIGKILL and restart; not an entrypoint-crash or VM-power-loss attestation" },
  property: { files: ["verification-property.test.js", "r36-model.test.js", "r36-model-mutations.test.js", "r36-parser-fuzz.test.js", "r36-lifecycle-sequences.test.js"], sourceFiles: [],
    requiredNames: ["R35 property", "R36 model seed=", "R36 parser corpus", "R36 model mutant", "R36 lifecycle replay seed=", "R36 lifecycle replay C01/C02 corpus"],
    environment: "git-fs", timeoutSeconds: 600,
    proof: "seeded independent models vs SQLite/mail and actual lifecycle retries with controlled unit effects; R33 invariants and bounded parser corpus; not kernel or provider proof" },
  stress: { files: ["verification-stress.test.js", "r36-resource-stress.test.js"], sourceFiles: [],
    requiredNames: ["R35 stress", "R36 stress native transport", "R36 stress no-progress"], environment: "git-fs", timeoutSeconds: 600,
    proof: "finite real Linux socket/pidfd/cgroup-FD and direct-child pipe cleanup, measured test RSS and queue bounds; not provider throughput, kernel quota or process-tree death certification" },
  all: { files: "all", sourceFiles: ["test/verification-policy.test.mjs", "test/exploration-policy.test.mjs", "test/traceability-policy.test.mjs",
      "test/r34-owner-policy.test.mjs", "test/production-inventory.test.mjs", "test/operation-registry-policy.test.mjs",
      "test/broker-composition-policy.test.mjs", "test/public-validation-policy.test.mjs"],
    requiredNames: ["ID-002", "T18", "T39", "AUTH-003 native", "R36 model seed=", "R36 parser corpus", "R37", "R39",
      "R25 C01/C02", "R34 C04", "R38 C05", "R36 lifecycle replay seed=", "P1 operation registry", "P1 composition root", "P1 public validation"],
    environment: "systemd", timeoutSeconds: 7200, proof: "full serial suite; each oracle retains its own proof scope" },
});
export function parseTap(raw) {
  const totals = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = /^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/.exec(line);
    if (match) totals[match[1]] = Number(match[2]);
  }
  const names = [];
  const skippedNames = [];
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*(?:not )?ok \d+(?: -)? (.+)$/.exec(line);
    if (!match) continue;
    names.push(match[1].replace(/\s+# (?:SKIP|TODO).*$/i, ""));
    if (/\s+# (?:SKIP|TODO)(?:\s|$)/i.test(match[1])) skippedNames.push(match[1]);
  }
  return { totals, names, skippedNames };
}
export function evaluateExecution({ exitCode, signal = null, tap, requiredNames = [], baselineNames }) {
  const parsed = parseTap(tap);
  const errors = [];
  if (exitCode !== 0 || signal !== null) errors.push("test-process-did-not-exit-cleanly");
  for (const key of ["tests", "pass", "fail", "cancelled", "skipped", "todo"])
    if (!Number.isSafeInteger(parsed.totals[key]) || parsed.totals[key] < 0) errors.push(`missing-or-invalid-summary:${key}`);
  if (!(parsed.totals.tests > 0)) errors.push("empty-or-unstarted-test-suite");
  if (parsed.totals.fail !== 0 || parsed.totals.cancelled !== 0) errors.push("test-failure-or-cancellation");
  if (parsed.totals.skipped !== 0 || parsed.totals.todo !== 0 || parsed.skippedNames.length !== 0) errors.push("skip-or-todo-not-permitted");
  if (parsed.totals.tests !== parsed.totals.pass + parsed.totals.fail + parsed.totals.cancelled + parsed.totals.skipped + parsed.totals.todo)
    errors.push("test-summary-does-not-balance");
  for (const required of requiredNames) if (!parsed.names.some(name => name.includes(required))) errors.push(`critical-oracle-not-executed:${required}`);
  if (baselineNames) for (const name of new Set(baselineNames)) if (!parsed.names.includes(name)) errors.push(`baseline-oracle-removed:${name}`);
  return { status: errors.length === 0 ? "PASS" : "FAIL", errors, ...parsed,
    baselineComparison: baselineNames ? "COMPARED" : "NOT_AVAILABLE" };
}
/** SIGKILL alone is not proof of reaching the intended effect boundary. */
export function validateCrashObservation({ requestedPoint, reachedPoint, signal, restarted }) {
  return typeof requestedPoint === "string" && requestedPoint.length > 0 && requestedPoint === reachedPoint && signal === "SIGKILL" && restarted === true;
}
