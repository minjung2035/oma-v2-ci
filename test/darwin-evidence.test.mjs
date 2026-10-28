/** Evidence bookkeeping tests do not manufacture Darwin kernel observations. */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, openSync, closeSync, writeFileSync, fstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DARWIN_PROGRAMS, darwinCasePlan, validateDarwinObservation, validateDarwinCaseSet } from "../scripts/darwin-cases.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
// Record grammar only: these are parser inputs, never kernel observations.
const descriptorRecord = () => ({ platform: "darwin",
  devFd: { attempted: true, openReturn: -1, openErrno: 13, sameInode: null, closeOnExec: null,
    accessMode: null, sourceBefore: null, sourceAfter: null, duplicateBefore: null, duplicateAfter: null },
  fileport: { available: false, makeportReturn: null, makeportErrno: null,
    duplicate: { attempted: false, openReturn: null, openErrno: null, sameInode: null, closeOnExec: null,
      accessMode: null, sourceBefore: null, sourceAfter: null, duplicateBefore: null, duplicateAfter: null } },
  namespace: { heldAfterSwap: true, namedIsReplacement: true, heldAfterUnlink: true },
  exec: { direct: { execErrno: null, exitCode: 0, signal: null, reply: "original" },
    fdBeforeSwap: { execErrno: 13, exitCode: 125, signal: null, reply: "exec-error" },
    namedAfterSwap: { execErrno: null, exitCode: 0, signal: null, reply: "replacement" },
    fdAfterSwap: { execErrno: 13, exitCode: 125, signal: null, reply: "exec-error" },
    fdAfterUnlink: { execErrno: 13, exitCode: 125, signal: null, reply: "exec-error" } } });
const keptDescriptorRecord = () => ({ exactChannelsRetained: true, stdinTransportRetainedSameChannels: true,
  extraCanaryDetectedInControl: true, malformedPolicyRefused: true, directChildrenClosed: true,
  samePidAfterExec: true, loweredHardLimitPruned: true, stdioCloexecRetained: true,
  emptyKeepListPruned: true, missingChannelRefused: true, missingTargetRefused: true,
  actorSha256: "a".repeat(64), pruneControlSha256: "b".repeat(64) });
const signalRecord = () => ({ inherited: { returnCode: 0, errno: 0, delivered: true },
  fresh: { returnCode: -1, errno: 1, delivered: false },
  nestedApplyReturnCode: -1, nestedApplyErrno: 1, afterNested: { returnCode: 0, errno: 0, delivered: true },
  unreapedPidControl: true, ownedChildrenJoined: true });
const coalitionQuery = (started = "1", exited = "0") =>
  ({ available: true, returnCode: 0, errno: 0, started, exited });
const admissionAttempt = (name, requestedResource, spawned) => ({ name, requestedResource, attributeStatus: 0,
  spawnStatus: spawned ? 0 : 1, pid: spawned ? 103 : 0, stopped: spawned, joined: spawned,
  coalitionBytes: spawned ? 40 : 0, coalitionErrno: 0, actualResource: spawned ? "41" : "0", waitStatus: spawned ? 9 : 0 });
const memberControl = (pid, matched) => ({ controllerPid: 200 + pid, controllerUid: 501, targetPid: pid,
  expectedResource: "41", before: { bytes: 56, errno: 0, unique: String(1000 + pid), version: 7 },
  membership: { bytes: 40, errno: 0, resource: matched ? "41" : "42" },
  taskNameStatus: matched ? 0 : -1, taskInfoStatus: matched ? 0 : -1, namePortReleaseStatus: matched ? 0 : -1,
  auditCount: 8, auditPid: matched ? pid : 0, auditUid: matched ? 501 : 0, auditPidVersion: matched ? 7 : 0,
  after: matched ? { bytes: 56, errno: 0, unique: String(1000 + pid), version: 7 } : { bytes: 0, errno: 0, unique: "0", version: 0 },
  correlated: matched, signalStatus: matched ? 0 : -1 });
const discoveryRound = (pid, closed) => ({ discovery: { hintOnly: true, resource: "41", capacity: 10,
  listed: 1, errno: 0, saturated: false, candidatePids: [pid], unreadable: 0 },
  controls: [memberControl(pid, true)], elapsedMs: 100,
  aggregate: closed ? { ...coalitionQuery("0", "0"), returnCode: -1, errno: 3 } : coalitionQuery("2", "1"),
  otherAggregate: coalitionQuery() });
const launchctlRecord = (command, target) => ({ executable: "/bin/launchctl", argv: [command, target],
  exitCode: 0, signal: null, stdout: "", stderr: "" });
