/** Public launchctl experiment, not a production backend or a passed gate.
 * The helper is controlled code. Marker files are fixture coordination, never
 * sender authentication, and their absence is never a process-death proof. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { seatbeltProfile } from "@oma/platform-mac/seatbelt";

assert.equal(process.platform, "darwin", "launchd observations require the actual Darwin kernel");
assert.ok(process.getuid() > 0, "launchd observations require an ordinary user");
const mode = process.argv[2];
assert.ok(["launchd-scope", "launchd-image"].includes(mode));
const root = realpathSync(process.cwd()), started = performance.now();
// Plain user/UID bootstrap failed before spawning on both runners. Test a
// distinct GUI session context; this does not qualify headless operation.
const domain = `gui/${process.getuid()}`, prefix = `org.oma.probe.${randomUUID()}`;
const commands = [], jobs = [], targets = [];
const observation = { domain, commands, fixtureOnly: true };
let cleaning = false, failure;
function run(executable, argv, required = true) {
  const remaining = (cleaning ? 110000 : 80000) - (performance.now() - started);
  assert.ok(remaining > 0, "launchd fixture deadline");
  const result = spawnSync(executable, argv, { cwd: root, encoding: "utf8",
    timeout: Math.max(1, Math.min(10000, Math.floor(remaining))), killSignal: "SIGKILL", maxBuffer: 1024 * 1024 });
  const record = { executable, argv, exitCode: result.status, signal: result.signal,
    error: result.error?.message, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  commands.push(record);
  assert.equal(result.error, undefined, JSON.stringify(record));
  assert.equal(result.signal, null, JSON.stringify(record));
  if (required) assert.equal(result.status, 0, JSON.stringify(record));
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
  if (mode === "launchd-image") {
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
    const serviceTarget = loadJob("service-target", actor, "once");
    run("/bin/launchctl", ["kickstart", serviceTarget.target]);
    await waitFor(() => existsSync(join(serviceTarget.directory, "once.json")));
    const servicePositive = remember(marker(serviceTarget.directory, "once"));
    await waitFor(() => originalExited(servicePositive.identity));
    unlinkSync(join(serviceTarget.directory, "once.json"));
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
      positiveServiceControl: servicePositive, attempt: marker(scope.directory, "service-admission"),
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
  observation.jobOutputs = [];
  for (const job of jobs) {
    try {
      const output = name => existsSync(join(job.directory, name)) ?
        readFileSync(join(job.directory, name)).subarray(0, 65536).toString("utf8") : null;
      observation.jobOutputs.push({ label: job.label, stdout: output("stdout"), stderr: output("stderr") });
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
console.log(JSON.stringify({ case: mode, [mode === "launchd-image" ? "launchdImage" : "launchdScope"]: observation }));
