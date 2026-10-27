/** Required real-Darwin observations. This manifest grants no kernel support;
 * missing, failed or unexecuted rows can never become completed observations. */
export const DARWIN_CASE_REPETITIONS = 3;
export const DARWIN_PROCESS_TIMEOUT_MS = 120000;
const program = row => Object.freeze({ ...row, names: Object.freeze(row.names), link: Object.freeze(row.link ?? []) });
export const DARWIN_PROGRAMS = Object.freeze([
  program({ name: "baseline", fixture: "darwin-native-probe.c", digest: "probeDigest", compile: "compile",
    names: ["process", "files", "auth", "socket-transfer", "queued-transfer"] }),
  program({ name: "mach", fixture: "darwin-mach-probe.c", digest: "machProbeDigest", compile: "compile-mach",
    names: ["mach-self", "mach-rendezvous-live", "mach-rendezvous-exit"], link: ["-lbsm"] }),
  program({ name: "mach-stream", fixture: "darwin-mach-stream.mjs", digest: "machStreamProbeDigest", compile: "check-mach-stream", node: true,
    names: ["mach-stream-roundtrip", "mach-stream-stale", "mach-stream-handoff", "mach-audit-async"] }),
  program({ name: "seatbelt", fixture: "darwin-seatbelt.mjs", digest: "seatbeltProbeDigest", compile: "check-seatbelt", node: true,
    names: ["seatbelt-files", "seatbelt-profile-stream"] }),
  program({ name: "seatbelt-faults", fixture: "darwin-seatbelt-faults.mjs", digest: "seatbeltFaultsProbeDigest", compile: "check-seatbelt-faults", node: true,
    names: ["seatbelt-profile-header", "seatbelt-profile-magic", "seatbelt-profile-overflow",
      "seatbelt-profile-truncated", "seatbelt-profile-trailing", "seatbelt-profile-nul", "seatbelt-profile-empty",
      "seatbelt-profile-syntax", "seatbelt-argv-env", "seatbelt-trusted-preload", "seatbelt-fd-close", "seatbelt-ipc-denial"] }),
]);
const observationKeys = Object.freeze({ process: "process", files: "files", auth: "auth", "socket-transfer": "socketTransfer", "queued-transfer": "queuedTransfer",
  "mach-self": "machSelf", "mach-rendezvous-live": "machRendezvousLive", "mach-rendezvous-exit": "machRendezvousExit",
  "mach-stream-roundtrip": "machStream", "mach-stream-stale": "machStaleOrigin", "mach-stream-handoff": "machLiveHandoff", "mach-audit-async": "machAsyncAudit",
  "seatbelt-files": "seatbelt", "seatbelt-profile-stream": "seatbelt",
  "seatbelt-profile-header": "seatbeltFault", "seatbelt-profile-magic": "seatbeltFault", "seatbelt-profile-overflow": "seatbeltFault",
  "seatbelt-profile-truncated": "seatbeltFault", "seatbelt-profile-trailing": "seatbeltFault", "seatbelt-profile-nul": "seatbeltFault",
  "seatbelt-profile-empty": "seatbeltFault", "seatbelt-profile-syntax": "seatbeltFault", "seatbelt-argv-env": "seatbeltFault",
  "seatbelt-trusted-preload": "seatbeltFault", "seatbelt-fd-close": "seatbeltFault", "seatbelt-ipc-denial": "seatbeltFault" });
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