const launchdRecord = name => ({ fixtureOnly: true, controlledGenerationsExited: true,
  jobRegistrationsRemoved: true, cleanupFaults: [], actorSourceSha256: "c".repeat(64),
  domain: "gui/501",
  ...(name === "launchd-image" ? { matchingA: { variant: 1 }, matchingB: { variant: 2 },
    cdhashes: ["a".repeat(40), "b".repeat(40)], replacedImage: { markerAfterTwoSeconds: false } }
    : { scope: { members: { leader: { resource: "41" }, detached: { pid: 101, sandboxed: true } }, control: { resource: "42", pid: 102 },
      afterBootout: { otherAcknowledged: true },
      admission: { privateInterface: true, available: true, uid: 501, callerResource: "41",
        attempts: [admissionAttempt("inherited", "0", true), admissionAttempt("explicit-own", "41", false),
          admissionAttempt("explicit-other", "42", false)] },
      seatbelt: { renderer: "production-seatbeltProfile", sha256: "d".repeat(64),
        serviceTarget: "gui/501/org.oma.probe.test.service-target",
        positiveServiceTarget: "gui/501/org.oma.probe.test.service-positive", positiveServiceControl: { pid: 107 },
        positiveServiceKickstart: launchctlRecord("kickstart", "gui/501/org.oma.probe.test.service-positive"),
        positiveServiceAfter: launchctlRecord("print", "gui/501/org.oma.probe.test.service-positive"),
        serviceBefore: launchctlRecord("print", "gui/501/org.oma.probe.test.service-target"),
        attempt: { sandboxApplied: true, target: "gui/501/org.oma.probe.test.service-target",
          spawnStatus: 0, childPid: 108, waitStatus: 256, joined: true, numericCleanupUsed: false },
        serviceAfter: launchctlRecord("print", "gui/501/org.oma.probe.test.service-target"), guestEffect: null },
      recovery: { context: "fresh-exec-no-profile-applied", tokenSource: "kernel-task-name-port",
        fixtureReleaseUsedBeforeObservation: false, wrongMember: memberControl(102, false),
        remainingMember: memberControl(101, true), afterAttempt: {
          samples: [{ elapsedMs: 90, aggregate: { ...coalitionQuery("0", "0"), returnCode: -1, errno: 3 },
            otherAggregate: coalitionQuery() }] } },
      late: { pid: 105, resource: "41", sandboxed: true },
      discoveryRecovery: { input: "resource-coalition-only", beforeFixtureRelease: true,
        afterSnapshot: { pid: 106, resource: "41", sandboxed: true }, rounds: [discoveryRound(105, false), discoveryRound(106, true)] },
      afterControlledExit: { controlledGenerationsExited: true,
        samples: [{ elapsedMs: 100, aggregate: { ...coalitionQuery("0", "0"), returnCode: -1, errno: 3 },
          otherAggregate: coalitionQuery() }] } } }) });
