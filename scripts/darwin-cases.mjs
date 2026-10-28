/** Required real-Darwin observations. This manifest grants no kernel support;
 * missing, failed or unexecuted rows can never become completed observations. */
import { validateDescriptorCapabilityObservation } from "./descriptor-capability-observation.mjs";
export const DARWIN_CASE_REPETITIONS = 3;
export const DARWIN_PROCESS_TIMEOUT_MS = 120000;
const program = row => Object.freeze({ ...row, names: Object.freeze(row.names), link: Object.freeze(row.link ?? []) });
export const DARWIN_PROGRAMS = Object.freeze([
  program({ name: "baseline", fixture: "darwin-native-probe.c", digest: "probeDigest", compile: "compile",
    names: ["process", "files", "auth", "socket-transfer", "queued-transfer", "file-descriptors"] }),
  program({ name: "mach", fixture: "darwin-mach-probe.c", digest: "machProbeDigest", compile: "compile-mach",
    names: ["mach-self", "mach-rendezvous-live", "mach-rendezvous-exit"], link: ["-lbsm"] }),
  program({ name: "mach-stream", fixture: "darwin-mach-stream.mjs", digest: "machStreamProbeDigest", compile: "check-mach-stream", node: true,
    names: ["mach-stream-roundtrip", "mach-stream-stale", "mach-stream-handoff", "mach-audit-async"] }),
  program({ name: "seatbelt", fixture: "darwin-seatbelt.mjs", digest: "seatbeltProbeDigest", compile: "check-seatbelt", node: true,
    names: ["seatbelt-files", "seatbelt-profile-stream"] }),
  program({ name: "seatbelt-faults", fixture: "darwin-seatbelt-faults.mjs", digest: "seatbeltFaultsProbeDigest", compile: "check-seatbelt-faults", node: true,
    names: ["seatbelt-profile-header", "seatbelt-profile-magic", "seatbelt-profile-overflow",
      "seatbelt-profile-truncated", "seatbelt-profile-trailing", "seatbelt-profile-nul", "seatbelt-profile-empty",
      "seatbelt-profile-syntax", "seatbelt-argv-env", "seatbelt-trusted-preload", "seatbelt-stdin-profile", "seatbelt-fd-close", "seatbelt-ipc-denial", "seatbelt-kept-fds"] }),
  program({ name: "seatbelt-signals", fixture: "darwin-seatbelt-signals.c", digest: "seatbeltSignalsProbeDigest",
    compile: "compile-seatbelt-signals", names: ["seatbelt-signals"], link: ["-lsandbox"] }),
  program({ name: "git-setup", fixture: "darwin-git-setup.mjs", digest: "gitSetupProbeDigest", compile: "check-git-setup", node: true,
    names: ["git-setup-candidate", "git-setup-quarantine"] }),
  program({ name: "worker", fixture: "darwin-worker.mjs", digest: "workerProbeDigest", compile: "check-worker", node: true,
    names: ["worker-bootstrap", "worker-tools"] }),
  program({ name: "launchd", fixture: "darwin-launchd.mjs", digest: "launchdProbeDigest", compile: "check-launchd", node: true,
    names: ["launchd-scope", "launchd-image"] }),
  program({ name: "personal", fixture: "darwin-personal.mjs", digest: "personalProbeDigest", compile: "check-personal", node: true,
    names: ["personal-entry"] }),
  program({ name: "suspended-image", fixture: "darwin-suspended-image.mjs", digest: "suspendedImageProbeDigest", compile: "check-suspended-image", node: true,
    names: ["suspended-image"] }),
]);
const observationKeys = Object.freeze({ process: "process", files: "files", auth: "auth", "socket-transfer": "socketTransfer", "queued-transfer": "queuedTransfer", "file-descriptors": "fileDescriptors",
  "mach-self": "machSelf", "mach-rendezvous-live": "machRendezvousLive", "mach-rendezvous-exit": "machRendezvousExit",
  "mach-stream-roundtrip": "machStream", "mach-stream-stale": "machStaleOrigin", "mach-stream-handoff": "machLiveHandoff", "mach-audit-async": "machAsyncAudit",
  "seatbelt-files": "seatbelt", "seatbelt-profile-stream": "seatbelt",
  "seatbelt-signals": "seatbeltSignals",
  "seatbelt-profile-header": "seatbeltFault", "seatbelt-profile-magic": "seatbeltFault", "seatbelt-profile-overflow": "seatbeltFault",
  "seatbelt-profile-truncated": "seatbeltFault", "seatbelt-profile-trailing": "seatbeltFault", "seatbelt-profile-nul": "seatbeltFault",
  "seatbelt-profile-empty": "seatbeltFault", "seatbelt-profile-syntax": "seatbeltFault", "seatbelt-argv-env": "seatbeltFault",
  "seatbelt-trusted-preload": "seatbeltFault", "seatbelt-stdin-profile": "seatbeltFault", "seatbelt-fd-close": "seatbeltFault", "seatbelt-ipc-denial": "seatbeltFault", "seatbelt-kept-fds": "seatbeltFault",
  "git-setup-candidate": "gitSetup", "git-setup-quarantine": "gitSetup",
  "worker-bootstrap": "worker", "worker-tools": "worker",
  "launchd-scope": "launchdScope", "launchd-image": "launchdImage", "personal-entry": "personal", "suspended-image": "suspendedImage" });
