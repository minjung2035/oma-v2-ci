/** Verification tooling, not production runtime. Commands run only when invoked. */
export const lanes = Object.freeze({
  fast: { files: ["domain-identifiers.test.js", "domain-policy.test.js", "id-contracts.test.js", "r27-resource-phases.test.js", "r29-reconcile-accounting.test.js"],
    sourceFiles: ["test/verification-policy.test.mjs"], requiredNames: ["ID-002", "R27", "R29"], environment: "node", timeoutSeconds: 600,
    proof: "type/schema/AST and deterministic domain behavior" },
  durable: { files: ["durable-boundary.test.js", "mail-integrity.test.js", "mail-recovery-integrity.test.js", "context-file-identity.test.js"],
    sourceFiles: [], requiredNames: [], environment: "git-fs", timeoutSeconds: 1200, proof: "real SQLite/Git/filesystem, not systemd or power loss" },
  kernel: { files: ["audit.test.js", "audit2.test.js", "phase4.test.js", "phase5.test.js", "peer-pid.test.js", "native-leaf.test.js", "runner-channel.test.js", "compliance.test.js"],
    sourceFiles: [], requiredNames: ["AUTH-003 native", "UNIT-004"], environment: "systemd", timeoutSeconds: 3600,
    proof: "actual user-systemd/native/socket/cgroup oracles; unsupported environment is not a pass" },
  crash: { files: ["crash-boundaries.test.js", "global-invariants.test.js"], sourceFiles: [],
    requiredNames: ["T18", "T23", "T57", "T39", "R33 existing SIGKILL", "S-05 recovery"], environment: "systemd", timeoutSeconds: 3600,
    proof: "primitive SIGSTOP/parent-SIGKILL and restart; not an entrypoint-crash or VM-power-loss attestation" },
  property: { files: ["verification-property.test.js"], sourceFiles: [], requiredNames: ["R35 property"], environment: "node", timeoutSeconds: 600,
    proof: "reproducible bounded input corpus; seeds and case counts appear in test names" },
  stress: { files: ["verification-stress.test.js"], sourceFiles: [], requiredNames: ["R35 stress"], environment: "node", timeoutSeconds: 600,
    proof: "bounded transport/domain stress only; not provider throughput or kernel quota certification" },
  all: { files: "all", sourceFiles: ["test/verification-policy.test.mjs"], requiredNames: ["ID-002", "T18", "T39", "AUTH-003 native"],
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