const bootstrapRecord = () => {
  const git = "/selected/usr/bin/git", digest = "a".repeat(40);
  const command = (executable, argv, pid, stdout = "") => ({ executable, argv, pid, exitCode: 0, signal: null, stdout, stderr: "" });
  const dns = { hostname: "example.com", addresses: [{ address: "192.0.2.1", family: 4 }] };
  const nativeDns = (pid, bootstrap = 200, seed = 201) => ({ phase: "native-dns", pid, uid: 501,
    hostname: "example.com", endpoint: "/var/run/mDNSResponder", ports: { bootstrap, registered: [seed] },
    socket: { created: true, errno: 0, connectAttempted: true, connectResult: 0, connectErrno: 0 },
    dnssd: { createResult: 0 }, getaddrinfo: { result: 0, errno: 0, ipv4: 1, ipv6: 0 } });
  const variants = ["inherited", "bootstrap-only", "bootstrap-and-xpc"].map((name, index) => {
    const attempt = kind => {
      const pid = 120 + index * 3 + (kind === "direct" ? 0 : kind === "node" ? 1 : 2);
      const target = `gui/501/org.oma.probe.test.${name}-${kind}`;
      const seed = name === "bootstrap-and-xpc" ? 0 : 201;
      return { target, command: command("/owned/bootstrap-exec",
        [name, "/owned/profile", "/owned/ports", "/owned/work",
          ...(kind === "direct" ? ["/bin/launchctl", "kickstart", target] : kind === "node" ?
            ["/owned/node", "/owned/tools", target, "/owned/canary", "/owned/clang", git, "{}", "/owned/bootstrap-exec", "/owned/report"] :
            ["/owned/bootstrap-exec", "restore-registered-seed", "/owned/restoration", "/bin/launchctl", "kickstart", target])], pid),
        ports: { mode: name, pid, uid: 501, sandboxApplied: true, preExecObservation: true,
          before: { bootstrap: 200, registered: [201] },
          after: { bootstrap: name === "inherited" ? 200 : 0, registered: [seed] },
          droppedSendRights: name === "inherited" ? [] : [200] }, guestEffect: null,
        ...(kind === "node" ? { tools: { pid, complete: true,
          service: command("/bin/launchctl", ["kickstart", target], 150 + index),
          git: command(git, ["hash-object"], 160 + index, `${digest}\n`),
          compiler: command("/owned/clang", ["-fsyntax-only", "compile.c"], 170 + index), dns,
          nativeDnsCommand: command("/owned/bootstrap-exec", ["observe-dns", "/owned/report.dns.json"], 180 + index),
          nativeDns: nativeDns(180 + index, name === "inherited" ? 200 : 0, seed) } } : {}),
        ...(kind === "restored" ? { restoration: { pid, uid: 501, phase: "restore-registered-seed", seed,
          attempted: seed !== 0, setStatus: seed ? 0 : null,
          before: { bootstrap: name === "inherited" ? 200 : 0, registered: [seed] },
          after: { bootstrap: seed, registered: [seed] } } } : {}) };
    };
    return { name, profileSha256: "e".repeat(64), canaryPreserved: true,
      direct: attempt("direct"), node: attempt("node"), restored: attempt("restored") };
  });
  return { fixtureOnly: true, controlledGenerationsExited: true, jobRegistrationsRemoved: true,
    cleanupFaults: [], actorSourceSha256: "c".repeat(64), domain: "gui/501",
    bootstrap: { renderer: "production-seatbeltProfile", sourceSha256: "d".repeat(64), executableSha256: "e".repeat(64),
      positiveTarget: "gui/501/org.oma.probe.test.positive",
      positiveKickstart: { ...launchctlRecord("kickstart", "gui/501/org.oma.probe.test.positive"), pid: 119 },
      positiveControl: { pid: 118 }, developerTools: { git }, gitExpected: digest,
      positiveGit: command(git, ["hash-object", "git-control.txt"], 116, `${digest}\n`),
      hostDns: command("/owned/node", ["--input-type=module"], 117, JSON.stringify(dns)),
      nativeDnsHostCommand: command("/owned/bootstrap-exec", ["observe-dns", "/owned/host-native-dns.json"], 115),
      nativeDnsHost: nativeDns(115),
      dnsEndpoint: "/var/run/mDNSResponder", dnsResolvedEndpoint: "/private/var/run/mDNSResponder", variants } };
};
const personalRecord = () => ({ actualTerminal: true, cleanExit: true, terminalRestored: true,
  noSocietyProvisioned: true, societyRefusedBeforeState: true, birthMode: "personal", birthCwd: "/owned/project",
  input: "ctrl-d", credentialFixture: false });
const suspendedRecord = () => {
  const attempt = variant => ({ stopped: true, stopSignal: 17, beforeRelease: {
    constructor: false, main: false, stdoutBytes: 0, stderrBytes: 0 },
    copyStatus: 0, primary: { parseStatus: 0, validationStatus: 0 }, alternate: null,
    released: true, childReaped: true, supervisorJoined: true, exitCode: 0, signal: null,
    constructor: variant ? { variant, pid: 100 + variant } : null,
    main: variant ? { variant, pid: 100 + variant } : null, targetStdout: "" });
  const refused = () => ({ ...attempt(), primary: { parseStatus: 0, validationStatus: -1 },
    alternate: { parseStatus: 0, validationStatus: 0 }, released: false, exitCode: null, signal: 9 });
  const signature = hash => ({ sha256: "d".repeat(64), cdhashes: [hash.repeat(40)] });
  return { fixtureOnly: true, scope: "main-image-only", unreapedPidControl: true, ownedChildrenJoined: true,
    scriptRequirementNamesInterpreter: true, sourceSha256: { controller: "c".repeat(64), target: "d".repeat(64) },
    images: { a: signature("a"), b: signature("b") },
    tools: Object.fromEntries(["node", "git", "compiler", "shell"].map(key => [key, signature("c")])),
    positive: { a: attempt(1), b: attempt(2), node: { ...attempt(), main: { kind: "node" } },
      git: { ...attempt(), targetStdout: "git version fixture" }, compiler: { ...attempt(), targetStdout: "clang version fixture" },
      script: { ...attempt(), main: { kind: "script" } } }, mismatch: refused(), restoredPath: refused() };
};
const tokenControlRecord = () => ({ scope: "owned-child-generation-only", controllerContext: "sibling-fork-no-profile-applied", sdkInterfacePrivate: true,
  kernelTokenReceived: true, ownerPid: 100, ownerUid: 501, controllerPid: 101, controllerUid: 501,
  targetPid: 102, targetUid: 501, targetPidVersion: 7,
  zeroSignalStatus: 22, wrongVersionStatus: 3, killStatus: 0,
  exitedBeforeCleanup: true, numericCleanupUsed: false, targetExitCode: null, targetSignal: 9,
  unreapedPidControl: true, ownedChildrenJoined: true });
