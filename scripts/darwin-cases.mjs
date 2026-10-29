/** Required real-Darwin observations. This manifest grants no kernel support;
 * missing, failed or unexecuted rows can never become completed observations. */
import { validateDescriptorCapabilityObservation } from "./descriptor-capability-observation.mjs";
import { isIP } from "node:net";
export const DARWIN_CASE_REPETITIONS = 3;
export const DARWIN_PROCESS_TIMEOUT_MS = 120000;
const program = row => Object.freeze({ ...row, names: Object.freeze(row.names), link: Object.freeze(row.link ?? []) });
export const DARWIN_PROGRAMS = Object.freeze([
  program({ name: "baseline", fixture: "darwin-native-probe.c", digest: "probeDigest", compile: "compile",
    names: ["process", "files", "auth", "socket-transfer", "queued-transfer", "file-descriptors"] }),
  program({ name: "mach", fixture: "darwin-mach-probe.c", digest: "machProbeDigest", compile: "compile-mach",
    names: ["mach-self", "mach-rendezvous-live", "mach-rendezvous-exit", "mach-token-control"], link: ["-lbsm", "-lproc"] }),
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
    names: ["launchd-scope", "launchd-image", "launchd-bootstrap"] }),
  program({ name: "personal", fixture: "darwin-personal.mjs", digest: "personalProbeDigest", compile: "check-personal", node: true,
    names: ["personal-entry"] }),
  program({ name: "suspended-image", fixture: "darwin-suspended-image.mjs", digest: "suspendedImageProbeDigest", compile: "check-suspended-image", node: true,
    names: ["suspended-image"] }),
]);
const observationKeys = Object.freeze({ process: "process", files: "files", auth: "auth", "socket-transfer": "socketTransfer", "queued-transfer": "queuedTransfer", "file-descriptors": "fileDescriptors",
  "mach-self": "machSelf", "mach-rendezvous-live": "machRendezvousLive", "mach-rendezvous-exit": "machRendezvousExit",
  "mach-token-control": "machTokenControl",
  "mach-stream-roundtrip": "machStream", "mach-stream-stale": "machStaleOrigin", "mach-stream-handoff": "machLiveHandoff", "mach-audit-async": "machAsyncAudit",
  "seatbelt-files": "seatbelt", "seatbelt-profile-stream": "seatbelt",
  "seatbelt-signals": "seatbeltSignals",
  "seatbelt-profile-header": "seatbeltFault", "seatbelt-profile-magic": "seatbeltFault", "seatbelt-profile-overflow": "seatbeltFault",
  "seatbelt-profile-truncated": "seatbeltFault", "seatbelt-profile-trailing": "seatbeltFault", "seatbelt-profile-nul": "seatbeltFault",
  "seatbelt-profile-empty": "seatbeltFault", "seatbelt-profile-syntax": "seatbeltFault", "seatbelt-argv-env": "seatbeltFault",
  "seatbelt-trusted-preload": "seatbeltFault", "seatbelt-stdin-profile": "seatbeltFault", "seatbelt-fd-close": "seatbeltFault", "seatbelt-ipc-denial": "seatbeltFault", "seatbelt-kept-fds": "seatbeltFault",
  "git-setup-candidate": "gitSetup", "git-setup-quarantine": "gitSetup",
  "worker-bootstrap": "worker", "worker-tools": "worker",
  "launchd-scope": "launchdScope", "launchd-image": "launchdImage", "launchd-bootstrap": "launchdBootstrap",
  "personal-entry": "personal", "suspended-image": "suspendedImage" });
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
  if (name === "mach-token-control") {
    if (value.scope !== "owned-child-generation-only" || value.controllerContext !== "sibling-fork-no-profile-applied" || value.sdkInterfacePrivate !== true ||
        value.kernelTokenReceived !== true || value.unreapedPidControl !== true || value.ownedChildrenJoined !== true)
      throw new Error("generation control lacks its private SDK, kernel identity or owned-child scope");
    const pids = [value.ownerPid, value.controllerPid, value.targetPid];
    if (pids.some(pid => !Number.isSafeInteger(pid) || pid < 2) || new Set(pids).size !== pids.length ||
        !Number.isSafeInteger(value.ownerUid) || value.ownerUid < 1 ||
        value.controllerUid !== value.ownerUid || value.targetUid !== value.ownerUid ||
        !Number.isSafeInteger(value.targetPidVersion) || value.targetPidVersion < 1 || value.targetPidVersion > 0xffffffff)
      throw new Error("generation control lacks ordinary-UID nonparent and target identity controls");
    for (const key of ["zeroSignalStatus", "wrongVersionStatus", "killStatus"])
      if (!Number.isSafeInteger(value[key]) || value[key] < 0)
        throw new Error(`SDK control status must be zero or an error number: ${key}`);
    if (typeof value.exitedBeforeCleanup !== "boolean" || typeof value.numericCleanupUsed !== "boolean" ||
        value.numericCleanupUsed === value.exitedBeforeCleanup ||
        !(value.targetExitCode === null && Number.isSafeInteger(value.targetSignal) && value.targetSignal > 0 ||
          Number.isSafeInteger(value.targetExitCode) && value.targetExitCode >= 0 && value.targetSignal === null))
      throw new Error("generation control hides the actual exit or fixture-only cleanup");
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
  if (name === "launchd-scope" || name === "launchd-image" || name === "launchd-bootstrap") {
    if (value.fixtureOnly !== true || value.controlledGenerationsExited !== true ||
        value.jobRegistrationsRemoved !== true || !Array.isArray(value.cleanupFaults) || value.cleanupFaults.length !== 0)
      throw new Error("launchd observation lacks controlled generation and registration cleanup");
    if (typeof value.actorSourceSha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.actorSourceSha256))
      throw new Error("launchd actor source identity is missing");
    if (name === "launchd-bootstrap") {
      const bootstrap = value.bootstrap, modes = ["inherited", "bootstrap-only", "bootstrap-and-xpc"];
      const target = name => typeof name === "string" && name.startsWith(`${value.domain}/org.oma.probe.`);
      const outcome = result => result && Number.isSafeInteger(result.pid) && result.pid >= 0 &&
        (result.pid > 0 && Number.isSafeInteger(result.exitCode) && result.exitCode >= 0 && result.signal === null ||
          result.pid > 0 && result.exitCode === null && typeof result.signal === "string" ||
          result.exitCode === null && result.signal === null && typeof result.error === "string") &&
        typeof result.stdout === "string" && typeof result.stderr === "string";
      const portNumber = port => Number.isSafeInteger(port) && port >= 0 && port <= 0xffffffff;
      const signed32 = number => Number.isSafeInteger(number) && number >= -0x80000000 && number <= 0x7fffffff;
      const snapshot = record => record && portNumber(record.bootstrap) &&
        Array.isArray(record.registered) && record.registered.length <= 3 && record.registered.every(portNumber);
      const dns = record => record?.hostname === "example.com" &&
        (Array.isArray(record.addresses) && record.addresses.length > 0 &&
          record.addresses.every(row => [4, 6].includes(row.family) && isIP(row.address) === row.family) ||
          typeof record.error?.code === "string");
      const unix = bootstrap?.unixSocketCanary;
      const unixSocket = record => record && typeof record.created === "boolean" &&
        record.connectAttempted === record.created && [-1, 0].includes(record.connectResult) &&
        (record.created || record.connectResult === -1) &&
        [record.errno, record.connectErrno].every(number => Number.isSafeInteger(number) && number >= 0);
      const pathObservation = record => record && [-1, 0].includes(record.result) &&
        Number.isSafeInteger(record.errno) && record.errno >= 0 &&
        (record.result === -1 ? record.kind === null : ["symlink", "socket", "directory", "other"].includes(record.kind));
      const gai = record => signed32(record?.result) &&
        [record.errno, record.ipv4, record.ipv6].every(number => Number.isSafeInteger(number) && number >= 0);
      const launcher = bootstrap?.variants?.[0]?.direct?.command?.executable;
      const nativeDns = (command, record) => outcome(command) && typeof launcher === "string" && launcher.startsWith("/") &&
        command.executable === launcher && Array.isArray(command.argv) && command.argv.length === 4 &&
        command.argv[0] === "observe-dns" && typeof command.argv[1] === "string" && command.argv[1].startsWith("/") &&
        command.argv[2] === unix?.listed && command.argv[3] === unix?.unlisted &&
        (record === null && (command.exitCode !== 0 || command.signal !== null) ||
          record?.phase === "native-dns" && Number.isSafeInteger(record.pid) && record.pid > 0 && record.pid === command.pid &&
          Number.isSafeInteger(record.uid) && record.uid > 0 && record.hostname === "example.com" &&
          record.endpoint === "/var/run/mDNSResponder" && snapshot(record.ports) &&
          record.canonicalEndpoint === bootstrap.dnsResolvedEndpoint &&
          [record.socket, record.canonicalSocket, record.unixAllowlist?.listed, record.unixAllowlist?.unlisted].every(unixSocket) &&
          [record.pathMetadata?.varAlias, record.pathMetadata?.dnsAlias, record.pathMetadata?.dnsCanonical].every(pathObservation) &&
          gai(record.getaddrinfo) && signed32(record.dnssd?.createResult));
      const resolverCases = [["main", "443"], ["main", "none"], ["thread", "443"]];
      const nativeResolvers = (records, base, uid, positive = false) => Array.isArray(records) &&
        records.length === resolverCases.length && records.every((entry, index) => {
          const [context, service] = resolverCases[index], command = entry?.command, record = entry?.observation;
          return outcome(command) && command.executable === launcher && Array.isArray(command.argv) &&
            JSON.stringify(command.argv) === JSON.stringify(["observe-resolver", `${base}.resolver-${context}-${service}.json`, context, service]) &&
            (record === null && !positive && (command.exitCode !== 0 || command.signal !== null) ||
              record?.phase === "native-resolver" && record.pid === command.pid && record.pid > 0 &&
              Number.isSafeInteger(record.uid) && record.uid > 0 && record.uid === uid &&
              record.hostname === "example.com" && record.context === context && record.service === (service === "none" ? null : service) &&
              portNumber(record.globalBootstrap) && snapshot(record.ports) && gai(record.getaddrinfo) &&
              (!positive || command.exitCode === 0 && command.signal === null && record.getaddrinfo.result === 0 &&
                record.getaddrinfo.ipv4 + record.getaddrinfo.ipv6 > 0));
        });
      const machStatus = number => signed32(number) && number >= 0;
      const validName = name => portNumber(name) && name > 0 && name < 0xffffffff;
      const nodePorts = record => record && portNumber(record.globalBootstrap) && machStatus(record.globalTypeStatus) &&
        (record.globalTypeStatus === 0 ? portNumber(record.globalRights) : record.globalRights === null) &&
        machStatus(record.taskBootstrapStatus) &&
        (record.taskBootstrapStatus === 0 ? portNumber(record.taskBootstrap) : record.taskBootstrap === null) &&
        (record.taskBootstrapStatus === 0 && validName(record.taskBootstrap)
          ? machStatus(record.returnedSendStatus) : record.returnedSendStatus === null);
      const globalRestore = (record, before) => record && nodePorts(before) &&
        record.attempted === (validName(before.globalBootstrap) && before.globalTypeStatus === 0 && (before.globalRights & 0x10000) !== 0) &&
        (record.attempted ? machStatus(record.setStatus) &&
          (record.setStatus === 0 ? machStatus(record.registerStatus) : record.registerStatus === null)
          : record.setStatus === null && record.registerStatus === null);
      const nodeGlobal = (record, pid, uid, selectedTarget) => record?.phase === "node-bootstrap" &&
        Number.isSafeInteger(record.pid) && record.pid > 0 && record.pid === pid &&
        Number.isSafeInteger(record.uid) && record.uid > 0 && record.uid === uid && outcome(record.service) &&
        record.service.executable === "/bin/launchctl" &&
        JSON.stringify(record.service.argv) === JSON.stringify(["kickstart", selectedTarget]) &&
        (record.before === undefined || nodePorts(record.before)) &&
        (record.after === undefined || nodePorts(record.after)) &&
        (record.restore === undefined || globalRestore(record.restore, record.before)) &&
        (typeof record.unavailable === "string" || nodePorts(record.before) && nodePorts(record.after) &&
          globalRestore(record.restore, record.before));
      let hostDns;
      try { hostDns = JSON.parse(bootstrap?.hostDns?.stdout ?? "null"); } catch { /* Refused below, never a DNS positive. */ }
      if (bootstrap?.renderer !== "production-seatbeltProfile" ||
          ![bootstrap.sourceSha256, bootstrap.executableSha256].every(hash => typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash)) ||
          !target(bootstrap.positiveTarget) || !outcome(bootstrap.positiveKickstart) ||
          bootstrap.positiveKickstart.executable !== "/bin/launchctl" ||
          JSON.stringify(bootstrap.positiveKickstart.argv) !== JSON.stringify(["kickstart", bootstrap.positiveTarget]) ||
          bootstrap.positiveKickstart.exitCode !== 0 || !Number.isSafeInteger(bootstrap.positiveControl?.pid) ||
          bootstrap.positiveControl.pid <= 1 || !Array.isArray(bootstrap.variants) || bootstrap.variants.length !== modes.length ||
          bootstrap.variants[0]?.direct?.ports?.preExecObservation !== true ||
          bootstrap.variants[0]?.node?.ports?.preExecObservation !== true ||
          typeof bootstrap.developerTools?.git !== "string" || !bootstrap.developerTools.git.startsWith("/") ||
          !outcome(bootstrap.positiveGit) || bootstrap.positiveGit.exitCode !== 0 ||
          bootstrap.positiveGit.executable !== bootstrap.developerTools.git ||
          typeof bootstrap.gitExpected !== "string" || !/^[0-9a-f]{40}$/.test(bootstrap.gitExpected) ||
          bootstrap.positiveGit.stdout !== `${bootstrap.gitExpected}\n` ||
          typeof bootstrap.ffi?.root !== "string" || !bootstrap.ffi.root.startsWith("/") || bootstrap.ffi.root === "/" ||
          typeof bootstrap.ffi.entry !== "string" || !bootstrap.ffi.entry.startsWith(`${bootstrap.ffi.root}/`) ||
          typeof bootstrap.ffi.entrySha256 !== "string" || !/^[0-9a-f]{64}$/.test(bootstrap.ffi.entrySha256) ||
          typeof unix?.directory !== "string" || !unix.directory.startsWith("/") || unix.directory.includes("\0") ||
          unix.listed !== `${unix.directory}/allowed` || unix.unlisted !== `${unix.directory}/denied` ||
          bootstrap.dnsEndpoint !== "/var/run/mDNSResponder" ||
          typeof bootstrap.dnsResolvedEndpoint !== "string" || !bootstrap.dnsResolvedEndpoint.startsWith("/") ||
          !outcome(bootstrap.hostDns) || bootstrap.hostDns.exitCode !== 0 ||
          !dns(hostDns) || hostDns.error !== undefined ||
          !nativeDns(bootstrap.nativeDnsHostCommand, bootstrap.nativeDnsHost) || bootstrap.nativeDnsHostCommand.exitCode !== 0 ||
          bootstrap.nativeDnsHost?.socket.created !== true || bootstrap.nativeDnsHost.socket.connectResult !== 0 ||
          bootstrap.nativeDnsHost.canonicalSocket.created !== true || bootstrap.nativeDnsHost.canonicalSocket.connectResult !== 0 ||
          bootstrap.nativeDnsHost.unixAllowlist.listed.created !== true || bootstrap.nativeDnsHost.unixAllowlist.listed.connectResult !== 0 ||
          bootstrap.nativeDnsHost.unixAllowlist.unlisted.created !== true || bootstrap.nativeDnsHost.unixAllowlist.unlisted.connectResult !== 0 ||
          bootstrap.nativeDnsHost.dnssd.createResult !== 0 || bootstrap.nativeDnsHost.getaddrinfo.result !== 0 ||
          bootstrap.nativeDnsHost.getaddrinfo.ipv4 + bootstrap.nativeDnsHost.getaddrinfo.ipv6 <= 0 ||
          !nativeResolvers(bootstrap.nativeResolverHost, bootstrap.nativeDnsHostCommand.argv[1], bootstrap.nativeDnsHost.uid, true))
        throw new Error("bootstrap observation lacks a production profile, source or actual independent host positive");
      const targets = new Set([bootstrap.positiveTarget]);
      for (const [index, variant] of bootstrap.variants.entries()) {
        if (variant.name !== modes[index] || typeof variant.canaryPreserved !== "boolean" ||
            typeof variant.profileSha256 !== "string" || !/^[0-9a-f]{64}$/.test(variant.profileSha256))
          throw new Error("bootstrap variants omit or relabel a rights/compatibility outcome");
        for (const key of ["direct", "node", "restored"]) {
          const attempt = variant[key], ports = attempt?.ports;
          if (!target(attempt?.target) || targets.has(attempt.target) || !outcome(attempt.command) ||
              !Array.isArray(attempt.command.argv) || attempt.command.argv[0] !== variant.name ||
              !(attempt.guestEffect === null || Number.isSafeInteger(attempt.guestEffect?.pid) && attempt.guestEffect.pid > 1) ||
              !(ports === null && (attempt.command.exitCode !== 0 || attempt.command.signal !== null) ||
                ports?.mode === variant.name && ports.sandboxApplied === true && ports.preExecObservation === true &&
                ports.pid === attempt.command.pid && Number.isSafeInteger(ports.uid) && ports.uid > 0 &&
                snapshot(ports.before) && snapshot(ports.after) && Array.isArray(ports.droppedSendRights) &&
                ports.droppedSendRights.every(portNumber)))
            throw new Error("bootstrap attempt loses its actual sandbox, rights, command, target or exit outcome");
          targets.add(attempt.target);
          if (key === "node") {
            if (!target(attempt.globalTarget) || targets.has(attempt.globalTarget) ||
                !(attempt.globalGuestEffect === null || Number.isSafeInteger(attempt.globalGuestEffect?.pid) && attempt.globalGuestEffect.pid > 1))
              throw new Error("Node global-bootstrap control is not a separate actual service target");
            targets.add(attempt.globalTarget);
          }
          if (key === "direct" &&
              JSON.stringify(attempt.command.argv.slice(4)) !== JSON.stringify(["/bin/launchctl", "kickstart", attempt.target]))
            throw new Error("direct bootstrap service outcome belongs to a different target");
          if (key === "node" &&
              (attempt.command.argv[6] !== attempt.target || attempt.command.argv[9] !== bootstrap.developerTools.git ||
                attempt.command.argv[11] !== launcher ||
                attempt.command.argv[12] !== unix.listed || attempt.command.argv[13] !== unix.unlisted ||
                attempt.command.argv[15] !== attempt.globalTarget ||
                !(attempt.tools === null && (attempt.command.exitCode !== 0 || attempt.command.signal !== null) ||
                  attempt.tools?.pid === ports?.pid && typeof attempt.tools?.complete === "boolean" &&
                  (attempt.tools.service === undefined && attempt.tools.complete === false ||
                    attempt.tools.service?.executable === "/bin/launchctl" &&
                    JSON.stringify(attempt.tools.service.argv) === JSON.stringify(["kickstart", attempt.target])))))
            throw new Error("bootstrap Node compatibility outcome is absent or belongs to a different process/target");
          if (key === "node" && attempt.tools?.complete &&
              (!outcome(attempt.tools.git) || attempt.tools.git.executable !== bootstrap.developerTools.git ||
                !outcome(attempt.tools.compiler) || !dns(attempt.tools.dns) ||
                !nativeDns(attempt.tools.nativeDnsCommand, attempt.tools.nativeDns) ||
                attempt.tools.nativeDns !== null && attempt.tools.nativeDns.uid !== ports?.uid ||
                !nativeResolvers(attempt.tools.resolvers, attempt.tools.nativeDnsCommand.argv[1], ports?.uid) ||
                !nodeGlobal(attempt.tools.bootstrapGlobal, ports?.pid, ports?.uid, attempt.globalTarget)))
            throw new Error("completed Node observation omits actual selected Git, compiler or DNS outcomes");
          if (key === "restored") {
            const restoration = attempt.restoration;
            if (JSON.stringify(attempt.command.argv.slice(5, 6)) !== JSON.stringify(["restore-registered-seed"]) ||
                JSON.stringify(attempt.command.argv.slice(7)) !== JSON.stringify(["/bin/launchctl", "kickstart", attempt.target]) ||
                !(restoration === null && (attempt.command.exitCode !== 0 || attempt.command.signal !== null) ||
                  restoration?.phase === "restore-registered-seed" && Number.isSafeInteger(restoration.pid) &&
                  restoration.pid > 0 && restoration.pid === ports?.pid && restoration.uid === ports?.uid &&
                  portNumber(restoration.seed) && snapshot(restoration.before) && snapshot(restoration.after) &&
                  restoration.seed === (restoration.before.registered[0] ?? 0) &&
                  (restoration.attempted === true && restoration.seed > 0 && restoration.seed !== 0xffffffff &&
                    signed32(restoration.setStatus) ||
                    restoration.attempted === false && [0, 0xffffffff].includes(restoration.seed) && restoration.setStatus === null)))
              throw new Error("registered-seed restoration loses its actual call, process, target or capability outcome");
          }
        }
      }
    }
    if (name === "launchd-image" && (value.matchingA?.variant !== 1 || value.matchingB?.variant !== 2 ||
        !Array.isArray(value.cdhashes) || value.cdhashes.length !== 2 ||
        value.cdhashes.some(hash => typeof hash !== "string" || !/^[0-9a-f]{40}$/.test(hash)) ||
        value.cdhashes[0] === value.cdhashes[1] || typeof value.replacedImage?.markerAfterTwoSeconds !== "boolean"))
      throw new Error("launchd image observation lacks distinct executed positive controls or image outcome");
    if (name === "launchd-scope" && value.scope?.afterBootout?.otherAcknowledged !== true)
      throw new Error("launchd scope observation lacks its independent live job control");
    if (name === "launchd-scope") {
      const scope = value.scope, admission = scope.admission, exit = scope.afterControlledExit;
      const decimal = text => typeof text === "string" && /^[0-9]+$/.test(text);
      const query = result => result && typeof result.available === "boolean" &&
        [0, -1].includes(result.returnCode) && Number.isSafeInteger(result.errno) &&
        (result.returnCode === 0 ? result.available && result.errno === 0 : result.errno > 0) &&
        decimal(result.started) && decimal(result.exited);
      const pairs = record => Array.isArray(record?.samples) && record.samples.length > 0 &&
        record.samples.every(sample => Number.isFinite(sample.elapsedMs) && sample.elapsedMs >= 0 &&
          query(sample.aggregate) && query(sample.otherAggregate));
      if (exit?.controlledGenerationsExited !== true || !pairs(exit))
        throw new Error("launchd scope lacks paired post-exit kernel queries");
      if (admission?.privateInterface !== true || typeof admission.available !== "boolean" ||
          !Number.isSafeInteger(admission.uid) || admission.uid <= 0 ||
          !decimal(admission.callerResource) || admission.callerResource === "0" ||
          admission.callerResource !== scope.members?.leader?.resource ||
          !decimal(scope.control?.resource) || scope.control.resource === "0" ||
          scope.control.resource === admission.callerResource ||
          !Array.isArray(admission.attempts) || admission.attempts.length !== 3)
        throw new Error("launchd scope lacks ordinary-UID adversarial admission controls");
      const names = ["inherited", "explicit-own", "explicit-other"];
      const requested = ["0", admission.callerResource, scope.control.resource];
      for (const [index, attempt] of admission.attempts.entries()) {
        if (attempt.name !== names[index] || attempt.requestedResource !== requested[index] ||
            !Number.isSafeInteger(attempt.attributeStatus) || attempt.attributeStatus < 0 ||
            !Number.isSafeInteger(attempt.spawnStatus) || attempt.spawnStatus < -1 ||
            (attempt.attributeStatus === 0 ? attempt.spawnStatus < 0 : attempt.spawnStatus !== -1) ||
            !admission.available && index > 0 && attempt.attributeStatus === 0 ||
            !Number.isSafeInteger(attempt.pid) || typeof attempt.stopped !== "boolean" ||
            typeof attempt.joined !== "boolean" ||
            (attempt.spawnStatus === 0 ? attempt.pid <= 1 || !attempt.joined :
              attempt.pid !== 0 || attempt.stopped || attempt.joined) ||
            !Number.isSafeInteger(attempt.coalitionBytes) || attempt.coalitionBytes < 0 ||
            !Number.isSafeInteger(attempt.coalitionErrno) || attempt.coalitionErrno < 0 ||
            !decimal(attempt.actualResource) || !Number.isSafeInteger(attempt.waitStatus) || attempt.waitStatus < 0)
          throw new Error("launchd admission loses its actual API result, cohort or owned-child cleanup");
      }
      const recovery = scope.recovery;
      if (recovery?.context !== "fresh-exec-no-profile-applied" || recovery.tokenSource !== "kernel-task-name-port" ||
          recovery.fixtureReleaseUsedBeforeObservation !== false || !pairs(recovery.afterAttempt))
        throw new Error("launchd scope loses fresh kernel-token recovery before fixture cleanup");
      const snapshot = result => result && Number.isSafeInteger(result.bytes) && result.bytes >= 0 &&
        Number.isSafeInteger(result.errno) && result.errno >= 0 && decimal(result.unique) &&
        Number.isSafeInteger(result.version) && result.version >= -2147483648 && result.version <= 2147483647;
      function validateMemberControl(result, pid) {
        if (!result || !Number.isSafeInteger(pid) || pid <= 1 || result.targetPid !== pid ||
            result.expectedResource !== admission.callerResource || typeof result.correlated !== "boolean" ||
            !Number.isSafeInteger(result.controllerPid) || result.controllerPid <= 1 || result.controllerPid === pid ||
            result.controllerUid !== admission.uid || !snapshot(result.before) || !snapshot(result.after) ||
            !Number.isSafeInteger(result.membership?.bytes) || result.membership.bytes < 0 ||
            !Number.isSafeInteger(result.membership.errno) || result.membership.errno < 0 ||
            !decimal(result.membership.resource) ||
            ["taskNameStatus", "taskInfoStatus", "namePortReleaseStatus", "signalStatus"].some(field =>
              !Number.isSafeInteger(result[field]) || result[field] < -1) ||
            ["auditCount", "auditPid", "auditUid", "auditPidVersion"].some(field =>
              !Number.isSafeInteger(result[field]) || result[field] < 0) ||
            (result.correlated ? result.signalStatus < 0 : result.signalStatus !== -1))
          throw new Error("launchd member control lacks actual acquisition or effect state");
        if (result.correlated && (result.before.bytes !== 56 || result.before.errno !== 0 ||
            result.after.bytes !== 56 || result.after.errno !== 0 || result.before.unique === "0" ||
            result.before.unique !== result.after.unique || result.before.version === 0 ||
            result.before.version !== result.after.version || result.membership.bytes !== 40 ||
            result.membership.errno !== 0 || result.membership.resource !== result.expectedResource ||
            result.taskNameStatus !== 0 || result.taskInfoStatus !== 0 || result.namePortReleaseStatus !== 0 ||
            result.auditCount !== 8 || result.auditPid !== pid || result.auditUid !== result.controllerUid ||
            result.auditPidVersion !== (result.before.version >>> 0)))
          throw new Error("launchd member effect is not correlated with one kernel generation and coalition");
      }
      validateMemberControl(recovery.wrongMember, scope.control.pid);
      validateMemberControl(recovery.remainingMember, scope.members?.detached?.pid);
      const seatbelt = scope.seatbelt, service = seatbelt?.attempt;
      const launchctlResult = (result, command, target) => result?.executable === "/bin/launchctl" &&
        Array.isArray(result.argv) && result.argv.length === 2 && result.argv[0] === command && result.argv[1] === target &&
        Number.isSafeInteger(result.exitCode) && result.signal === null &&
        typeof result.stdout === "string" && typeof result.stderr === "string";
      if (seatbelt?.renderer !== "production-seatbeltProfile" ||
          typeof seatbelt.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(seatbelt.sha256) ||
          scope.members?.detached?.sandboxed !== true || scope.late?.sandboxed !== true ||
          scope.discoveryRecovery?.afterSnapshot?.sandboxed !== true ||
          typeof seatbelt.serviceTarget !== "string" || !seatbelt.serviceTarget.startsWith(`${value.domain}/`) ||
          typeof seatbelt.positiveServiceTarget !== "string" || !seatbelt.positiveServiceTarget.startsWith(`${value.domain}/`) ||
          seatbelt.positiveServiceTarget === seatbelt.serviceTarget ||
          !launchctlResult(seatbelt.positiveServiceKickstart, "kickstart", seatbelt.positiveServiceTarget) ||
          seatbelt.positiveServiceKickstart.exitCode !== 0 ||
          !launchctlResult(seatbelt.positiveServiceAfter, "print", seatbelt.positiveServiceTarget) ||
          !launchctlResult(seatbelt.serviceBefore, "print", seatbelt.serviceTarget) ||
          !Number.isSafeInteger(seatbelt.positiveServiceControl?.pid) || seatbelt.positiveServiceControl.pid <= 1 ||
          service?.sandboxApplied !== true || service.target !== seatbelt.serviceTarget ||
          !Number.isSafeInteger(service.spawnStatus) || service.spawnStatus < 0 ||
          !Number.isSafeInteger(service.childPid) || !Number.isSafeInteger(service.waitStatus) || service.waitStatus < 0 ||
          typeof service.joined !== "boolean" || typeof service.numericCleanupUsed !== "boolean" ||
          (service.spawnStatus === 0 ? service.childPid <= 1 || !service.joined :
            service.childPid !== 0 || service.joined || service.waitStatus !== 0 || service.numericCleanupUsed) ||
          !launchctlResult(seatbelt.serviceAfter, "print", seatbelt.serviceTarget) ||
          !(seatbelt.guestEffect === null ||
            Number.isSafeInteger(seatbelt.guestEffect?.pid) && seatbelt.guestEffect.pid > 1))
        throw new Error("launchd scope lacks the actual production sandbox and controlled service-admission outcome");
      const discovery = scope.discoveryRecovery;
      if (discovery?.input !== "resource-coalition-only" || discovery.beforeFixtureRelease !== true ||
          !Number.isSafeInteger(scope.late?.pid) || scope.late.pid <= 1 ||
          !Number.isSafeInteger(discovery.afterSnapshot?.pid) || discovery.afterSnapshot.pid <= 1 ||
          !decimal(discovery.afterSnapshot.resource) || !Array.isArray(discovery.rounds) ||
          !pairs({ samples: discovery.rounds }))
        throw new Error("launchd recovery lacks post-owner and post-snapshot births with paired kernel queries");
      for (const round of discovery.rounds) {
        const hint = round.discovery;
        if (hint?.hintOnly !== true || hint.resource !== admission.callerResource ||
            !Number.isSafeInteger(hint.capacity) || hint.capacity < 0 ||
            !Number.isSafeInteger(hint.listed) || hint.listed < -1 ||
            !Number.isSafeInteger(hint.errno) || hint.errno < 0 ||
            !Number.isSafeInteger(hint.unreadable) || hint.unreadable < 0 ||
            hint.saturated !== (hint.capacity > 0 && hint.listed >= hint.capacity) ||
            !Array.isArray(hint.candidatePids) || hint.candidatePids.length > Math.max(0, Math.min(hint.listed, hint.capacity)) ||
            hint.candidatePids.some(pid => !Number.isSafeInteger(pid) || pid <= 1) ||
            !Array.isArray(round.controls) || round.controls.length !== hint.candidatePids.length)
          throw new Error("launchd discovery turns an incomplete PID hint scan into scope evidence");
        for (const [index, result] of round.controls.entries())
          validateMemberControl(result, hint.candidatePids[index]);
      }
    }
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
      if (!attempt || attempt.stopped !== true || !Number.isSafeInteger(attempt.stopSignal) || attempt.stopSignal < 0 ||
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