export function darwinCasePlan() {
  return DARWIN_PROGRAMS.flatMap(program => Array.from({ length: DARWIN_CASE_REPETITIONS }, (_, iteration) =>
    program.names.map(name => {
      if (!Object.hasOwn(observationKeys, name)) throw new Error(`Darwin observation key is undeclared: ${name}`);
      return { program: program.name, name, iteration, observation: observationKeys[name] };
    }))).flat();
}
export function validateDarwinObservation(name, observations) {
  const expected = darwinCasePlan().find(row => row.name === name);
  if (!expected || !observations || typeof observations !== "object" || Array.isArray(observations) ||
      Object.keys(observations).length !== 1 || !Object.hasOwn(observations, expected.observation))
    throw new Error("probe case/observation mismatch");
  const value = observations[expected.observation];
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length === 0)
    throw new Error("probe observation is empty or malformed");
  if (name === "file-descriptors") {
    validateDescriptorCapabilityObservation(value);
    if (value.platform !== "darwin") throw new Error("descriptor observation did not run on Darwin");
  }
  if (name === "seatbelt-kept-fds") {
    for (const key of ["exactChannelsRetained", "stdinTransportRetainedSameChannels", "extraCanaryDetectedInControl",
      "malformedPolicyRefused", "directChildrenClosed", "samePidAfterExec", "loweredHardLimitPruned",
      "stdioCloexecRetained", "emptyKeepListPruned", "missingChannelRefused", "missingTargetRefused"])
      if (value[key] !== true) throw new Error(`descriptor inheritance control is missing: ${key}`);
    for (const key of ["actorSha256", "pruneControlSha256"])
      if (typeof value[key] !== "string" || !/^[0-9a-f]{64}$/.test(value[key]))
        throw new Error(`descriptor control executable identity is missing: ${key}`);
  }
  if (name === "seatbelt-signals") {
    if (value.unreapedPidControl !== true || value.ownedChildrenJoined !== true)
      throw new Error("signal identity observation lacks owned PID and join controls");
    for (const key of ["inherited", "fresh", "afterNested"]) {
      const signal = value[key];
      if (!signal || !Number.isSafeInteger(signal.errno) ||
          !(signal.returnCode === 0 && signal.errno === 0 && signal.delivered === true ||
            signal.returnCode === -1 && signal.errno > 0 && signal.delivered === false))
        throw new Error(`signal delivery observation is incomplete: ${key}`);
    }
    if (value.inherited.returnCode !== 0 ||
        ![0, -1].includes(value.nestedApplyReturnCode) ||
        !Number.isSafeInteger(value.nestedApplyErrno) || value.nestedApplyErrno < 0 ||
        value.nestedApplyReturnCode === 0 && value.nestedApplyErrno !== 0)
      throw new Error("signal identity observation lacks its inherited positive control or nested apply result");
  }
  if (name === "launchd-scope" || name === "launchd-image") {
    if (value.fixtureOnly !== true || value.controlledGenerationsExited !== true ||
        value.jobRegistrationsRemoved !== true || !Array.isArray(value.cleanupFaults) || value.cleanupFaults.length !== 0)
      throw new Error("launchd observation lacks controlled generation and registration cleanup");
    if (typeof value.actorSourceSha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.actorSourceSha256))
      throw new Error("launchd actor source identity is missing");
    if (name === "launchd-image" && (value.matchingA?.variant !== 1 || value.matchingB?.variant !== 2 ||
        !Array.isArray(value.cdhashes) || value.cdhashes.length !== 2 ||
        value.cdhashes.some(hash => typeof hash !== "string" || !/^[0-9a-f]{40}$/.test(hash)) ||
        value.cdhashes[0] === value.cdhashes[1] || typeof value.replacedImage?.markerAfterTwoSeconds !== "boolean"))
      throw new Error("launchd image observation lacks distinct executed positive controls or image outcome");
    if (name === "launchd-scope" && value.scope?.afterBootout?.otherAcknowledged !== true)
      throw new Error("launchd scope observation lacks its independent live job control");
  }
  if (name === "suspended-image") {
    if (value.fixtureOnly !== true || value.scope !== "main-image-only" ||
        value.unreapedPidControl !== true || value.ownedChildrenJoined !== true ||
        value.scriptRequirementNamesInterpreter !== true)
      throw new Error("suspended image observation lacks owned-child or interpreter scope controls");
    for (const source of ["controller", "target"])
      if (typeof value.sourceSha256?.[source] !== "string" || !/^[0-9a-f]{64}$/.test(value.sourceSha256[source]))
        throw new Error("suspended image source identity is missing");
    const signatures = [value.images?.a, value.images?.b, ...["node", "git", "compiler", "shell"].map(key => value.tools?.[key])];
    for (const signature of signatures)
      if (!signature || typeof signature.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(signature.sha256) ||
          !Array.isArray(signature.cdhashes) || signature.cdhashes.length === 0 ||
          signature.cdhashes.some(hash => typeof hash !== "string" || !/^[0-9a-f]{40}$/.test(hash)))
        throw new Error("suspended image expected executable hashes are missing");
    if (value.images.a.cdhashes.some(hash => value.images.b.cdhashes.includes(hash)))
      throw new Error("suspended image positive controls do not identify distinct images");
    const attempts = ["a", "b", "node", "git", "compiler", "script"].map(key => value.positive?.[key]);
    attempts.push(value.mismatch, value.restoredPath);
    for (const attempt of attempts) {
      if (!attempt || attempt.stopped !== true || !Number.isSafeInteger(attempt.stopSignal) || attempt.stopSignal < 1 ||
          attempt.childReaped !== true || attempt.supervisorJoined !== true ||
          attempt.beforeRelease?.constructor !== false || attempt.beforeRelease?.main !== false ||
          attempt.beforeRelease?.stdoutBytes !== 0 || attempt.beforeRelease?.stderrBytes !== 0 ||
          !Number.isSafeInteger(attempt.copyStatus))
        throw new Error("suspended image observation lacks stopped, silent and joined child controls");
      const checks = attempt.copyStatus === 0 ? [attempt.primary] : [];
      if (attempt === value.mismatch || attempt === value.restoredPath) {
        if (attempt.copyStatus === 0) checks.push(attempt.alternate);
      }
      if (attempt.copyStatus !== 0 && (attempt.primary !== null || attempt.alternate !== null))
        throw new Error("suspended image validation was reported without a code reference");
      for (const check of checks)
        if (!check || !Number.isSafeInteger(check.parseStatus) ||
            (check.parseStatus === 0 ? !Number.isSafeInteger(check.validationStatus) : check.validationStatus !== null))
          throw new Error("suspended image requirement validation is missing");
      const matched = attempt.copyStatus === 0 && attempt.primary.parseStatus === 0 && attempt.primary.validationStatus === 0;
      if (attempt.released !== matched || (matched ? attempt.exitCode !== 0 || attempt.signal !== null : attempt.exitCode !== null || attempt.signal !== 9))
        throw new Error("suspended image release or refusal contradicts actual validation");
    }
    for (const attempt of attempts.slice(0, 6))
      if (!attempt.released) throw new Error("suspended image executable positive control did not run");
    for (const [key, variant] of [["a", 1], ["b", 2]]) {
      const attempt = value.positive[key];
      if (attempt.constructor?.variant !== variant || attempt.main?.variant !== variant ||
          !Number.isSafeInteger(attempt.main.pid) || attempt.main.pid < 2 || attempt.constructor.pid !== attempt.main.pid)
        throw new Error("suspended image constructor/main positive controls are missing");
    }
    if (value.positive.node.main?.kind !== "node" || value.positive.script.main?.kind !== "script" ||
        typeof value.positive.git.targetStdout !== "string" || !/^git version /.test(value.positive.git.targetStdout) ||
        typeof value.positive.compiler.targetStdout !== "string" || !/clang version/.test(value.positive.compiler.targetStdout))
      throw new Error("suspended image normal tool contexts are missing");
    for (const attempt of [value.mismatch, value.restoredPath])
      if (attempt.released ? attempt.constructor?.variant !== 2 || attempt.main?.variant !== 2 : attempt.constructor !== null || attempt.main !== null)
        throw new Error("suspended image substitution outcome is unobserved");
  }
  if (name === "personal-entry") {
    for (const key of ["actualTerminal", "cleanExit", "terminalRestored", "noSocietyProvisioned", "societyRefusedBeforeState"])
      if (value[key] !== true) throw new Error(`Personal observation lacks a product control: ${key}`);
    if (value.birthMode !== "personal" || typeof value.birthCwd !== "string" || !value.birthCwd.startsWith("/") ||
        value.input !== "ctrl-d" || value.credentialFixture !== false)
      throw new Error("Personal observation lacks actual birth, input or credential provenance");
  }
}
export function validateDarwinCaseSet(cases) {
  const expected = new Map(darwinCasePlan().map(row => [`${row.name}:${row.iteration}`, row]));
  if (!Array.isArray(cases) || cases.length !== expected.size) throw new Error("required Darwin attempts are missing or extra");
  const seen = new Set();
  for (const row of cases) {
    if (!row || typeof row !== "object") throw new Error("Darwin attempt is malformed");
    const key = `${row.name}:${row.iteration}`, wanted = expected.get(key);
    if (!wanted || seen.has(key) || row.program !== wanted.program || row.iteration !== wanted.iteration)
      throw new Error("Darwin attempt is unknown, duplicate or misattributed");
    seen.add(key);
    if (!["OBSERVED", "SETUP_FAILED"].includes(row.status)) throw new Error("Darwin attempt status is invalid");
    if (row.status === "OBSERVED") {
      if (row.execution !== "EXECUTED" || row.exitCode !== 0 || row.signal !== null || row.error !== undefined ||
          row.cleanup !== "returned" || row.cleanupError !== undefined || row.artifactError !== undefined)
        throw new Error("a failed or unexecuted Darwin attempt cannot be an observation");
      validateDarwinObservation(row.name, row.observations);
    }
  }
}
/** Budget only: every child and compilation may consume its complete ceiling.
 * Install/build, final credential compile and artifact upload are additional. */
export function darwinDriverBudgetSeconds() {
  return (darwinCasePlan().length + DARWIN_PROGRAMS.length + 3) * DARWIN_PROCESS_TIMEOUT_MS / 1000;
}