const rows = () => darwinCasePlan().map(({ observation, ...planned }) => ({ ...planned,
  execution: "EXECUTED", status: "OBSERVED", exitCode: 0, signal: null, cleanup: "returned",
  observations: { [observation]: planned.name === "file-descriptors" ? descriptorRecord() :
    planned.name === "seatbelt-kept-fds" ? keptDescriptorRecord() :
      planned.name === "seatbelt-signals" ? signalRecord() :
        planned.name === "launchd-bootstrap" ? bootstrapRecord() :
        ["launchd-scope", "launchd-image"].includes(planned.name) ? launchdRecord(planned.name) :
          planned.name === "personal-entry" ? personalRecord() :
            planned.name === "suspended-image" ? suspendedRecord() :
              planned.name === "mach-token-control" ? tokenControlRecord() : { fixtureAssertionReturned: true } } }));

test("NATIVE-DARWIN: generation control retains nonparent identity, SDK status, actual termination and cleanup context", () => {
  const good = tokenControlRecord();
  validateDarwinObservation("mach-token-control", { machTokenControl: good });
  for (const change of [
    value => { value.kernelTokenReceived = false; },
    value => { value.sdkInterfacePrivate = false; },
    value => { value.ownerUid = 0; value.controllerUid = 0; value.targetUid = 0; },
    value => { value.controllerPid = value.ownerPid; },
    value => { value.targetUid += 1; },
    value => { value.targetPidVersion = 0; },
    value => { value.killStatus = -1; },
    value => { delete value.wrongVersionStatus; },
    value => { value.numericCleanupUsed = true; },
    value => { value.targetSignal = null; },
    value => { value.ownedChildrenJoined = false; },
  ]) {
    const bad = structuredClone(good); change(bad);
    assert.throws(() => validateDarwinObservation("mach-token-control", { machTokenControl: bad }));
  }
  // Real denial or a generation-check counterexample must remain observable,
  // never be relabelled as a qualified production scope.
  const denied = { ...good, killStatus: 1, exitedBeforeCleanup: false, numericCleanupUsed: true };
  validateDarwinObservation("mach-token-control", { machTokenControl: denied });
  validateDarwinObservation("mach-token-control", { machTokenControl: { ...good, wrongVersionStatus: 0 } });
});

test("NATIVE-DARWIN: descriptor inheritance records require PID, hard-limit, stdio and refusal controls", () => {
  const good = keptDescriptorRecord();
  assert.doesNotThrow(() => validateDarwinObservation("seatbelt-kept-fds", { seatbeltFault: good }));
  for (const key of Object.keys(good)) {
    for (const value of [undefined, null, false, "unobserved"]) {
      const bad = { ...good, [key]: value };
      if (value === undefined) delete bad[key];
      assert.throws(() => validateDarwinObservation("seatbelt-kept-fds", { seatbeltFault: bad }), `${key}: ${value}`);
    }
  }
});

test("NATIVE-DARWIN: signal observations refuse missing PID, delivery and inherited positive controls", () => {
  const good = signalRecord();
  for (const bad of [
    { ...good, unreapedPidControl: false },
    { ...good, ownedChildrenJoined: false },
    { ...good, inherited: { returnCode: -1, errno: 1, delivered: false } },
    { ...good, fresh: { returnCode: 0, errno: 0, delivered: false } },
    { ...good, afterNested: { returnCode: -1, errno: 0, delivered: false } },
    { ...good, nestedApplyReturnCode: "unknown" },
  ]) assert.throws(() => validateDarwinObservation("seatbelt-signals", { seatbeltSignals: bad }));
});

