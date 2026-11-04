/** Required real-Darwin observations. This manifest grants no kernel support;
 * missing, failed or unexecuted rows can never become completed observations. */
import { validateDescriptorCapabilityObservation } from "./descriptor-capability-observation.mjs";
import { isIP } from "node:net";
import { createHash } from "node:crypto";
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
  if (name === "mach-audit-async" && value.selectedImage !== undefined) {
    const image = value.selectedImage;
    if (![image.ownHash, image.otherHash].every(hash => typeof hash === "string" && /^[0-9a-f]{40}$/.test(hash)) ||
        image.ownHash === image.otherHash || image.requirementFrozenBeforeAwait !== true || image.matched !== true ||
        image.mismatch?.kind !== "unavailable" || !Number.isInteger(image.mismatch.osStatus) || image.mismatch.osStatus === 0)
      throw new Error("audit main-image comparison loses its selected identity, frozen requirement or signed negative control");
  }
  if (name === "mach-audit-async" && value.fileport !== undefined)
    for (const key of ["sourceClosedBeforeSend", "sameInode", "exactBytes", "sharedCursor", "ordinaryPortRefused"])
      if (value.fileport[key] !== true) throw new Error(`fileport handoff loses its actual descriptor control: ${key}`);
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
      const layoutKeys = ["size", "pointerBytes", "intBytes", "flags", "family", "socktype", "protocol", "next",
        "afUnspec", "afInet", "afInet6", "sockStream"];
      const layout = bootstrap?.nativeDnsHost?.addrinfoLayout;
      const abi = value => value && layoutKeys.every(key => Number.isSafeInteger(value[key])) &&
        value.size >= 24 && value.size <= 256 && value.pointerBytes === 8 && value.intBytes === 4 &&
        ["flags", "family", "socktype", "protocol"].every(key => value[key] >= 0 &&
          value[key] % value.intBytes === 0 && value[key] + value.intBytes <= value.size &&
          (value[key] + value.intBytes <= value.next || value[key] >= value.next + value.pointerBytes)) &&
        new Set([value.flags, value.family, value.socktype, value.protocol]).size === 4 &&
        value.next >= 0 && value.next % value.pointerBytes === 0 && value.next + value.pointerBytes <= value.size &&
        [value.afUnspec, value.afInet, value.afInet6, value.sockStream].every(signed32) &&
        value.afUnspec >= 0 && value.afInet > 0 && value.afInet6 > 0 && value.afInet !== value.afInet6 && value.sockStream > 0;
      const sameLayout = value => abi(value) && abi(layout) && layoutKeys.every(key => value[key] === layout[key]);
      const launcher = bootstrap?.variants?.[0]?.direct?.command?.executable;
      const resolverSymbols = bootstrap?.resolverSymbols;
      const imports = typeof bootstrap?.resolverSymbolsCommand?.stdout === "string"
        ? bootstrap.resolverSymbolsCommand.stdout.split(/\r?\n/).map(name => name.trim()) : [];
      const importsMatch = resolverSymbols && Object.keys(resolverSymbols).length === 2 &&
        ["getaddrinfo", "freeaddrinfo"].every(name => {
          const matches = imports.filter(symbol => new RegExp(`^_${name}(?:\\$[A-Za-z0-9_]+)*$`).test(symbol));
          return matches.length === 1 && resolverSymbols[name] === matches[0].slice(1);
        });
      const sameSymbols = value => value && resolverSymbols && Object.keys(value).length === 2 &&
        ["getaddrinfo", "freeaddrinfo"].every(name => value[name] === resolverSymbols[name]);
      const nativeDns = (command, record) => outcome(command) && typeof launcher === "string" && launcher.startsWith("/") &&
        command.executable === launcher && Array.isArray(command.argv) && command.argv.length === 4 &&
        command.argv[0] === "observe-dns" && typeof command.argv[1] === "string" && command.argv[1].startsWith("/") &&
        command.argv[2] === unix?.listed && command.argv[3] === unix?.unlisted &&
        (record === null && (command.exitCode !== 0 || command.signal !== null) ||
          record?.phase === "native-dns" && Number.isSafeInteger(record.pid) && record.pid > 0 && record.pid === command.pid &&
          Number.isSafeInteger(record.uid) && record.uid > 0 && record.hostname === "example.com" &&
          record.endpoint === "/var/run/mDNSResponder" && snapshot(record.ports) && sameLayout(record.addrinfoLayout) &&
          record.canonicalEndpoint === bootstrap.dnsResolvedEndpoint &&
          [record.socket, record.canonicalSocket, record.unixAllowlist?.listed, record.unixAllowlist?.unlisted].every(unixSocket) &&
          [record.pathMetadata?.varAlias, record.pathMetadata?.dnsAlias, record.pathMetadata?.dnsCanonical].every(pathObservation) &&
          gai(record.getaddrinfo) && signed32(record.dnssd?.createResult));
      const resolverCases = [["main", "443"], ["main", "none"], ["thread", "443"]];
      const resolverObservation = (record, pid, context, service, uid) =>
        record?.phase === "native-resolver" && Number.isSafeInteger(pid) && record.pid === pid && pid > 0 &&
        Number.isSafeInteger(record.uid) && record.uid > 0 && record.uid === uid &&
        record.hostname === "example.com" && record.context === context && record.service === (service === "none" ? null : service) &&
        portNumber(record.globalBootstrap) && snapshot(record.ports) && gai(record.getaddrinfo);
      const nativeResolver = (command, record, path, context, service, uid, positive = false) =>
        outcome(command) && command.executable === launcher && Array.isArray(command.argv) &&
        JSON.stringify(command.argv) === JSON.stringify(["observe-resolver", path, context, service]) &&
        (record === null && !positive && (command.exitCode !== 0 || command.signal !== null) ||
          resolverObservation(record, command.pid, context, service, uid) &&
          (!positive || command.exitCode === 0 && command.signal === null && record.getaddrinfo.result === 0 &&
            record.getaddrinfo.ipv4 + record.getaddrinfo.ipv6 > 0));
      const nativeResolvers = (records, base, uid, positive = false) => Array.isArray(records) &&
        records.length === resolverCases.length && records.every((entry, index) => {
          const [context, service] = resolverCases[index];
          return nativeResolver(entry?.command, entry?.observation,
            `${base}.resolver-${context}-${service}.json`, context, service, uid, positive);
        });
      const machStatus = number => signed32(number) && number >= 0;
      const validName = name => portNumber(name) && name > 0 && name < 0xffffffff;
      const subsetOperations = ["allocate", "makeSend", "subset", "unprivileged", "parent", "releaseParent",
        "releaseUnprivileged", "releaseSubset", "releaseRequestorSend", "releaseRequestorReceive"];
      const nativeSubset = (command, record, uid, path) => {
        if (typeof path !== "string" || !path.startsWith("/") || path.includes("\0") ||
            !outcome(command) || command.executable !== launcher ||
            JSON.stringify(command.argv) !== JSON.stringify(["observe-subset", path])) return false;
        if (record === null) return command.exitCode !== 0 || command.signal !== null;
        const operations = record?.operations;
        if (record?.phase !== "native-subset-preflight" || record.pid !== command.pid || record.pid <= 0 ||
            record.uid !== uid || record.euid !== uid || record.namespaceInstalled !== false ||
            !portNumber(record.globalBootstrap) || !snapshot(record.before) || !snapshot(record.after) ||
            !operations || Object.keys(operations).length !== subsetOperations.length ||
            !subsetOperations.every(key => operations[key] === null || signed32(operations[key])) ||
            operations.allocate === null) return false;
        for (const [index, key] of subsetOperations.slice(1, 5).entries())
          if ((operations[key] !== null) !== (operations[subsetOperations[index]] === 0)) return false;
        for (const [key, operation] of [["requestor", "allocate"], ["subset", "subset"],
          ["unprivileged", "unprivileged"], ["parent", "parent"]])
          if (!(operations[operation] === 0 ? validName(record[key]) : record[key] === 0)) return false;
        for (const [release, acquired] of [["releaseParent", "parent"], ["releaseUnprivileged", "unprivileged"],
          ["releaseSubset", "subset"], ["releaseRequestorSend", "makeSend"], ["releaseRequestorReceive", "allocate"]])
          if ((operations[release] !== null) !== (operations[acquired] === 0)) return false;
        return true;
      };
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
      const nodeLibc = (record, pid, uid, positive = false, stage) => {
        if (record?.phase !== "node-libc-resolver" || record.stage !== stage || record.pid !== pid || !(pid > 0) ||
            record.uid !== uid || !(uid > 0) || positive && record.unavailable !== undefined ||
            record.before !== undefined && !nodePorts(record.before) ||
            record.after !== undefined && !nodePorts(record.after)) return false;
        if (stage !== undefined && typeof record.unavailable !== "string" &&
            (!nodePorts(record.before) || !nodePorts(record.after))) return false;
        if (record.calls === undefined) return typeof record.unavailable === "string" && !positive;
        return record.hostname === "example.com" && sameLayout(record.layout) && sameSymbols(record.symbols) &&
          record.hints?.flags === 0 && record.hints.family === layout.afUnspec &&
          record.hints.socktype === layout.sockStream && record.hints.protocol === 0 &&
          Array.isArray(record.calls) && record.calls.length === 2 && record.calls.every((call, index) =>
            call?.service === (index === 0 ? "443" : null) && signed32(call.result) &&
            [call.ipv4, call.ipv6].every(number => Number.isSafeInteger(number) && number >= 0) &&
            (!positive || call.result === 0 && call.ipv4 + call.ipv6 > 0));
      };
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
          typeof bootstrap.ffi.nativeName !== "string" || !/^@koromix\/koffi-darwin-(?:arm64|x64)$/.test(bootstrap.ffi.nativeName) ||
          typeof bootstrap.ffi.nativeRoot !== "string" || !bootstrap.ffi.nativeRoot.startsWith("/") || bootstrap.ffi.nativeRoot === "/" ||
          typeof bootstrap.ffi.nativeEntry !== "string" || !bootstrap.ffi.nativeEntry.startsWith(`${bootstrap.ffi.nativeRoot}/`) ||
          typeof bootstrap.ffi.nativeEntrySha256 !== "string" || !/^[0-9a-f]{64}$/.test(bootstrap.ffi.nativeEntrySha256) ||
          !Number.isSafeInteger(bootstrap.ffi.host?.pid) || bootstrap.ffi.host.pid <= 0 ||
          bootstrap.ffi.host.ffiPid !== bootstrap.ffi.host.pid || bootstrap.ffi.host.uid !== bootstrap.nativeDnsHost?.uid ||
          typeof bootstrap.libcProbe?.entry !== "string" || !bootstrap.libcProbe.entry.startsWith("/") ||
          typeof bootstrap.libcProbe.sourceSha256 !== "string" || !/^[0-9a-f]{64}$/.test(bootstrap.libcProbe.sourceSha256) ||
          !importsMatch || !outcome(bootstrap.resolverSymbolsCommand) || bootstrap.resolverSymbolsCommand.exitCode !== 0 ||
          bootstrap.resolverSymbolsCommand.executable !== "/usr/bin/xcrun" ||
          JSON.stringify(bootstrap.resolverSymbolsCommand.argv) !== JSON.stringify(["nm", "-uj", launcher]) ||
          !nodeLibc(bootstrap.nativeLibcHost, bootstrap.ffi.host.pid, bootstrap.ffi.host.uid, true) ||
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
          !nativeResolvers(bootstrap.nativeResolverHost, bootstrap.nativeDnsHostCommand.argv[1], bootstrap.nativeDnsHost.uid, true) ||
          !nativeSubset(bootstrap.nativeSubsetHostCommand, bootstrap.nativeSubsetHost, bootstrap.nativeDnsHost.uid,
            bootstrap.nativeSubsetHostCommand?.argv?.[1]))
        throw new Error("bootstrap observation lacks a production profile, source or actual independent host positive");
      const targets = new Set([bootstrap.positiveTarget]);
      for (const [index, variant] of bootstrap.variants.entries()) {
        if (variant.name !== modes[index] || typeof variant.canaryPreserved !== "boolean" ||
            typeof variant.profileSha256 !== "string" || !/^[0-9a-f]{64}$/.test(variant.profileSha256))
          throw new Error("bootstrap variants omit or relabel a rights/compatibility outcome");
        const nodeCommand = variant.node?.command, directPids = new Set();
        if (!Array.isArray(variant.directResolvers) || variant.directResolvers.length !== resolverCases.length ||
            !variant.directResolvers.every((entry, resolverIndex) => {
              const [context, service] = resolverCases[resolverIndex], command = entry?.command, ports = entry?.ports;
              const directory = nodeCommand?.argv?.[3], path = `${directory}/direct.resolver-${context}-${service}.json`;
              if (!outcome(command) || command.executable !== launcher ||
                  JSON.stringify(command.argv) !== JSON.stringify([variant.name, nodeCommand?.argv?.[1],
                    `${path}.ports.json`, directory, launcher, "observe-resolver", path, context, service]) ||
                  directPids.has(command.pid) || command.pid === nodeCommand?.pid) return false;
              directPids.add(command.pid);
              if (ports === null) return entry.observation === null && (command.exitCode !== 0 || command.signal !== null);
              return ports?.mode === variant.name && ports.sandboxApplied === true && ports.preExecObservation === true &&
                ports.pid === command.pid && ports.uid === variant.node?.ports?.uid && ports.uid > 0 &&
                snapshot(ports.before) && snapshot(ports.after) && Array.isArray(ports.droppedSendRights) &&
                ports.droppedSendRights.every(portNumber) &&
                nativeResolver({ ...command, argv: command.argv.slice(5) }, entry.observation,
                  path, context, service, ports.uid);
            })) throw new Error("direct C resolver comparison lacks the same image, sandbox, process or resolver inputs");
        if (!Array.isArray(variant.childResolvers) || variant.childResolvers.length !== 2 ||
            !variant.childResolvers.every((entry, childIndex) => {
              const mechanism = ["fork", "posix-spawn"][childIndex], command = entry?.command, ports = entry?.ports, parent = entry?.parent;
              const directory = nodeCommand?.argv?.[3], path = `${directory}/${mechanism}.resolver.json`;
              if (entry.mechanism !== mechanism || !outcome(command) || command.executable !== launcher ||
                  JSON.stringify(command.argv) !== JSON.stringify([variant.name, nodeCommand?.argv?.[1],
                    `${path}.ports.json`, directory, launcher, "observe-child-resolver", `${path}.parent.json`, path,
                    mechanism, "main", "443"])) return false;
              if (parent === null) return entry.observation === null && (command.exitCode !== 0 || command.signal !== null);
              if (ports?.mode !== variant.name || ports.sandboxApplied !== true || ports.preExecObservation !== true ||
                  ports.pid !== command.pid || ports.uid !== bootstrap.nativeDnsHost.uid ||
                  !snapshot(ports.before) || !snapshot(ports.after) || !Array.isArray(ports.droppedSendRights) ||
                  !ports.droppedSendRights.every(portNumber) || parent.phase !== "native-child-resolver" ||
                  parent.pid !== command.pid || parent.uid !== ports.uid || parent.mechanism !== mechanism ||
                  !snapshot(parent.before) || !snapshot(parent.after) || !Number.isSafeInteger(parent.spawnStatus) ||
                  parent.spawnStatus < 0 || !Number.isSafeInteger(parent.waitStatus) || parent.waitStatus < 0 ||
                  parent.waitStatus > 0xffff || typeof parent.timedOut !== "boolean") return false;
              if (parent.spawnStatus !== 0) return parent.childPid === 0 && parent.joined === false &&
                parent.waitStatus === 0 && parent.timedOut === false && entry.observation === null;
              return parent.childPid > 0 && parent.childPid !== parent.pid && parent.joined === true &&
                (entry.observation === null ? parent.waitStatus !== 0 :
                  resolverObservation(entry.observation, parent.childPid, "main", "443", parent.uid));
            })) throw new Error("C child resolver comparison lacks the actual mechanism, owned child or join outcome");
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
                attempt.command.argv[16] !== JSON.stringify(layout) ||
                attempt.command.argv[17] !== JSON.stringify(resolverSymbols) ||
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
                !nodeGlobal(attempt.tools.bootstrapGlobal, ports?.pid, ports?.uid, attempt.globalTarget) ||
                !nativeSubset(attempt.tools.nativeSubsetCommand, attempt.tools.nativeSubset, ports?.uid,
                  `${attempt.command.argv[14]}.subset.json`) ||
                !nodeLibc(attempt.tools.nativeLibcCold, ports?.pid, ports?.uid, false, "before-node-lookup") ||
                !nodeLibc(attempt.tools.nativeLibc, ports?.pid, ports?.uid, false, "after-node-lookup")))
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
      const session = bootstrap.session, baseline = bootstrap.variants[0].node;
      const proxy = bootstrap.lookupProxy;
      if (proxy?.fixtureOnly !== true || proxy.privateAbi !== true ||
          proxy.signatureSource !== "observed bootstrap Mach interface 0x400000cf; SDK MIG reply" ||
          !["OBSERVED", "SETUP_FAILED"].includes(proxy.status) ||
          proxy.status === "SETUP_FAILED" && typeof proxy.error !== "string")
        throw new Error("semantic lookup proxy loses its private ABI limitation or actual outcome");
      if (proxy.command !== undefined && !(proxy.trace?.at(-1)?.phase === "terminal" && proxy.trace.at(-1).joined === true))
        throw new Error("failed lookup proxy cannot hide an unobserved controlled child return");
      if (proxy.lifetime !== undefined) {
        const lifetime = proxy.lifetime;
        if (lifetime.fixtureOnly !== true || lifetime.tokenSource !== "kernel-task-name-port" ||
            lifetime.fixtureReleaseUsedBeforeObservation !== false || !["OBSERVED", "SETUP_FAILED"].includes(lifetime.status) ||
            lifetime.status === "SETUP_FAILED" && typeof lifetime.error !== "string" ||
            lifetime.started && lifetime.controlledGenerationsExited !== true)
          throw new Error("proxy lifetime comparison cannot hide unobserved descendants or its fixture limitation");
        if (lifetime.controlBackend !== undefined && lifetime.controlBackend !== "production-native")
          throw new Error("proxy lifetime comparison names an unknown control backend");
        if (lifetime.status === "OBSERVED" && lifetime.controlBackend === "production-native") {
          const identity = lifetime.identityRecord?.result, recovery = lifetime.discoveryRecovery;
          const response = (record, mode) => record?.mode === mode && Number.isSafeInteger(record.pid) && record.pid > 1 &&
            record.uid === baseline.ports.uid && record.bootId === identity?.bootId &&
            (mode === "identity" || JSON.stringify(record.identity) === JSON.stringify(identity));
          if (!identity || identity.kind !== "darwin-resource-coalition" ||
              identity.coalitionId !== lifetime.members?.leader?.resource ||
              identity.bootId !== value.boot?.stdout?.trim().toLowerCase() ||
              !response(lifetime.identityRecord, "identity") || lifetime.identityRecord.targetPid !== lifetime.members.leader.pid ||
              ![lifetime.nativeControl?.sourceSha256, lifetime.nativeControl?.implementationSha256]
                .every(hash => typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash)) ||
              !response(lifetime.nativeBefore, "population") || lifetime.nativeBefore.result !== "populated" ||
              !response(lifetime.nativeAfter, "population") || lifetime.nativeAfter.result !== "empty" ||
              !response(lifetime.wrongMember, "signal") || lifetime.wrongMember.targetPid !== lifetime.control?.pid || lifetime.wrongMember.result !== false ||
              !response(lifetime.remainingMember, "signal") || lifetime.remainingMember.targetPid !== lifetime.members?.detached?.pid || lifetime.remainingMember.result !== true ||
              recovery?.input !== "production-native-member-hints" || recovery.beforeFixtureRelease !== true ||
              !Array.isArray(recovery.rounds) || !recovery.rounds.length ||
              recovery.rounds.some(round => !response(round.discovery, "hints") || !Array.isArray(round.discovery.result) ||
                !Array.isArray(round.controls) || round.controls.length !== round.discovery.result.length ||
                round.controls.some((control, index) => !response(control, "signal") || control.targetPid !== round.discovery.result[index] || typeof control.result !== "boolean")) ||
              lifetime.after?.returnCode !== -1 || lifetime.after.errno !== 3 || lifetime.otherAfter?.returnCode !== 0)
            throw new Error("production-native lifetime loses boot binding, exact hints/effects or independent scope observations");
          if (lifetime.launchOnlyOnce === true) {
            const reused = lifetime.labelReuse, current = reused?.replacementAfter;
            if (lifetime.explicitBootoutBeforeObservation !== false || !response(lifetime.ownerSignal, "signal") ||
                lifetime.ownerSignal.targetPid !== lifetime.proxyIdentity?.pid || lifetime.ownerSignal.result !== true ||
                lifetime.removedRegistration?.exitCode !== 113 || lifetime.restart?.exitCode !== 113 ||
                reused?.target !== lifetime.target || reused.replacement?.resource === identity.coalitionId ||
                !response(reused.oldPopulation, "population") || reused.oldPopulation.result !== "empty" ||
                !response(reused.oldSignal, "signal") || reused.oldSignal.targetPid !== reused.replacement?.pid || reused.oldSignal.result !== false ||
                reused.oldReference?.errno !== 3 || reused.replacementReference?.returnCode !== 0 ||
                current?.uniqueBytes !== 56 || current.unique !== reused.replacement.identity?.unique ||
                current.version !== reused.replacement.identity?.version || current.bsdBytes !== 136 || current.status === 5)
              throw new Error("one-shot lifetime loses exact owner control or confuses a reused label with its old CID");
          }
        }
      }
      if (proxy.nativeSink !== undefined) {
        const sink = proxy.nativeSink;
        if (sink.fixtureOnly !== true || sink.receiver !== "production-node-discard" ||
            !["OBSERVED", "SETUP_FAILED"].includes(sink.status) || sink.status === "SETUP_FAILED" && typeof sink.error !== "string" ||
            sink.result !== undefined && !(sink.trace?.at(-1)?.phase === "terminal" && sink.trace.at(-1).joined === true))
          throw new Error("native discard comparison cannot hide its controlled-child cleanup");
        if (sink.status === "OBSERVED" && (sink.result?.kind !== "exited" || sink.result.exitCode !== 0 ||
            sink.profileSha256 !== proxy.profileSha256 || !Number.isSafeInteger(sink.discarded) || sink.discarded <= 0 ||
            sink.receiveError !== undefined || sink.trace.find(entry => entry.phase === "ready")?.externalSink !== true ||
            sink.tools?.complete !== true || sink.tools.pid !== sink.ports?.pid || sink.ports.sandboxApplied !== true ||
            sink.command?.argv?.[1] !== "--external-sink" || sink.command.argv[2] !== sink.serviceName))
          throw new Error("native discard comparison lacks its actual receiver, policy or completed tools");
      }
      for (const key of ["machGate", "machPipeGate"]) if (proxy[key] !== undefined) {
        const gate = proxy[key], piped = key === "machPipeGate";
        const slots = gate.profileChannel === undefined ? [0, 1, 2, 7] : [0, 1, 2, 7, 3];
        const words = token => Array.isArray(token) && token.length === 8 && token.every(portNumber) && token[5] > 1 && token[7] !== 0;
        const image = record => words(record.token) && record.token[5] === gate.childPid && record.pid === gate.childPid &&
          Number.isSafeInteger(record.stopStatus) && record.stopStatus >= 0 && record.stopStatus <= 0xffff &&
          (record.stopStatus & 0xff) === 0x7f && ((record.stopStatus >>> 8) & 0xff) !== 0x13 &&
          record.identity?.bootId === gate.identity?.bootId && record.identity?.coalitionId === gate.identity?.coalitionId &&
          record.origin?.kind === "matched" && record.otherOrigin?.kind === "unavailable" &&
          Number.isInteger(record.otherOrigin.osStatus) && record.otherOrigin.osStatus !== 0 &&
          [record.expectedCdHashes, record.otherCdHashes].every(hashes => Array.isArray(hashes) && hashes.length > 0 &&
            hashes.every(hash => typeof hash === "string" && /^[0-9a-f]{40}$/.test(hash))) &&
          !record.expectedCdHashes.some(hash => record.otherCdHashes.includes(hash));
        if (gate.fixtureOnly !== true || gate.protocol !== 1 || gate.domain !== `user/${baseline.ports.uid}` ||
            gate.sessionType !== "Background" || gate.sessionCreate !== true || gate.launchOnlyOnce !== true ||
            !["OBSERVED", "SETUP_FAILED"].includes(gate.status) || gate.status === "SETUP_FAILED" && typeof gate.error !== "string" ||
            gate.identity !== undefined && gate.scopeGone !== true || piped && gate.pipeHandlesReturned !== true ||
            gate.profileChannel !== undefined && gate.profileHandlesReturned !== true)
          throw new Error("Mach job gate loses its constructor, outcome or independently observed cleanup");
        if (gate.status === "OBSERVED" &&
            (![gate.sourceSha256, gate.executableSha256].every(hash => typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash)) ||
              !words(gate.expectedHostToken) || gate.expectedHostToken[5] !== bootstrap.ffi.host.pid ||
              !words(gate.helperToken) || gate.helperToken[5] === gate.expectedHostToken[5] ||
              gate.jobImplementationSha256 !== undefined &&
                (!/^[0-9a-f]{64}$/.test(gate.jobImplementationSha256) ||
                  ![gate.jobSubmission, gate.jobStart].every(result => result?.kind === "exited" && result.exitCode === 0 &&
                    result.signal === null && result.errorCode === null)) ||
              gate.preemption?.taken !== false || gate.origin?.kind !== "matched" || gate.reportBeforeHostRelease !== false ||
              gate.imageSelections !== undefined && (!Array.isArray(gate.imageSelections) || gate.imageSelections.length !== 3 ||
                gate.imageSelections.some((selected, index) => selected.source !== "held-regular-bytes" ||
                  typeof selected.path !== "string" || !selected.path.startsWith("/") ||
                  !Number.isSafeInteger(selected.bytes) || selected.bytes <= 0 || !/^[0-9a-f]{64}$/.test(selected.sha256) ||
                  !Array.isArray(selected.cdHashes) || !selected.cdHashes.includes(selected.independentCdHash) ||
                  JSON.stringify(selected.cdHashes) !== JSON.stringify([gate.expectedCdHashes, gate.otherCdHashes,
                    gate.targetImage?.expectedCdHashes][index]))) ||
              gate.initialImage !== undefined && (gate.initialImage.status !== "OBSERVED" ||
                gate.initialImage.tokenSource !== "kernel-task-name-port" || !words(gate.initialImage.token) ||
                gate.initialImage.pid !== gate.helperToken[5] ||
                JSON.stringify(gate.initialImage.token) !== JSON.stringify(gate.helperToken) ||
                gate.initialImage.identity?.bootId !== gate.identity?.bootId ||
                gate.initialImage.identity?.coalitionId !== gate.identity?.coalitionId ||
                gate.initialImage.stoppedStatus !== 4 || gate.initialImage.traceBeforeRelease !== false ||
                gate.initialImage.continued !== 0 || gate.initialImage.taskNameReturned !== true ||
                gate.initialImage.origin?.kind !== "matched" || gate.initialImage.otherOrigin?.kind !== "unavailable" ||
                !Number.isInteger(gate.initialImage.otherOrigin.osStatus) || gate.initialImage.otherOrigin.osStatus === 0) ||
              gate.initialImage?.pinState !== undefined && (gate.initialImage.pinState !== "stopped" ||
                gate.initialImage.resumed !== true || gate.initialImage.closedPinState !== "unknown" ||
                gate.targetImage?.pinState !== "stopped" || gate.targetImage.stateAfterExec !== "changed" ||
                gate.targetImage.staleResume !== false || gate.targetImage.staleTerminate !== false ||
                gate.finalImage?.pinState !== "stopped" || gate.finalImage.stateAfterFinish !== "exited" ||
                gate.finalImage.deadTerminate !== false || gate.processPinsReturned !== true || gate.processPinReturnError !== undefined ||
                gate.cancelledBeforeStartup?.image?.kind !== "matched" || gate.cancelledBeforeStartup.terminated !== true ||
                gate.cancelledBeforeStartup.state !== "exited" || gate.cancelledBeforeStartup.deadEffect !== false ||
                gate.cancelledBeforeStartup.traceCreated !== false || gate.cancelledBeforeStartup.population !== "empty" ||
                gate.cancelledBeforeStartup.registrationExit !== 113) ||
              gate.expectedCdHashes !== undefined &&
                (!Array.isArray(gate.expectedCdHashes) || !gate.expectedCdHashes.length ||
                  gate.expectedCdHashes.some(hash => !/^[0-9a-f]{40}$/.test(hash)) ||
                  gate.otherOrigin?.kind !== "unavailable" || !Number.isInteger(gate.otherOrigin.osStatus) || gate.otherOrigin.osStatus === 0 ||
                  !Array.isArray(gate.otherCdHashes) || !gate.otherCdHashes.length ||
                  gate.otherCdHashes.some(hash => !/^[0-9a-f]{40}$/.test(hash) || gate.expectedCdHashes.includes(hash))) ||
              gate.fileports !== undefined && (gate.fileports.transport !== (piped ? "native-fileport-pipe" : "native-fileport") ||
                JSON.stringify(gate.fileports.slots) !== JSON.stringify(slots) ||
                gate.fileports.beforeRelease?.stdout !== "" || gate.fileports.beforeRelease?.stderr !== "" ||
                gate.fileports.child?.input !== "MACH_INPUT\n" || gate.fileports.child?.private !== "MACH_PRIVATE\n" ||
                (piped ? gate.fileports.readersClosed !== true ||
                  ["stdout", "stderr"].some((key, index) => {
                    const expected = Buffer.alloc(index === 0 ? 1048593 : 1048605, index === 0 ? 97 : 98);
                    return gate.fileports[key]?.bytes !== expected.length ||
                      gate.fileports[key]?.sha256 !== createHash("sha256").update(expected).digest("hex");
                  }) : gate.fileports.stdout !== "MACH_STDOUT\n" || gate.fileports.stderr !== "MACH_STDERR\n") ||
                JSON.stringify(gate.trace?.filter(row => row.phase === "fileport").map(row => row.slot)) !== JSON.stringify(slots) ||
                gate.trace.some(row => row.phase === "fileport" && row.closeOnExec !== true)) ||
              gate.profileChannel !== undefined && (gate.profileChannel.source !== "production-prepareSeatbelt" ||
                gate.profileChannel.framing !== "OMASBPL1" || gate.profileChannel.fd !== 3 ||
                !Number.isSafeInteger(gate.profileChannel.frameBytes) || gate.profileChannel.frameBytes <= 16 ||
                !/^[0-9a-f]{64}$/.test(gate.profileChannel.sha256) || gate.profileChannel.payloadSha256 !== proxy.profileSha256 ||
                gate.fileports === undefined || gate.finalImage === undefined ||
                gate.profileWriteError !== undefined || gate.profileReturnError !== undefined) ||
              gate.targetImage !== undefined && (!image(gate.targetImage) ||
                !gate.trace.some(row => row.phase === "suspended" && row.childPid === gate.childPid &&
                  row.stopSignal === ((gate.targetImage.stopStatus >>> 8) & 0xff))) ||
              gate.finalImage !== undefined && (!image(gate.finalImage) || gate.finalImage.reportBeforeRelease !== false ||
                gate.finalImage.token[7] === gate.targetImage?.token[7] ||
                gate.finalImage.outputBeforeRelease?.stdout !== 0 || gate.finalImage.outputBeforeRelease?.stderr !== 0 ||
                gate.beforeFinalReleaseAttack?.pid === gate.expectedHostToken[5] || gate.rejectedAtFinish < 3 ||
                !gate.trace.some(row => row.phase === "suspended" && row.stage === "target" && row.childPid === gate.childPid &&
                  row.stopSignal === ((gate.finalImage.stopStatus >>> 8) & 0xff)) ||
                JSON.stringify(gate.trace.filter(row => row.phase === "suspended").map(row => row.stage)) !== '["launcher","target"]') ||
              !Number.isSafeInteger(gate.rejectedAtFinish) || gate.rejectedAtFinish < 2 ||
              gate.beforeInitAttack?.pid === gate.expectedHostToken[5] || gate.beforeReleaseAttack?.pid === gate.expectedHostToken[5] ||
              gate.waitStatus !== 0 || gate.ports?.pid !== gate.childPid || gate.ports.sandboxApplied !== true ||
              gate.ports.resource !== gate.identity?.coalitionId || gate.identity?.bootId !== value.boot?.stdout?.trim().toLowerCase() ||
              gate.after?.returnCode !== -1 || gate.after.errno !== 3 || gate.registration?.exitCode !== 113 ||
              gate.tools?.complete !== true || gate.profileSha256 !== proxy.profileSha256 || gate.receiveError !== undefined ||
              !Number.isSafeInteger(gate.discarded) || gate.discarded <= 0 || gate.trace?.at(-1)?.joined !== true))
          throw new Error("Mach job gate lacks genuine message origins, a closed gate or final CID return");
      }
      for (const key of ["denial", "dropAll"]) if (proxy[key] !== undefined) {
        const denial = proxy[key];
        if (denial.fixtureOnly !== true || denial.denyAll !== true || !["OBSERVED", "SETUP_FAILED"].includes(denial.status) ||
            key === "dropAll" && denial.dropAll !== true ||
            denial.status === "SETUP_FAILED" && typeof denial.error !== "string" ||
            denial.command !== undefined && !(denial.trace?.at(-1)?.phase === "terminal" && denial.trace.at(-1).joined === true))
          throw new Error("deny-all comparison loses refusal mode or actual child cleanup");
        if (denial.status === "OBSERVED" &&
            (denial.trace.find(entry => entry.phase === "ready")?.denyAll !== true ||
              denial.trace.some(entry => entry.phase === "mach-request" && (entry.selected !== false || entry.name !== null || entry.replyBytes === 52)) ||
              key === "dropAll" && denial.trace.some(entry => entry.phase === "mach-request" && entry.replyBytes !== 0) ||
              denial.profileSha256 !== proxy.profileSha256 || denial.tools?.complete !== true ||
              denial.tools.pid !== denial.ports?.pid || denial.ports?.sandboxApplied !== true))
          throw new Error("deny-all comparison lacks actual denied requests and sandboxed tools");
      }
      for (const tools of [...bootstrap.variants.map(variant => variant.node.tools), proxy.tools,
        proxy.denial?.tools, proxy.dropAll?.tools, session?.tools, bootstrap.messageFilter?.tools,
        bootstrap.denyBootstrap?.tools, bootstrap.appSandbox?.tools, bootstrap.appSandbox?.reverse?.tools,
        bootstrap.appSandbox?.only?.tools]) {
        if (tools?.nativeLookupCommand === undefined && tools?.nativeLookup === undefined) continue;
        const command = tools.nativeLookupCommand, lookup = tools.nativeLookup;
        if (!outcome(command) || command.executable !== launcher || command.argv[0] !== "observe-logd-lookup" ||
            !(lookup === undefined && (command.exitCode !== 0 || command.signal !== null || command.error !== undefined) ||
              lookup?.phase === "public-bootstrap-lookup" && lookup.name === "com.apple.logd" && lookup.pid === command.pid &&
              typeof lookup.alarmBlocked === "boolean" &&
              lookup.uid === baseline.ports.uid && signed32(lookup.status) && portNumber(lookup.port) &&
              signed32(lookup.typeStatus) && portNumber(lookup.rights) && signed32(lookup.releaseStatus) &&
              signed32(lookup.hostLaunchctl?.status) && portNumber(lookup.hostLaunchctl.port) &&
              signed32(lookup.hostLaunchctl.releaseStatus) && signed32(lookup.hostLaunchctl.hostReleaseStatus)))
          throw new Error("public bootstrap lookup loses its actual caller, result, rights or host-capability comparison");
      }
      if (proxy.status === "OBSERVED") {
        const { command, ports, tools, trace } = proxy;
        const ready = trace?.find(entry => entry.phase === "ready"), spawned = trace?.find(entry => entry.phase === "spawn");
        const terminal = trace?.at(-1), hashes = [proxy.sourceSha256, proxy.executableSha256];
        const services = ["com.apple.logd", "com.apple.system.logger", "com.apple.system.opendirectoryd.libinfo"];
        if (!hashes.every(value => typeof value === "string" && /^[0-9a-f]{64}$/.test(value)) ||
            proxy.profileSha256 !== bootstrap.variants[0].profileSha256 || !outcome(proxy.compilation) ||
            proxy.compilation.executable !== "/usr/bin/xcrun" || proxy.compilation.exitCode !== 0 ||
            !outcome(command) || command.argv[1] !== launcher || command.argv[2] !== "inherited" ||
            command.argv[6] !== baseline.command.argv[4] || command.argv[8] !== proxy.target || command.argv[17] !== proxy.globalTarget ||
            ready?.pid !== command.pid || ready.uid !== baseline.ports.uid || ready.privateAbi !== true ||
            !portNumber(ready.original) || !portNumber(ready.proxy) || ready.original === ready.proxy ||
            spawned?.status !== 0 || spawned.restored !== 0 || spawned.registered !== 0 ||
            !Number.isSafeInteger(spawned.childPid) || spawned.childPid < 2 || spawned.childPid === command.pid ||
            terminal?.phase !== "terminal" || terminal.childPid !== spawned.childPid || terminal.joined !== true || terminal.timedOut !== false ||
            !Number.isSafeInteger(terminal.waitStatus) || ports?.pid !== spawned.childPid || ports.mode !== "inherited" ||
            ports.sandboxApplied !== true || ports.uid !== ready.uid || !snapshot(ports.before) || !snapshot(ports.after) ||
            proxy.effectDirectory !== `${command.argv[5]}/proxy-service` || proxy.globalEffectDirectory !== `${command.argv[5]}/proxy-global` ||
            tools?.complete !== true || tools.pid !== ports.pid || !dns(tools.dns) || !outcome(tools.git) || !outcome(tools.compiler) ||
            !outcome(tools.service) || tools.service.executable !== "/bin/launchctl" ||
            JSON.stringify(tools.service.argv) !== JSON.stringify(["kickstart", proxy.target]) ||
            !nativeDns(tools.nativeDnsCommand, tools.nativeDns) ||
            !nativeResolvers(tools.resolvers, tools.nativeDnsCommand.argv[1], ports.uid) ||
            !nodeGlobal(tools.bootstrapGlobal, ports.pid, ports.uid, proxy.globalTarget) || typeof proxy.canaryPreserved !== "boolean" ||
            ![proxy.guestEffect, proxy.globalGuestEffect].every(effect => effect === null || Number.isSafeInteger(effect?.pid) && effect.pid > 1) ||
            trace.some(entry => entry.phase === "mach-request" &&
              (!Number.isSafeInteger(entry.senderPid) || entry.senderPid < 2 || typeof entry.selected !== "boolean" ||
                !signed32(entry.lookup) || !signed32(entry.replyStatus) || !Number.isSafeInteger(entry.replyBytes) || entry.replyBytes < 0 ||
                entry.selected && (entry.id !== 0x400000cf || !services.includes(entry.name)))))
          throw new Error("semantic lookup proxy lacks a joined actual child, exact policy, request decisions or normal tools");
        for (const selected of [proxy.target, proxy.globalTarget]) {
          if (!target(selected) || targets.has(selected)) throw new Error("semantic lookup proxy reuses a service target");
          targets.add(selected);
        }
      }
      for (const [key, stem, suffix, revision, numbers] of [
        ["messageFilter", "filter", "(allow mach-bootstrap (apply-message-filter (deny mach-message-send) (allow mach-message-send (message-number 204 207 301 711 800 804))))\n",
          "adc20e859dbd1652b5542788d3d641960dce85e5", "[204,207,301,711,800,804]"],
        ["denyBootstrap", "deny-bootstrap", "(deny mach-bootstrap)\n", null, "[]"],
      ]) {
        const messageFilter = bootstrap[key];
        if (messageFilter?.fixtureOnly !== true || messageFilter.sourceRevision !== revision ||
            JSON.stringify(messageFilter.messageNumbers) !== numbers ||
            !["OBSERVED", "SETUP_FAILED"].includes(messageFilter.status) ||
            messageFilter.status === "SETUP_FAILED" && typeof messageFilter.error !== "string")
          throw new Error("bootstrap message filter loses its source, exact experiment or actual outcome");
        if (messageFilter.status === "OBSERVED") {
          const { command, ports, tools } = messageFilter;
          if (messageFilter.profileSuffix !== suffix || !/^[0-9a-f]{64}$/.test(messageFilter.profileSha256) ||
              !outcome(command) || command.executable !== launcher || command.argv[0] !== "inherited" ||
              command.argv[4] !== baseline.command.argv[4] || command.argv[6] !== messageFilter.target ||
              command.argv[15] !== messageFilter.globalTarget || ports?.pid !== command.pid || ports.mode !== "inherited" ||
              ports.sandboxApplied !== true || ports.uid !== baseline.ports.uid || !snapshot(ports.before) || !snapshot(ports.after) ||
              messageFilter.effectDirectory !== `${command.argv[3]}/${stem}-service` ||
              messageFilter.globalEffectDirectory !== `${command.argv[3]}/${stem}-global` ||
              tools?.complete !== true || tools.pid !== ports.pid || !dns(tools.dns) ||
              !outcome(tools.git) || !outcome(tools.compiler) || !outcome(tools.service) ||
              tools.service.executable !== "/bin/launchctl" ||
              JSON.stringify(tools.service.argv) !== JSON.stringify(["kickstart", messageFilter.target]) ||
              !nativeDns(tools.nativeDnsCommand, tools.nativeDns) ||
              !nativeResolvers(tools.resolvers, tools.nativeDnsCommand.argv[1], ports.uid) ||
              !nodeGlobal(tools.bootstrapGlobal, ports.pid, ports.uid, messageFilter.globalTarget) ||
              typeof messageFilter.canaryPreserved !== "boolean" ||
              ![messageFilter.guestEffect, messageFilter.globalGuestEffect].every(effect => effect === null || Number.isSafeInteger(effect?.pid) && effect.pid > 1))
            throw new Error("bootstrap message filter lacks the applied profile, actual tools or distinct service results");
          for (const selected of [messageFilter.target, messageFilter.globalTarget]) {
            if (!target(selected) || targets.has(selected)) throw new Error("bootstrap message filter reuses a service target");
            targets.add(selected);
          }
        }
      }
      if (session?.sessionCreate !== true || !["OBSERVED", "SETUP_FAILED"].includes(session.status) ||
          session.status === "SETUP_FAILED" && typeof session.error !== "string")
        throw new Error("SessionCreate comparison has no actual outcome");
      if (session.status === "OBSERVED") {
        const ports = session.ports, tools = session.tools, expectedArgv = [launcher, ...baseline.command.argv];
        expectedArgv[3] = `${baseline.command.argv[3]}/session-ports.json`;
        expectedArgv[7] = session.target; expectedArgv[15] = `${baseline.command.argv[3]}/session-tools.json`;
        expectedArgv[16] = session.globalTarget;
        const audit = value => value?.auditTokenStatus === 0 && value.auditTokenCount === 8 &&
          Number.isSafeInteger(value.auditSession) && value.auditSession > 0 && value.auditPid === value.pid;
        for (const selected of [session.jobTarget, session.target, session.globalTarget]) {
          if (!target(selected) || targets.has(selected)) throw new Error("SessionCreate comparison reuses a service target");
          targets.add(selected);
        }
        if (!outcome(session.kickstart) || session.kickstart.exitCode !== 0 || session.kickstart.signal !== null ||
            session.kickstart.executable !== "/bin/launchctl" ||
            JSON.stringify(session.kickstart.argv) !== JSON.stringify(["kickstart", session.jobTarget]) ||
            JSON.stringify(session.argv) !== JSON.stringify(expectedArgv) || ports?.mode !== "inherited" ||
            ports.sandboxApplied !== true || ports.preExecObservation !== true || !Number.isSafeInteger(ports.pid) || ports.pid < 2 ||
            !audit(ports) || !audit(baseline.ports) ||
            ports.auditSession === baseline.ports.auditSession || ports.uid !== baseline.ports.uid ||
            !snapshot(ports.before) || !snapshot(ports.after) || tools?.complete !== true || tools.pid !== ports.pid ||
            !outcome(tools.service) || tools.service.executable !== "/bin/launchctl" ||
            JSON.stringify(tools.service.argv) !== JSON.stringify(["kickstart", session.target]) || !dns(tools.dns) ||
            !nativeDns(tools.nativeDnsCommand, tools.nativeDns) ||
            !nativeResolvers(tools.resolvers, tools.nativeDnsCommand.argv[1], ports.uid) ||
            !nodeLibc(tools.nativeLibcCold, ports.pid, ports.uid, false, "before-node-lookup") ||
            !nodeLibc(tools.nativeLibc, ports.pid, ports.uid, false, "after-node-lookup") ||
            !nodeGlobal(tools.bootstrapGlobal, ports.pid, ports.uid, session.globalTarget) ||
            typeof session.canaryPreserved !== "boolean" ||
            ![session.guestEffect, session.globalGuestEffect].every(effect => effect === null || Number.isSafeInteger(effect?.pid) && effect.pid > 1))
          throw new Error("SessionCreate comparison lacks a distinct kernel audit session, actual policy or service/DNS results");
      }
      const app = bootstrap.appSandbox;
      if (app?.fixtureOnly !== true || app.mechanism !== "standard-app-sandbox" ||
          !["OBSERVED", "SETUP_FAILED"].includes(app.status) ||
          app.status === "SETUP_FAILED" && typeof app.error !== "string")
        throw new Error("standard App Sandbox comparison has no actual outcome");
      if (app.status === "OBSERVED") {
        const initial = app.initial, tools = app.tools;
        if (![app.unsignedSha256, app.signedSha256].every(hash => typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash)) ||
            app.unsignedSha256 === app.signedSha256 ||
            ![app.signing, app.signatureVerification, app.signature].every(command =>
              outcome(command) && command.executable === "/usr/bin/codesign" && command.exitCode === 0 && command.signal === null) ||
            app.entitlements?.["com.apple.security.app-sandbox"] !== true ||
            !Array.isArray(initial) || initial.length !== 2 ||
            initial.some((entry, index) => !outcome(entry.command) || entry.command.exitCode !== 0 || entry.command.signal !== null ||
              entry.command.executable !== [launcher, app.signed][index] ||
              entry.command.argv[0] !== "observe-initial-sandbox" || entry.command.argv[2] !== app.canary ||
              entry.observation?.phase !== "before-custom-profile" || entry.observation.pid !== entry.command.pid ||
              entry.observation.uid !== baseline.ports.uid || typeof entry.observation.canaryOpened !== "boolean" ||
              !Number.isInteger(entry.observation.canaryErrno)) || initial[0].observation.canaryOpened !== true ||
            !outcome(app.command) || app.command.executable !== app.signed ||
            tools?.complete !== true || tools.pid !== app.command.pid || app.ports?.pid !== tools.pid ||
            app.ports.sandboxApplied !== true || app.ports.mode !== "inherited" || !dns(tools.dns) ||
            !nativeDns(tools.nativeDnsCommand, tools.nativeDns) ||
            !nativeResolvers(tools.resolvers, tools.nativeDnsCommand.argv[1], baseline.ports.uid) ||
            !outcome(tools.service) || tools.service.executable !== "/bin/launchctl" ||
            JSON.stringify(tools.service.argv) !== JSON.stringify(["kickstart", app.target]) ||
            !nodeGlobal(tools.bootstrapGlobal, tools.pid, baseline.ports.uid, app.globalTarget) ||
            app.canaryPreserved !== true)
          throw new Error("standard App Sandbox comparison lacks signing, pre-profile enforcement controls or actual child results");
        for (const selected of [app.target, app.globalTarget]) {
          if (!target(selected) || targets.has(selected)) throw new Error("standard App Sandbox comparison reuses a service target");
          targets.add(selected);
        }
      }
      const reverse = app.reverse;
      if (!["OBSERVED", "SETUP_FAILED"].includes(reverse?.status) ||
          reverse.status === "SETUP_FAILED" && typeof reverse.error !== "string")
        throw new Error("reverse App Sandbox order has no actual outcome");
      if (reverse.status === "OBSERVED") {
        const command = reverse.command, outer = reverse.outer, ports = reverse.ports, tools = reverse.tools;
        if (!outcome(command) || command.executable !== launcher || command.argv[4] !== app.signed ||
            command.argv[0] !== "inherited" || command.argv[5] !== "inherited-profile" ||
            command.argv[1] !== command.argv[6] || command.argv[3] !== command.argv[8] ||
            outer?.pid !== command.pid || outer.mode !== "inherited" || outer.profileSource !== "applied-here" ||
            outer.sandboxApplied !== true || ports?.pid !== command.pid || ports.mode !== "inherited-profile" ||
            ports.profileSource !== "exec-inherited" || ports.sandboxApplied !== true ||
            ports.uid !== baseline.ports.uid || outer.uid !== ports.uid || !snapshot(outer.before) || !snapshot(ports.after) ||
            typeof reverse.profileSha256 !== "string" || !/^[0-9a-f]{64}$/.test(reverse.profileSha256) ||
            tools?.complete !== true || tools.pid !== ports.pid || !dns(tools.dns) ||
            !outcome(tools.service) || tools.service.executable !== "/bin/launchctl" ||
            JSON.stringify(tools.service.argv) !== JSON.stringify(["kickstart", reverse.target]) ||
            command.argv[11] !== reverse.target || command.argv[20] !== reverse.globalTarget ||
            !nativeDns(tools.nativeDnsCommand, tools.nativeDns) ||
            !nativeResolvers(tools.resolvers, tools.nativeDnsCommand.argv[1], ports.uid) ||
            !nodeGlobal(tools.bootstrapGlobal, tools.pid, ports.uid, reverse.globalTarget) ||
            typeof reverse.canaryPreserved !== "boolean")
          throw new Error("reverse App Sandbox order loses its actual applied outer policy, same-task exec or tool results");
        for (const selected of [reverse.target, reverse.globalTarget]) {
          if (!target(selected) || targets.has(selected)) throw new Error("reverse App Sandbox comparison reuses a service target");
          targets.add(selected);
        }
      }
      const only = app.only;
      if (only?.customPolicyApplied !== false || !["OBSERVED", "SETUP_FAILED"].includes(only.status) ||
          only.status === "SETUP_FAILED" && typeof only.error !== "string")
        throw new Error("App Sandbox-only comparison loses its explicit policy limit or actual outcome");
      if (only.status === "OBSERVED") {
        const command = only.command, ports = only.ports, tools = only.tools;
        if (!outcome(command) || command.executable !== app.signed || command.argv[0] !== "app-only" ||
            command.argv[4] !== baseline.command.argv[4] || command.argv[6] !== only.target || command.argv[15] !== only.globalTarget ||
            only.effectDirectory !== `${command.argv[3]}/app-only-service` ||
            only.globalEffectDirectory !== `${command.argv[3]}/app-only-global` ||
            ports?.pid !== command.pid || ports.mode !== "app-only" || ports.profileSource !== "code-signature" ||
            ports.sandboxApplied !== false || ports.preExecObservation !== true || ports.uid !== baseline.ports.uid ||
            !snapshot(ports.before) || !snapshot(ports.after) || tools?.complete !== true || tools.pid !== ports.pid ||
            !dns(tools.dns) || !nativeDns(tools.nativeDnsCommand, tools.nativeDns) ||
            !nativeResolvers(tools.resolvers, tools.nativeDnsCommand.argv[1], ports.uid) ||
            !outcome(tools.git) || !outcome(tools.compiler) || !outcome(tools.service) ||
            tools.service.executable !== "/bin/launchctl" ||
            JSON.stringify(tools.service.argv) !== JSON.stringify(["kickstart", only.target]) ||
            !nodeGlobal(tools.bootstrapGlobal, tools.pid, ports.uid, only.globalTarget) ||
            ![only.guestEffect, only.globalGuestEffect].every(effect => effect === null || Number.isSafeInteger(effect?.pid) && effect.pid > 1) ||
            typeof only.canaryPreserved !== "boolean")
          throw new Error("App Sandbox-only comparison lacks the signed image, actual tools or distinct service results");
        for (const selected of [only.target, only.globalTarget]) {
          if (!target(selected) || targets.has(selected)) throw new Error("App Sandbox-only comparison reuses a service target");
          targets.add(selected);
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
      const background = value.background;
      if (background?.fixtureOnly !== true || background.domain !== `user/${admission?.uid}` ||
          background.sessionType !== "Background" || background.sessionCreate !== true || background.guiAbsent !== false ||
          !["OBSERVED", "SETUP_FAILED"].includes(background.status) ||
          background.status === "SETUP_FAILED" && typeof background.error !== "string")
        throw new Error("Background comparison loses its exact user-domain condition or GUI limitation");
      if (background.status === "OBSERVED" &&
          (typeof background.target !== "string" || !background.target.startsWith(`${background.domain}/org.oma.probe.`) ||
            background.kickstart?.executable !== "/bin/launchctl" || background.kickstart.exitCode !== 0 ||
            background.kickstart.signal !== null || JSON.stringify(background.kickstart.argv) !== JSON.stringify(["kickstart", background.target]) ||
            !Number.isSafeInteger(background.actor?.pid) || background.actor.pid <= 1 || background.actor.uid !== admission.uid ||
            background.actor.auditTokenStatus !== 0 || background.actor.auditTokenCount !== 8 ||
            !Number.isSafeInteger(background.actor.auditSession) || background.actor.auditSession <= 0 ||
            background.actor.coalitionBytes !== 40 || !/^[1-9][0-9]*$/.test(background.actor.resource)))
        throw new Error("Background comparison lacks an ordinary-UID execution and actual audit/coalition observation");
      const decimal = text => typeof text === "string" && /^[0-9]+$/.test(text);
      const query = result => result && typeof result.available === "boolean" &&
        [0, -1].includes(result.returnCode) && Number.isSafeInteger(result.errno) &&
        (result.returnCode === 0 ? result.available && result.errno === 0 : result.errno > 0) &&
        decimal(result.started) && decimal(result.exited);
      const pairs = record => Array.isArray(record?.samples) && record.samples.length > 0 &&
        record.samples.every(sample => Number.isFinite(sample.elapsedMs) && sample.elapsedMs >= 0 &&
          query(sample.aggregate) && query(sample.otherAggregate));
      const oneShot = value.oneShot;
      if (oneShot?.fixtureOnly !== true || oneShot.domain !== `user/${admission.uid}` || oneShot.sessionType !== "Background" ||
          oneShot.sessionCreate !== true || oneShot.launchOnlyOnce !== true || oneShot.explicitBootoutBeforeObservation !== false ||
          !["OBSERVED", "SETUP_FAILED"].includes(oneShot.status) || oneShot.status === "SETUP_FAILED" && typeof oneShot.error !== "string")
        throw new Error("one-shot comparison loses its exact constructor or explicit-removal limitation");
      if (oneShot.status === "OBSERVED") {
        const command = (record, verb) => record?.executable === "/bin/launchctl" &&
          JSON.stringify(record.argv) === JSON.stringify([verb, oneShot.target]) && Number.isSafeInteger(record.exitCode) &&
          record.signal === null && typeof record.stdout === "string" && typeof record.stderr === "string";
        const removed = oneShot.printAfterExit?.exitCode === 113 && oneShot.restart?.exitCode === 113 &&
          oneShot.afterRestart?.available === true && oneShot.afterRestart.returnCode === -1 && oneShot.afterRestart.errno === 3;
        if (typeof oneShot.target !== "string" || !oneShot.target.startsWith(`${oneShot.domain}/org.oma.probe.`) ||
            !Number.isSafeInteger(oneShot.actor?.pid) || oneShot.actor.pid <= 1 || oneShot.actor.uid !== admission.uid ||
            !decimal(oneShot.actor.resource) || !pairs(oneShot.afterExit) || !query(oneShot.afterRestart) ||
            !command(oneShot.kickstart, "kickstart") || oneShot.kickstart.exitCode !== 0 ||
            !command(oneShot.printAfterExit, "print") || !command(oneShot.restart, "kickstart") ||
            oneShot.autoRemovalObserved !== removed || oneShot.nativePopulation?.mode !== "population" ||
            oneShot.nativePopulation.uid !== admission.uid || oneShot.nativePopulation.identity?.coalitionId !== oneShot.actor.resource ||
            !["populated", "empty", "unknown"].includes(oneShot.nativePopulation.result) || removed && oneShot.nativePopulation.result !== "empty")
          throw new Error("one-shot comparison lacks actual registration, restart and independent CID outcomes");
      }
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
