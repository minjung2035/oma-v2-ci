/** Public launchctl experiment, not a production backend or a passed gate.
 * The helper is controlled code. Marker files are fixture coordination, never
 * sender authentication, and their absence is never a process-death proof. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "node:net";
import { seatbeltProfile } from "@oma/platform-mac/seatbelt";
import { observeMacDeveloperTools } from "@oma/platform-mac/developer-tools";
import { runProcessSync } from "@oma/process/run";
import { GIT_ENV } from "@oma/process/policies";

assert.equal(process.platform, "darwin", "launchd observations require the actual Darwin kernel");
assert.ok(process.getuid() > 0, "launchd observations require an ordinary user");
const mode = process.argv[2];
assert.ok(["launchd-scope", "launchd-image", "launchd-bootstrap"].includes(mode));
const root = realpathSync(process.cwd()), started = performance.now();
// Plain user/UID bootstrap failed before spawning on both runners. Test a
// distinct GUI session context; this does not qualify headless operation.
const domain = `gui/${process.getuid()}`, prefix = `org.oma.probe.${randomUUID()}`;
const commands = [], jobs = [], targets = [];
const socketServers = [];
const observation = { domain, commands, fixtureOnly: true };
let cleaning = false, failure, socketDirectory;
function observe(executable, argv, maximum = 10000, environment = process.env) {
  const remaining = (cleaning ? 110000 : 80000) - (performance.now() - started);
  assert.ok(remaining > 0, "launchd fixture deadline");
  const result = spawnSync(executable, argv, { cwd: root, env: environment, encoding: "utf8",
    timeout: Math.max(1, Math.min(maximum, Math.floor(remaining))), killSignal: "SIGKILL", maxBuffer: 1024 * 1024 });
  const record = { executable, argv, pid: result.pid, exitCode: result.status, signal: result.signal,
    error: result.error?.message, errorCode: result.error?.code, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  commands.push(record);
  return record;
}
function run(executable, argv, required = true, environment = process.env) {
  const record = observe(executable, argv, 10000, environment);
  assert.equal(record.error, undefined, JSON.stringify(record));
  assert.equal(record.signal, null, JSON.stringify(record));
  if (required) assert.equal(record.exitCode, 0, JSON.stringify(record));
  return record;
}
const text = value => String(value).replace(/[&<>"']/g, character =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);
function xml(value) {
  if (Buffer.isBuffer(value)) return `<data>${value.toString("base64")}</data>`;
  if (Array.isArray(value)) return `<array>${value.map(xml).join("")}</array>`;
  if (typeof value === "boolean") return value ? "<true/>" : "<false/>";
  if (typeof value === "number") return `<integer>${value}</integer>`;
  if (typeof value === "object") return `<dict>${Object.entries(value).map(([key, entry]) => `<key>${text(key)}</key>${xml(entry)}`).join("")}</dict>`;
  return `<string>${text(value)}</string>`;
}
function loadJob(name, executable, mode, hash) {
  const label = `${prefix}.${name}`, directory = join(root, name), path = join(root, `${label}.plist`);
  mkdirSync(directory, { mode: 0o700 });
  const definition = { Label: label, Program: executable, ProgramArguments: [executable, mode, directory],
    WorkingDirectory: directory, RunAtLoad: false, KeepAlive: false, AbandonProcessGroup: false,
    ExitTimeOut: 1, StandardOutPath: join(directory, "stdout"), StandardErrorPath: join(directory, "stderr"),
    ...(hash === undefined ? {} : { SpawnConstraint: { cdhash: Buffer.from(hash, "hex") } }) };
  writeFileSync(path, `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0">${xml(definition)}</plist>`, { mode: 0o600 });
  // Submission failure can be ambiguous; cleanup still addresses our own label.
  const job = { label, target: `${domain}/${label}`, directory, active: true };
  jobs.push(job);
  run("/bin/launchctl", ["bootstrap", domain, path]);
  return job;
}
function bootout(job) {
  run("/bin/launchctl", ["bootout", job.target]); job.active = false;
}
async function waitFor(check, timeout = 8000) {
  const end = performance.now() + timeout;
  while (!check()) {
    assert.ok(performance.now() < end && performance.now() - started < (cleaning ? 108000 : 79000), "launchd observation timed out");
    await delay(25);
  }
}
function marker(directory, name) { return JSON.parse(readFileSync(join(directory, `${name}.json`), "utf8")); }
function remember(actor) {
  assert.ok(Number.isSafeInteger(actor.pid) && actor.pid > 1);
  assert.equal(actor.identity.pid, actor.pid);
  assert.equal(actor.identity.uniqueBytes, 56);
  assert.match(actor.identity.unique, /^[1-9][0-9]*$/);
  targets.push(actor.identity);
  return actor;
}
let actor;
function inspect(pid) { return JSON.parse(run(actor, ["inspect", String(pid)]).stdout); }
function usage(id) {
  if (!/^[1-9][0-9]*$/.test(id)) return { status: "NOT_QUERIED", reason: "no valid observed resource coalition" };
  return JSON.parse(run(actor, ["usage", id]).stdout);
}
async function observeReaping(id, other) {
  const samples = [], end = performance.now() + 2000;
  for (;;) {
    const aggregate = usage(id), otherAggregate = usage(other);
    samples.push({ elapsedMs: performance.now() - started, aggregate, otherAggregate });
    // ESRCH is a lookup observation, not a count==0 or marker-based inference.
    if (aggregate.available === true && aggregate.returnCode === -1 && aggregate.errno === 3 ||
        performance.now() >= end) break;
    await delay(100);
  }
  return { samples };
}
async function recoverFromHints(id, other, directory) {
  const rounds = [], end = performance.now() + 8000;
  let afterSnapshot;
  for (;;) {
    const discovery = JSON.parse(run(actor, ["candidates", id]).stdout);
    assert.ok(Array.isArray(discovery.candidatePids) &&
      discovery.candidatePids.every(pid => Number.isSafeInteger(pid) && pid > 1));
    if (rounds.length === 0) {
      writeFileSync(join(directory, "fork-after-snapshot"), "controlled birth after the first kernel snapshot");
      await waitFor(() => existsSync(join(directory, "after-snapshot.json")));
      // Observation/fixture cleanup only; never an input to member control.
      afterSnapshot = remember(marker(directory, "after-snapshot"));
    }
    const controls = discovery.candidatePids.map(pid =>
      JSON.parse(run(actor, ["signal-member", String(pid), id]).stdout));
    const aggregate = usage(id), otherAggregate = usage(other);
    rounds.push({ discovery, controls, elapsedMs: performance.now() - started, aggregate, otherAggregate });
    if (aggregate.available === true && aggregate.returnCode === -1 && aggregate.errno === 3 ||
        performance.now() >= end) break;
    await delay(25);
  }
  return { input: "resource-coalition-only", beforeFixtureRelease: true, afterSnapshot, rounds };
}
function originalExited(target) {
  const current = inspect(target.pid);
  // Read-only exact-generation observation; never a signal or empty-scope oracle.
  if (current.uniqueBytes === 0 && current.uniqueErrno === 3) return true;
  if (current.uniqueBytes !== 56) return false;
  return current.unique !== target.unique || current.version !== target.version ||
    current.bsdBytes === 136 && current.status === 5; // SDK SZOMB: no live task/writer.
}
try {
  observation.manager = Object.fromEntries(["manageruid", "managername", "managerpid"]
    .map(command => [command, run("/bin/launchctl", [command], false)]));
  observation.sip = run("/usr/bin/csrutil", ["status"], false);
  observation.boot = run("/usr/sbin/sysctl", ["-n", "kern.bootsessionuuid"]);
  const source = fileURLToPath(new URL("./darwin-launchd-actor.c", import.meta.url));
  observation.actorSourceSha256 = createHash("sha256").update(readFileSync(source)).digest("hex");
  const binaries = [], hashes = [];
  for (const variant of mode === "launchd-image" ? [1, 2] : [1]) {
    const binary = join(root, `actor-${variant}`);
    run("/usr/bin/xcrun", ["clang", "-Wall", "-Wextra", "-Werror", `-DPROBE_VARIANT=${variant}`, source, "-lproc", "-lbsm", "-lsandbox", "-o", binary]);
    run("/usr/bin/codesign", ["--force", "--sign", "-", binary]);
    const signature = run("/usr/bin/codesign", ["--display", "--verbose=4", binary]);
    const hash = /^CDHash=([0-9a-f]{40})$/m.exec(signature.stderr)?.[1];
    assert.ok(hash, JSON.stringify(signature)); binaries.push(binary); hashes.push(hash);
  }
  actor = binaries[0];
  observation.controllerChild = JSON.parse(run(actor, ["describe"]).stdout);
  observation.cdhashes = hashes;
  observation.executables = binaries.map(path => ({ path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") }));
  if (mode === "launchd-bootstrap") {
    const bootstrapSource = fileURLToPath(new URL("./darwin-bootstrap-exec.c", import.meta.url));
    const launcher = join(root, "bootstrap-exec");
    run("/usr/bin/xcrun", ["clang", "-Wall", "-Wextra", "-Werror", bootstrapSource, "-lproc", "-lsandbox", "-o", launcher]);
    const compiler = realpathSync(run("/usr/bin/xcrun", ["--find", "clang"]).stdout.trim());
    const sdk = realpathSync(run("/usr/bin/xcrun", ["--show-sdk-path"]).stdout.trim());
    const selectorHome = join(root, "developer-observation"); mkdirSync(selectorHome, { mode: 0o700 });
    const developerTools = await observeMacDeveloperTools(selectorHome, async command => {
      const remaining = Math.floor(80000 - (performance.now() - started));
      assert.ok(remaining > 0, "launchd selector fixture deadline");
      const result = runProcessSync({ ...command, timeoutMs: Math.min(command.timeoutMs, remaining) });
      commands.push({ executable: command.executable, argv: command.argv, ...result,
        stdout: result.stdout.toString("utf8"), stderr: result.stderr.toString("utf8") });
      return result;
    });
    assert.equal(process.env.DNSSD_UDS_PATH, undefined, "DNS endpoint override would change the observation");
    const dnsEndpoint = "/var/run/mDNSResponder", dnsResolvedEndpoint = realpathSync(dnsEndpoint);
    assert.ok(statSync(dnsResolvedEndpoint).isSocket(), "the declared DNS endpoint must be an actual socket");
    socketDirectory = realpathSync(mkdtempSync("/tmp/oma-unix-"));
    const unixSocketCanary = { directory: socketDirectory,
      listed: join(socketDirectory, "allowed"), unlisted: join(socketDirectory, "denied") };
    for (const path of [unixSocketCanary.listed, unixSocketCanary.unlisted]) {
      assert.ok(Buffer.byteLength(path) < 104, "actual Unix endpoint fits sockaddr_un");
      const server = createServer(socket => socket.destroy()); socketServers.push(server);
      server.on("error", error => { failure ??= error; });
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(path, () => { server.off("error", reject); resolve(); });
      });
      assert.ok(statSync(path).isSocket(), "Unix allowlist control must be listening");
    }
    const hostDns = run(process.execPath, ["--input-type=module", "-e",
      'import { lookup } from "node:dns/promises"; console.log(JSON.stringify({hostname:"example.com",addresses:await lookup("example.com",{all:true})}));']);
    const gitControlPath = join(root, "git-control.txt");
    const gitControlBytes = "BOOTSTRAP_NATIVE_OK\n"; writeFileSync(gitControlPath, gitControlBytes, { flag: "wx" });
    const gitExpected = createHash("sha1").update(`blob ${Buffer.byteLength(gitControlBytes)}\0${gitControlBytes}`).digest("hex");
    const gitEnvironment = JSON.stringify(GIT_ENV);
    const positiveGit = run(developerTools.git, ["--no-replace-objects", "hash-object", "--no-filters", "--", gitControlPath],
      true, { ...GIT_ENV, HOME: selectorHome, TMPDIR: selectorHome });
    assert.equal(positiveGit.stdout, `${gitExpected}\n`);
    const nativeDnsHostPath = join(root, "host-native-dns.json");
    const nativeDnsHostCommand = run(launcher, ["observe-dns", nativeDnsHostPath, unixSocketCanary.listed, unixSocketCanary.unlisted]);
    const nativeDnsHost = JSON.parse(readFileSync(nativeDnsHostPath, "utf8"));
    assert.equal(nativeDnsHost.socket.connectResult, 0, JSON.stringify(nativeDnsHost));
    assert.equal(nativeDnsHost.dnssd.createResult, 0, JSON.stringify(nativeDnsHost));
    assert.equal(nativeDnsHost.getaddrinfo.result, 0, JSON.stringify(nativeDnsHost));
    for (const socket of Object.values(nativeDnsHost.unixAllowlist))
      assert.equal(socket.connectResult, 0, JSON.stringify(nativeDnsHost));
    const script = join(root, "bootstrap-tools.mjs"), canary = join(root, "forbidden-canary");
    writeFileSync(canary, "HOST_CANARY\n", { flag: "wx" });
    writeFileSync(script, `
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { lookup } from "node:dns/promises";
const [target, canary, compiler, git, gitEnvironment, launcher, listedSocket, unlistedSocket, report] = process.argv.slice(2);
const value = { pid: process.pid, complete: false };
const save = () => writeFileSync(report, JSON.stringify(value));
const command = (executable, argv, environment = process.env) => {
  const child = spawnSync(executable, argv, { env: environment, encoding: "utf8", timeout: 5000, killSignal: "SIGKILL" });
  return { executable, argv, pid: child.pid, exitCode: child.status, signal: child.signal,
    error: child.error?.message, errorCode: child.error?.code, stdout: child.stdout ?? "", stderr: child.stderr ?? "" };
};
save();
value.service = command("/bin/launchctl", ["kickstart", target]); save();
try { writeFileSync("node-output.txt", "BOOTSTRAP_NATIVE_OK\\n"); value.write = "BOOTSTRAP_NATIVE_OK\\n"; }
catch (error) { value.writeError = { code: error.code, message: error.message }; }
try { writeFileSync(canary, "UNEXPECTED_WRITE\\n"); value.deniedWrite = "unexpected-success"; }
catch (error) { value.deniedWrite = error.code; }
save();
value.git = command(git, ["--no-replace-objects", "hash-object", "--no-filters", "--", "node-output.txt"],
  { ...JSON.parse(gitEnvironment), HOME: process.cwd(), TMPDIR: process.cwd() }); save();
writeFileSync("compile.c", "int main(void) { return 0; }\\n");
value.compiler = command(compiler, ["-fsyntax-only", "compile.c"]); save();
try { value.dns = { hostname: "example.com", addresses: await lookup("example.com", { all: true }) }; }
catch (error) { value.dns = { hostname: "example.com", error: { code: error.code, message: error.message } }; }
const nativeDnsPath = report + ".dns.json";
value.nativeDnsCommand = command(launcher, ["observe-dns", nativeDnsPath, listedSocket, unlistedSocket]);
value.nativeDns = existsSync(nativeDnsPath) ? JSON.parse(readFileSync(nativeDnsPath, "utf8")) : null;
value.complete = true; save();
`, { flag: "wx" });
    const positive = loadJob("bootstrap-positive", actor, "once");
    const positiveKickstart = run("/bin/launchctl", ["kickstart", positive.target]);
    await waitFor(() => existsSync(join(positive.directory, "once.json")));
    observation.bootstrap = { renderer: "production-seatbeltProfile",
      sourceSha256: createHash("sha256").update(readFileSync(bootstrapSource)).digest("hex"),
      executableSha256: createHash("sha256").update(readFileSync(launcher)).digest("hex"),
      positiveTarget: positive.target, positiveKickstart, positiveControl: remember(marker(positive.directory, "once")),
      compiler, sdk, developerTools, gitEnvironment: GIT_ENV, dnsEndpoint, dnsResolvedEndpoint, hostDns, positiveGit, gitExpected,
      unixSocketCanary, nativeDnsHostCommand, nativeDnsHost, variants: [] };
    const optionalJson = path => existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
    for (const name of ["inherited", "bootstrap-only", "bootstrap-and-xpc"]) {
      const directory = join(root, `work-${name}`); mkdirSync(directory, { mode: 0o700 });
      const directTarget = loadJob(`${name}-direct`, actor, "once"), nodeTarget = loadJob(`${name}-node`, actor, "once");
      const restoredTarget = loadJob(`${name}-restored`, actor, "once");
      const profile = seatbeltProfile({ readable: [
        ...[actor, launcher, script, process.execPath, compiler, developerTools.git].map(path => ({ path, kind: "file" })),
        { path: developerTools.contents, kind: "directory" },
        { path: unixSocketCanary.directory, kind: "directory" },
        { path: dirname(dirname(compiler)), kind: "directory" }, { path: sdk, kind: "directory" }],
        writable: [{ path: directory, kind: "directory" }], denied: [],
        executable: [actor, launcher, process.execPath, compiler, developerTools.git].map(path => ({ path, kind: "file" })),
        unixSockets: [dnsEndpoint, ...(dnsResolvedEndpoint === dnsEndpoint ? [] : [dnsResolvedEndpoint]), unixSocketCanary.listed],
        machServices: [], environmentKeys: [] });
      const profilePath = join(directory, "profile.sb"); writeFileSync(profilePath, profile, { mode: 0o600 });
      const directPorts = join(directory, "direct-ports.json"), nodePorts = join(directory, "node-ports.json");
      const toolsReport = join(directory, "tools.json");
      const direct = observe(launcher, [name, profilePath, directPorts, directory, "/bin/launchctl", "kickstart", directTarget.target], 5000);
      const node = observe(launcher, [name, profilePath, nodePorts, directory, process.execPath, script,
        nodeTarget.target, canary, compiler, developerTools.git, gitEnvironment, launcher,
        unixSocketCanary.listed, unixSocketCanary.unlisted, toolsReport]);
      const tools = optionalJson(toolsReport);
      const restoredPorts = join(directory, "restored-ports.json"), restorationReport = join(directory, "restoration.json");
      const restored = observe(launcher, [name, profilePath, restoredPorts, directory, launcher,
        "restore-registered-seed", restorationReport, "/bin/launchctl", "kickstart", restoredTarget.target], 5000);
      for (const [job, result] of [[directTarget, direct], [nodeTarget, tools?.service], [restoredTarget, restored]])
        if (result?.exitCode === 0 && result.signal === null && result.error === undefined)
          await waitFor(() => existsSync(join(job.directory, "once.json")));
      const effect = job => existsSync(join(job.directory, "once.json")) ? remember(marker(job.directory, "once")) : null;
      observation.bootstrap.variants.push({ name, profileSha256: createHash("sha256").update(profile).digest("hex"),
        direct: { target: directTarget.target, command: direct, ports: optionalJson(directPorts), guestEffect: effect(directTarget) },
        node: { target: nodeTarget.target, command: node, ports: optionalJson(nodePorts), tools, guestEffect: effect(nodeTarget) },
        restored: { target: restoredTarget.target, command: restored, ports: optionalJson(restoredPorts),
          restoration: optionalJson(restorationReport), guestEffect: effect(restoredTarget) },
        canaryPreserved: readFileSync(canary, "utf8") === "HOST_CANARY\n" });
    }
    const pids = observation.bootstrap.variants.map(variant => variant.node.tools?.nativeDnsCommand?.pid)
      .filter(pid => Number.isSafeInteger(pid) && pid > 0);
    const diagnostics = { purpose: "read-only violations for owned DNS observers; not authority or death proof", pids };
    if (pids.length && performance.now() - started < 73000) {
      const selected = pids.map(pid =>
        `(processIdentifier == ${pid} OR eventMessage CONTAINS "bootstrap-exec(${pid})")`).join(" OR ");
      const predicate = `(subsystem == "com.apple.sandbox.reporting" OR subsystem == "com.apple.sandbox") AND (${selected})`;
      try { diagnostics.command = observe("/usr/bin/log", ["show", "--style", "json", "--last", "2m", "--predicate", predicate], 5000); }
      catch (error) { diagnostics.unavailable = String(error); }
    } else diagnostics.notRun = "no owned observer PID or insufficient fixture budget";
    observation.bootstrap.denialDiagnostics = diagnostics;
  } else if (mode === "launchd-image") {
    assert.notEqual(hashes[0], hashes[1], "different controlled programs require different code hashes");
    const selected = join(root, "selected");
    copyFileSync(actor, selected);
    const matchA = loadJob("matching-a", selected, "once", hashes[0]);
    run("/bin/launchctl", ["kickstart", matchA.target]);
    await waitFor(() => existsSync(join(matchA.directory, "once.json")));
    observation.matchingA = remember(marker(matchA.directory, "once"));
    assert.equal(observation.matchingA.variant, 1);
    bootout(matchA);
    copyFileSync(binaries[1], `${selected}.next`); renameSync(`${selected}.next`, selected);
    const mismatch = loadJob("replaced-image", selected, "once", hashes[0]);
    observation.mismatchKickstart = run("/bin/launchctl", ["kickstart", mismatch.target], false);
    await delay(2000);
    const mismatchMarker = join(mismatch.directory, "once.json");
    observation.replacedImage = { markerAfterTwoSeconds: existsSync(mismatchMarker),
      service: run("/bin/launchctl", ["print", mismatch.target], false) };
    if (existsSync(mismatchMarker)) observation.replacedImage.actor = remember(marker(mismatch.directory, "once"));
    bootout(mismatch);
    const matchB = loadJob("matching-b", selected, "once", hashes[1]);
    run("/bin/launchctl", ["kickstart", matchB.target]);
    await waitFor(() => existsSync(join(matchB.directory, "once.json")));
    observation.matchingB = remember(marker(matchB.directory, "once"));
    assert.equal(observation.matchingB.variant, 2);
    bootout(matchB);
  } else {
    // No SpawnConstraint: independently qualify ordinary job provisioning.
    const scope = loadJob("scope", actor, "scope"), other = loadJob("other", actor, "hold");
    // Keep the host positive on a separate, otherwise equivalent job. Reusing
    // it would mix launchd restart scheduling into the first-admission question.
    const servicePositiveJob = loadJob("service-positive", actor, "once");
    const positiveServiceKickstart = run("/bin/launchctl", ["kickstart", servicePositiveJob.target]);
    await waitFor(() => existsSync(join(servicePositiveJob.directory, "once.json")));
    const servicePositive = remember(marker(servicePositiveJob.directory, "once"));
    await waitFor(() => originalExited(servicePositive.identity));
    const positiveServiceAfter = run("/bin/launchctl", ["print", servicePositiveJob.target], false);
    const serviceTarget = loadJob("service-target", actor, "once");
    const serviceBefore = run("/bin/launchctl", ["print", serviceTarget.target], false);
    const profile = seatbeltProfile({ readable: [{ path: actor, kind: "file" }],
      writable: [{ path: scope.directory, kind: "directory" }], denied: [],
      executable: [{ path: actor, kind: "file" }], unixSockets: [], machServices: [], environmentKeys: [] });
    writeFileSync(join(scope.directory, "profile.sb"), profile, { mode: 0o600 });
    writeFileSync(join(scope.directory, "service-target"), `${serviceTarget.target}\n`, { mode: 0o600 });
    run("/bin/launchctl", ["kickstart", scope.target]);
    run("/bin/launchctl", ["kickstart", other.target]);
    await waitFor(() => ["leader", "ordinary", "detached"].every(name => existsSync(join(scope.directory, `${name}.json`))) &&
      existsSync(join(other.directory, "other.json")));
    const members = Object.fromEntries(["leader", "ordinary", "detached"].map(name => [name, remember(marker(scope.directory, name))]));
    const control = remember(marker(other.directory, "other"));
    observation.scope = { members, control, before: usage(members.leader.resource), otherBefore: usage(control.resource) };
    observation.scope.seatbelt = { renderer: "production-seatbeltProfile",
      sha256: createHash("sha256").update(profile).digest("hex"), serviceTarget: serviceTarget.target,
      positiveServiceTarget: servicePositiveJob.target, positiveServiceKickstart, positiveServiceAfter,
      positiveServiceControl: servicePositive, serviceBefore, attempt: marker(scope.directory, "service-admission"),
      serviceAfter: run("/bin/launchctl", ["print", serviceTarget.target], false),
      guestEffect: existsSync(join(serviceTarget.directory, "once.json")) ?
        remember(marker(serviceTarget.directory, "once")) : null };
    assert.match(control.resource, /^[1-9][0-9]*$/);
    const request = join(scope.directory, "admission-request");
    writeFileSync(`${request}.tmp`, `${control.resource}\n`, { flag: "wx" });
    renameSync(`${request}.tmp`, request);
    await waitFor(() => existsSync(join(scope.directory, "admission.json")));
    observation.scope.admission = marker(scope.directory, "admission");
    assert.equal(observation.scope.admission.uid, process.getuid());
    assert.equal(observation.scope.admission.callerResource, members.leader.resource);
    for (const member of [...Object.values(members), control]) {
      const current = inspect(member.pid);
      assert.equal(current.uniqueBytes, 56); assert.equal(current.unique, member.identity.unique);
    }
    bootout(scope);
    writeFileSync(join(scope.directory, "ping"), "after owned job removal");
    writeFileSync(join(other.directory, "ping"), "independent live control");
    await waitFor(() => existsSync(join(other.directory, "other.ack.json")), 2000);
    await delay(250);
    observation.scope.afterBootout = { aggregate: usage(members.leader.resource), otherAggregate: usage(control.resource),
      ordinaryAcknowledged: existsSync(join(scope.directory, "ordinary.ack.json")),
      detachedAcknowledged: existsSync(join(scope.directory, "detached.ack.json")), otherAcknowledged: true,
      removedService: run("/bin/launchctl", ["print", scope.target], false) };
    await waitFor(() => existsSync(join(scope.directory, "late.json")));
    observation.scope.late = remember(marker(scope.directory, "late"));
    // A fresh executable gets its own kernel task-name port and token.
    // Neither target cooperation nor the old owner's handles are required.
    const wrongMember = JSON.parse(run(actor, ["signal-member", String(control.pid), members.leader.resource]).stdout);
    const remainingMember = JSON.parse(run(actor, ["signal-member", String(members.detached.pid), members.leader.resource]).stdout);
    observation.scope.recovery = { context: "fresh-exec-no-profile-applied", tokenSource: "kernel-task-name-port",
      fixtureReleaseUsedBeforeObservation: false, wrongMember, remainingMember,
      afterAttempt: await observeReaping(members.leader.resource, control.resource) };
    observation.scope.discoveryRecovery = await recoverFromHints(members.leader.resource, control.resource, scope.directory);
    writeFileSync(join(scope.directory, "release"), "controlled actors only; not a production stop mechanism");
    await waitFor(() => Object.values(members).every(member => originalExited(member.identity)), 12000);
    observation.scope.afterControlledExit = { controlledGenerationsExited: true,
      ...await observeReaping(members.leader.resource, control.resource) };
  }
} catch (error) { failure = error; }
finally {
  cleaning = true;
  const faults = [];
  for (const job of jobs) {
    try { writeFileSync(join(job.directory, "release"), "fixture cleanup only"); }
    catch (error) { faults.push(String(error)); }
    if (job.active) {
      try { bootout(job); } catch (error) { faults.push(String(error)); }
    }
  }
  if (actor !== undefined) {
    try {
      await waitFor(() => targets.every(originalExited), 12000);
      observation.controlledGenerationsExited = true;
    } catch (error) { faults.push(String(error)); }
  }
  for (const server of socketServers) {
    try { if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    catch (error) { faults.push(String(error)); }
  }
  if (socketDirectory !== undefined) {
    try { rmSync(socketDirectory, { recursive: true, force: true }); }
    catch (error) { faults.push(String(error)); }
  }
  observation.jobOutputs = [];
  for (const job of jobs) {
    try {
      const output = name => existsSync(join(job.directory, name)) ?
        readFileSync(join(job.directory, name)).subarray(0, 65536).toString("utf8") : null;
      observation.jobOutputs.push({ label: job.label, target: job.target, stdout: output("stdout"), stderr: output("stderr") });
    } catch (error) { faults.push(String(error)); }
  }
  observation.cleanupFaults = faults;
  observation.jobRegistrationsRemoved = jobs.every(job => !job.active);
  if (faults.length) failure = new AggregateError([...(failure ? [failure] : []), ...faults], "launchd fixture cleanup failed");
}
if (failure) {
  await new Promise((resolve, reject) => process.stderr.write(
    JSON.stringify({ case: mode, error: String(failure), observation }) + "\n",
    error => error ? reject(error) : resolve()));
  throw failure;
}
console.log(JSON.stringify({ case: mode, [mode === "launchd-image" ? "launchdImage" :
  mode === "launchd-bootstrap" ? "launchdBootstrap" : "launchdScope"]: observation }));