test("NATIVE-DARWIN: launchd observations reject missing image controls, cleanup and live independent jobs", () => {
  const good = launchdRecord("launchd-image");
  for (const bad of [
    { ...good, fixtureOnly: false },
    { ...good, controlledGenerationsExited: false },
    { ...good, jobRegistrationsRemoved: false },
    { ...good, cleanupFaults: ["unknown child"] },
    { ...good, matchingB: { variant: 1 } },
    { ...good, cdhashes: [good.cdhashes[0], good.cdhashes[0]] },
    { ...good, replacedImage: {} },
  ]) assert.throws(() => validateDarwinObservation("launchd-image", { launchdImage: bad }));
  assert.throws(() => validateDarwinObservation("launchd-scope",
    { launchdScope: { ...launchdRecord("launchd-scope"), scope: { afterBootout: { otherAcknowledged: false } } } }));
});
test("NATIVE-DARWIN: launchd scope refuses ambiguous lookup, admission and child cleanup evidence", () => {
  const good = launchdRecord("launchd-scope");
  for (const corrupt of [
    scope => { delete scope.admission; },
    scope => { scope.admission.privateInterface = false; },
    scope => { scope.admission.uid = 0; },
    scope => { scope.admission.callerResource = "42"; },
    scope => { scope.admission.attempts[2].requestedResource = "999"; },
    scope => { scope.admission.available = false; },
    scope => { scope.admission.attempts[0].joined = false; },
    scope => { scope.admission.attempts[2].pid = 104; },
    scope => { delete scope.afterControlledExit; },
    scope => { scope.afterControlledExit.controlledGenerationsExited = false; },
    scope => { scope.afterControlledExit.samples = []; },
    scope => { scope.afterControlledExit.samples[0].aggregate.available = "unknown"; },
    scope => { scope.afterControlledExit.samples[0].aggregate.errno = 0; },
    scope => { delete scope.afterControlledExit.samples[0].otherAggregate; },
    scope => { delete scope.recovery; },
    scope => { scope.recovery.context = "inherited"; },
    scope => { scope.recovery.tokenSource = "peer-supplied-port"; },
    scope => { scope.recovery.fixtureReleaseUsedBeforeObservation = true; },
    scope => { scope.recovery.wrongMember.expectedResource = "42"; },
    scope => { scope.recovery.wrongMember.signalStatus = 0; },
    scope => { scope.recovery.remainingMember.after.unique = "100"; },
    scope => { scope.recovery.remainingMember.auditPidVersion = 8; },
    scope => { scope.recovery.remainingMember.namePortReleaseStatus = -1; },
    scope => { scope.recovery.afterAttempt.samples[0].aggregate.errno = 0; },
    scope => { delete scope.discoveryRecovery; },
    scope => { scope.discoveryRecovery.input = "saved-pids"; },
    scope => { scope.discoveryRecovery.beforeFixtureRelease = false; },
    scope => { delete scope.discoveryRecovery.afterSnapshot; },
    scope => { scope.discoveryRecovery.rounds = []; },
    scope => { scope.discoveryRecovery.rounds[0].discovery.hintOnly = false; },
    scope => { scope.discoveryRecovery.rounds[0].discovery.listed = 0; },
    scope => { scope.discoveryRecovery.rounds[0].controls = []; },
    scope => { scope.discoveryRecovery.rounds[0].controls[0].targetPid = 106; },
    scope => { delete scope.discoveryRecovery.rounds[1].aggregate; },
    scope => { delete scope.seatbelt; },
    scope => { scope.seatbelt.renderer = "permissive fixture"; },
    scope => { scope.members.detached.sandboxed = false; },
    scope => { scope.discoveryRecovery.afterSnapshot.sandboxed = false; },
    scope => { scope.seatbelt.attempt.target = "gui/501/foreign"; },
    scope => { scope.seatbelt.attempt.joined = false; },
    scope => { scope.seatbelt.positiveServiceControl.pid = 0; },
    scope => { delete scope.seatbelt.positiveServiceTarget; },
    scope => { scope.seatbelt.positiveServiceTarget = scope.seatbelt.serviceTarget; },
    scope => { scope.seatbelt.positiveServiceTarget = "gui/502/foreign"; },
    scope => { delete scope.seatbelt.positiveServiceKickstart; },
    scope => { scope.seatbelt.positiveServiceKickstart.argv[1] = scope.seatbelt.serviceTarget; },
    scope => { scope.seatbelt.positiveServiceKickstart.exitCode = 1; },
    scope => { scope.seatbelt.positiveServiceAfter.argv[1] = scope.seatbelt.serviceTarget; },
    scope => { delete scope.seatbelt.serviceBefore; },
    scope => { scope.seatbelt.serviceBefore.argv[1] = scope.seatbelt.positiveServiceTarget; },
    scope => { scope.seatbelt.serviceAfter.argv[1] = scope.seatbelt.positiveServiceTarget; },
    scope => { delete scope.seatbelt.guestEffect; },
  ]) {
    const bad = structuredClone(good); corrupt(bad.scope);
    assert.throws(() => validateDarwinObservation("launchd-scope", { launchdScope: bad }));
  }
});

test("NATIVE-DARWIN: bootstrap evidence retains rights, actual targets, compatibility failures and distinct controls", () => {
  const good = bootstrapRecord();
  validateDarwinObservation("launchd-bootstrap", { launchdBootstrap: good });
  validateDarwinCaseSet(rows());
  for (const corrupt of [
    value => { value.bootstrap.variants.pop(); },
    value => { value.bootstrap.variants[1].name = "inherited"; },
    value => { value.bootstrap.variants[0].direct.target = value.bootstrap.positiveTarget; },
    value => { value.bootstrap.positiveKickstart.argv[1] = value.bootstrap.variants[0].direct.target; },
    value => { value.bootstrap.variants[0].direct.ports = null; value.bootstrap.variants[0].direct.command.exitCode = 2; },
    value => { value.bootstrap.variants[1].direct.command.argv[6] = "gui/501/foreign"; },
    value => { value.bootstrap.variants[2].direct.ports.sandboxApplied = false; },
    value => { value.bootstrap.variants[2].direct.ports.pid += 1; },
    value => { delete value.bootstrap.variants[2].direct.ports.after; },
    value => { value.bootstrap.variants[2].node.tools = null; },
    value => { value.bootstrap.variants[2].node.command.argv[6] = "gui/501/foreign"; },
    value => { value.bootstrap.variants[2].node.tools.service.argv[1] = "gui/501/foreign"; },
    value => { value.bootstrap.positiveGit.executable = "/usr/bin/git"; },
    value => { value.bootstrap.positiveGit.exitCode = 1; },
    value => { value.bootstrap.hostDns.stdout = JSON.stringify({ hostname: "example.com", error: { code: "ENOTFOUND" } }); },
    value => { value.bootstrap.nativeDnsHost.dnssd.createResult = -65555; },
    value => { value.bootstrap.nativeDnsHost.getaddrinfo.ipv4 = 0; },
    value => { value.bootstrap.variants[1].node.tools.nativeDns.pid += 1; },
    value => { value.bootstrap.variants[1].node.tools.nativeDns = null; },
    value => { value.bootstrap.dnsEndpoint = "*"; },
    value => { value.bootstrap.variants[0].restored.target = value.bootstrap.variants[0].direct.target; },
    value => { value.bootstrap.variants[1].restored.restoration.pid += 1; },
    value => { value.bootstrap.variants[1].restored.restoration.uid += 1; },
    value => { value.bootstrap.variants[1].restored.restoration.seed += 1; },
    value => { value.bootstrap.variants[1].restored.restoration.setStatus = 0x80000000; },
    value => { value.bootstrap.variants[2].restored.restoration.setStatus = 0; },
    value => { value.bootstrap.variants[1].restored.command.argv[9] = "gui/501/foreign"; },
    value => { value.bootstrap.variants[1].node.tools.git.executable = "/usr/bin/git"; },
    value => { delete value.bootstrap.variants[2].canaryPreserved; },
  ]) {
    const bad = structuredClone(good); corrupt(bad);
    assert.throws(() => validateDarwinObservation("launchd-bootstrap", { launchdBootstrap: bad }));
  }
  const unknown = structuredClone(good);
  unknown.bootstrap.variants[2].direct.command = { ...unknown.bootstrap.variants[2].direct.command,
    exitCode: null, signal: "SIGKILL", error: "ETIMEDOUT" };
  unknown.bootstrap.variants[2].node.command = { ...unknown.bootstrap.variants[2].node.command, exitCode: 126 };
  unknown.bootstrap.variants[2].node.tools = null;
  unknown.bootstrap.variants[2].canaryPreserved = false;
  unknown.bootstrap.variants[1].restored.command.exitCode = 126;
  unknown.bootstrap.variants[1].restored.restoration.setStatus = -303;
  unknown.bootstrap.variants[1].restored.restoration.after = unknown.bootstrap.variants[1].restored.restoration.before;
  unknown.bootstrap.variants[1].node.tools.nativeDns.socket.connectResult = -1;
  unknown.bootstrap.variants[1].node.tools.nativeDns.socket.connectErrno = 1;
  unknown.bootstrap.variants[1].node.tools.nativeDns.dnssd.createResult = -65555;
  unknown.bootstrap.variants[1].node.tools.nativeDns.getaddrinfo = { result: -2, errno: 1, ipv4: 0, ipv6: 0 };
  unknown.bootstrap.variants[0].node.tools.nativeDnsCommand = {
    ...unknown.bootstrap.variants[0].node.tools.nativeDnsCommand, exitCode: null, signal: "SIGKILL", error: "ETIMEDOUT" };
  unknown.bootstrap.variants[0].node.tools.nativeDns = null;
  validateDarwinObservation("launchd-bootstrap", { launchdBootstrap: unknown });
});

test("NATIVE-DARWIN: Personal startup cannot hide a Society gate bypass or a changed saved mode", () => {
  const good = personalRecord();
  for (const bad of [
    { ...good, societyRefusedBeforeState: false }, { ...good, noSocietyProvisioned: false },
    { ...good, terminalRestored: false }, { ...good, birthMode: "society" }, { ...good, credentialFixture: true },
  ]) assert.throws(() => validateDarwinObservation("personal-entry", { personal: bad }));
});

test("NATIVE-DARWIN: suspended image observations require real positive contexts and coherent pre-release validation", () => {
  const good = suspendedRecord();
  assert.doesNotThrow(() => validateDarwinObservation("suspended-image", { suspendedImage: good }));
  // START_SUSPENDED is a kernel task stop, not delivery of a particular signal.
  const initialStop = structuredClone(good); initialStop.positive.a.stopSignal = 0;
  validateDarwinObservation("suspended-image", { suspendedImage: initialStop });
  for (const change of [
    value => { value.ownedChildrenJoined = false; },
    value => { delete value.sourceSha256.controller; },
    value => { value.images.b = value.images.a; },
    value => { value.positive.a.beforeRelease.constructor = true; },
    value => { value.positive.a.stopSignal = -1; },
    value => { value.positive.node.primary.validationStatus = -1; },
    value => { value.positive.compiler.targetStdout = ""; },
    value => { value.mismatch.released = true; },
    value => { value.restoredPath.alternate = null; },
    value => { value.restoredPath.constructor = { variant: 2, pid: 102 }; },
  ]) {
    const bad = structuredClone(good); change(bad);
    assert.throws(() => validateDarwinObservation("suspended-image", { suspendedImage: bad }));
  }
  // A real counterexample is an observation, not a product PASS. Preserve
  // evidence that a wrong image actually ran when validation let it through.
  const counterexample = structuredClone(good);
  counterexample.restoredPath = { ...structuredClone(good.positive.b), alternate: { parseStatus: 0, validationStatus: -1 } };
  assert.doesNotThrow(() => validateDarwinObservation("suspended-image", { suspendedImage: counterexample }));
});


for (const [name, change] of [
  ["omitted attempt", list => list.pop()],
  ["extra attempt", list => list.push(structuredClone(list[0]))],
  ["duplicate hiding another attempt", list => { list[1] = structuredClone(list[0]); }],
  ["wrong program", list => { list[0].program = "another-program"; }],
  ["invented case", list => { list[0].name = "not-required"; }],
  ["out-of-range iteration", list => { list[0].iteration = 3; }],
  ["string iteration", list => { list[0].iteration = "0"; }],
  ["missing row", list => { list[0] = null; }],
  ["PASS relabel", list => { list[0].status = "PASS"; }],
  ["unexecuted observation", list => { list[0].execution = "NOT_RUN"; }],
  ["nonzero exit", list => { list[0].exitCode = 125; }],
  ["missing exit", list => { delete list[0].exitCode; }],
  ["signal", list => { list[0].signal = "SIGKILL"; }],
  ["missing signal observation", list => { delete list[0].signal; }],
  ["spawn failure", list => { list[0].error = "ENOENT"; }],
  ["cleanup not returned", list => { delete list[0].cleanup; }],
  ["cleanup failure", list => { list[0].cleanupError = "return unknown"; }],
  ["artifact write failure", list => { list[0].artifactError = "ENOSPC"; }],
  ["wrong observation owner", list => { list[0].observations = { files: { returned: true } }; }],
  ["empty observation", list => { list[0].observations = { process: {} }; }],
  ["extra observation", list => { list[0].observations.files = { returned: true }; }],
]) test(`NATIVE-DARWIN: evidence refuses ${name}`, () => {
  const list = rows(); change(list); assert.throws(() => validateDarwinCaseSet(list));
});

test("NATIVE-DARWIN: failed attempts remain explicit failures, never observations", () => {
  const list = rows(); list[0] = { ...darwinCasePlan()[0], execution: "NOT_RUN", status: "SETUP_FAILED", error: "SDK unavailable" };
  assert.doesNotThrow(() => validateDarwinCaseSet(list));
  for (const value of [null, [], "completed", true, 0, {}])
    assert.throws(() => validateDarwinObservation("process", { process: value }));
  assert.throws(() => validateDarwinObservation("unknown", { process: { returned: true } }));
});


if (process.platform === "linux") test("NATIVE-DARWIN: actual Linux driver refuses Darwin and records every NOT_RUN", () => {
  const out = mkdtempSync(join(tmpdir(), "oma-darwin-refusal-"));
  try {
    const child = spawnSync(process.execPath, [join(root, "scripts/verify-native.mjs"), out],
      { cwd: root, encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
    assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, 2, child.stderr);
    const result = JSON.parse(readFileSync(join(out, "result.json"), "utf8"));
    assert.equal(result.provenance.platform, "linux"); assert.equal(result.status, "SETUP_FAILED");
    assert.match(result.error, /require a real Darwin kernel/);
    assert.equal(result.summary.observed, 0); assert.equal(result.summary.executed, 0);
    assert.equal(result.summary.productQualification, "BLOCKED");
    assert.equal(result.compilations.length, DARWIN_PROGRAMS.length);
    assert.ok(result.compilations.every(row => row.status === "NOT_RUN"));
    validateDarwinCaseSet(result.cases);
    for (const row of result.cases) {
      assert.equal(row.status, "SETUP_FAILED"); assert.equal(row.execution, "NOT_RUN");
      assert.equal(row.observations, undefined);
      const retained = JSON.parse(readFileSync(join(out, "cases", `${row.name}-${row.iteration}`, "result.json"), "utf8"));
      assert.deepEqual(retained, row);
    }
    assert.deepEqual(Object.keys(result.gates).sort(), ["G-AUTH", "G-FILES", "G-PROCESS"]);
    assert.ok(Object.values(result.gates).every(row => row.status === "OPEN"));
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("NATIVE-DARWIN: real FD oracle distinguishes an inherited canary from a returned descriptor", () => {
  const out = mkdtempSync(join(tmpdir(), "oma-fd-oracle-")); let fd;
  try {
    const binary = join(out, "observer"), source = join(root, "test/fixtures/darwin-fd-observer.c");
    const compiler = process.platform === "darwin" ? "/usr/bin/xcrun" : "/usr/bin/cc";
    const argv = [...(process.platform === "darwin" ? ["clang"] : []), "-Wall", "-Wextra", "-Werror", source, "-o", binary];
    const compiled = spawnSync(compiler, argv, { encoding: "utf8", timeout: 30000 });
    assert.equal(compiled.error, undefined); assert.equal(compiled.signal, null); assert.equal(compiled.status, 0, compiled.stderr);
    const canary = join(out, "canary"); writeFileSync(canary, "actual fixture-owned inode"); fd = openSync(canary, "r");
    const info = fstatSync(fd, { bigint: true }), args = [String(info.dev), String(info.ino)];
    for (const inherited of [true, false]) {
      const child = spawnSync(binary, args, { encoding: "utf8", timeout: 30000,
        stdio: ["ignore", "pipe", "pipe", ...(inherited ? [fd] : [])] });
      assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, inherited ? 3 : 0, child.stderr);
      const observed = JSON.parse(child.stdout); assert.equal(observed.leaked, inherited); assert.ok(observed.checkedTo > 3);
    }
    for (const malformed of ["-1", "+1", "1x", "", "184468040737095516160"]) {
      const child = spawnSync(binary, [malformed, args[1]], { encoding: "utf8", timeout: 10000 });
      assert.equal(child.status, 2); assert.match(child.stderr, /invalid FD oracle identity/);
    }
  } finally { if (fd !== undefined) closeSync(fd); rmSync(out, { recursive: true, force: true }); }
});

if (process.platform === "linux") test("NATIVE-DARWIN: Worker fixture refuses the actual Linux kernel before creating state", () => {
  const work = mkdtempSync(join(tmpdir(), "oma-worker-refusal-"));
  try {
    const child = spawnSync(process.execPath, [join(root, "test/fixtures/darwin-worker.mjs"), "worker-bootstrap"],
      { cwd: work, encoding: "utf8", timeout: 10000 });
    assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, 1);
    assert.match(child.stderr, /Worker observations require the actual Darwin kernel/);
    assert.deepEqual(readdirSync(work), []);
  } finally { rmSync(work, { recursive: true, force: true }); }
});

