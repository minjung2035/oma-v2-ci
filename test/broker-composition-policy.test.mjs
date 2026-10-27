import * as nativeSupportMeaning from "#oma-test/app/runtime/native-support";
import * as sessionHandoffMeaning from "@oma/protocol/session-handoff";
import * as hostLossMeaning from "@oma/process/host-loss";
import * as deploymentMeaning from "@oma/domain/deployment";
import * as cleanupMeaning from "@oma/native/cleanup";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { Script } from "node:vm";
import { spawn } from "node:child_process";
import { once } from "node:events";
import ts from "typescript";
/** Run the actual entrypoint with controlled module boundaries, without host I/O.
 * This checks composition and phase wiring, not real systemd/recovery behavior.
 */
/** Thrown by the stand-in `process.exit`, because the real one never returns
 * and a stand-in that does would run the rest of a function the product ended. */
class Exited extends Error {
}
async function compose(environment, { lockHeld = true, claim = "taken", cgroup = "0::/user.slice/app.slice/oma.scope", argv = ["--society", "fixture"], supervisionEstablished = true, repairFails = false, storage = false, restoreFails = false, starts = lockHeld && claim !== "elsewhere" && claim !== "unhonourable" && supervisionEstablished && !repairFails && !restoreFails } = {}) {
    const source = readFileSync(new URL("../apps/oma/src/entry/broker.ts", import.meta.url), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: {
            module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        } }).outputText;
    assert.equal(compiled.split("void main().catch").length, 2, "retain the single main invocation");
    // Retain the already-existing main promise instead of discarding it with void.
    const executable = compiled.replace("void main().catch", "main().catch");
    const calls = [], paths = [], exits = [], observation = { value: true, error: null };
    let supervision = null;
    let gitPaths = null;
    let constructorGoal;
    const reviewOwner = {};
    let residentLocation = null;
    const config = { society: "fixture", installation: { node: "node", libdir: "/lib",  deploymentDigest: "a".repeat(64) },
        integration: { checks: [] }, limits: { receiptWaitSeconds: 1 }, agentProfiles: {}, modelProfiles: {} };
    const modules = {
        "@oma/native/cleanup": cleanupMeaning,
        "../runtime/execution-runtime.js": { ExecutionRuntime: class {
            constructor() { calls.push("ExecutionRuntime"); }
            async recover() { calls.push("execution-recover"); }
            async close() { calls.push("execution-close"); }
            run() { throw new Error("composition policy must not execute a command"); }
            confirmDead() { throw new Error("composition policy cannot prove native death"); }
        } },
        "../runtime/native-residents.js": { createNativeResidents(_store, _execution, location) {
            calls.push("NativeResidents"); residentLocation = location;
            return { async close() { calls.push("residents-close"); } };
        } },
        "../runtime/quarantine-execution.js": { quarantineExecution() {
            return { execute() { throw new Error("composition policy must not run quarantine"); },
                confirmDead() { throw new Error("composition policy cannot prove native death"); } };
        } },
        "../runtime/native-support.js": nativeSupportMeaning,
        "../runtime/resident-tools.js": { prepareResidentTools() {
            throw new Error("composition policy must not observe native developer tools");
        } },
"@oma/protocol/session-handoff": sessionHandoffMeaning,
"@oma/process/host-loss": hostLossMeaning,
"@oma/domain/deployment": deploymentMeaning,

        "node:fs": { realpathSync: value => value },
        "../runtime/society-preparation.js": { prepareSociety: async () => { calls.push("prepare"); } },
        "../runtime/session-storage.js": { SessionStorage: { forSociety: () => storage ? {
            async restore() { calls.push("restore-workspaces"); if (restoreFails) throw Error("cold snapshot unreadable"); },
            async archive() { calls.push("archive-workspaces"); },
        } : null } },
        "node:path": path,
        "@oma/storage": { SCHEMA_PATH: "schema", Store: class {
                constructor() { calls.push("Store"); }
                close() { calls.push("Store.close"); }
                listAgents() { return []; }
                getAgent() { return null; }
            } },
        "../broker/mail-composition.js": { createMailModule() { calls.push("Mail"); return {}; } },
        "../views.js": { ViewsModule: class {
                constructor() { calls.push("Views"); }
                refreshWorld() { calls.push("refresh"); }
            } },
        "../broker/git-composition.js": { createGitServices(paths) {
                calls.push("Git"); gitPaths = paths;
                return { git: { hasCommittedContext() { if (observation.error) throw observation.error; return observation.value; } }, reviews: reviewOwner };
            } },
        "../broker/lifecycle-composition.js": { createLifecycleModule(_store, _units, options) {
                calls.push("Lifecycle"); paths.push(options); constructorGoal = options.hasGoal();
                return { async bootstrap() { calls.push("bootstrap"); } };
            } },
        "../broker/reconcile-composition.js": { createReconcileModule(_store, _mail, _git, reviews, _units, _lifecycle, options) { assert.equal(reviews, reviewOwner); calls.push("Reconcile"); paths.push(options); return {
                async startup(activation, bootstrap) { assert.equal(activation, false); calls.push("recover"); await bootstrap(); },
                async sweep() { calls.push("activate"); },
                quiesceForShutdown() { calls.push("native-quiescence"); }
            }; } },
        "../broker/broker-composition.js": { createBroker({ reviews, paths: options, principalHost }) {
                    assert.equal(reviews, reviewOwner);
                    calls.push("Broker"); paths.push({ ...options, principalHost });
                    return {
                      async start() { calls.push("listen"); },
                      notifyReady() { calls.push("notify"); return true; },
                    };
            } },
        "../runtime/candidate-checks.js": { CandidateChecks: class {
                run() { throw new Error("composition must not execute candidate checks"); }
            } },
        "../runtime/provision.js": { repairSociety: stateRoot => {
                calls.push(`repair:${stateRoot}`);
                if (repairFails)
                    throw new Error("rootfs entry could not be corrected");
                return [`${stateRoot}/rootfs/etc/passwd`];
            } },
        "@oma/domain/integration-policy": { integrationPolicyFromConfig: value => value, snapshotIntegrationPolicy: value => value, assertSupportedIntegration() { } },
        "@oma/config": { loadConfig: () => { calls.push("config"); return config; } },
        "@oma/config/policy": { createChildSpecResolver: () => () => ({}) },
        "@oma/native/process-lock": {
            SOCIETY_OWNED_EXIT: 6,
            ProcessLock: {
                tryAcquire: () => { calls.push("lock"); return lockHeld ? { close() { calls.push("unlock"); } } : null; },
                // Taking the lock in a way that cannot tell "someone else owns this"
                // from "this could not be locked" is the defect itself: the host reads
                // ownership off the status, and a throw here is a startup failure,
                // which is restartable. Any return to `acquire` fails every test below.
                acquire: () => { throw new Error("the composition root must distinguish ownership from failure"); },
            },
        },
        "@oma/process/async": { SOCIETY_FENCE_ENV: "OMA_SOCIETY_FENCE_FD", SOCIETY_FENCE_FD: 4 },
        // One object answers "may this process act for this society", and the
        // entrypoint's job is to ask it and obey. Which descriptor is really the
        // lease is that object's question, not this one's -- see
        // `test/society-lease-identity.test.mjs`, which asks it against the kernel.
        "../runtime/society-lease.js": { claimSocietyFence: () => {
                calls.push("claim");
                switch (claim) {
                    case "inherited": return { kind: "inherited", fence: 4 };
                    case "elsewhere": return { kind: "elsewhere" };
                    case "unhonourable": throw new Error("descriptor 4 is not this society's lease");
                    default: return { kind: "taken", fence: 4, lease: { name: "\0oma.society.fixture", fence: 4, release() { calls.push("release"); } } };
                }
            } },
        // AV31: every way the host goes away ends the broker through its drain.
        "@oma/process/host-loss": { stopOnHostLoss() { calls.push("host-loss"); } },
        "@oma/broker/lifetime": { BrokerLifetime: class {
                permitsActivation = true;
                storeClose = null;
                owned = [];
                retainNative(close) { this.owned.push(close); }
                retainStore(close) { this.storeClose = close; }
                attach() { }
                async shutdown() { calls.push("shutdown");
                    await paths.find(entry => "quiesceOnDrain" in entry)?.quiesceOnDrain();
                    for (const close of this.owned.splice(0).reverse()) await close();
                    this.storeClose?.(); this.storeClose = null;
                }
                async start(phases) { await phases.recover(); await phases.listen(); await phases.notify(); await phases.activate(); }
            } },
        // Deliberately controlled qualification gates: this is wiring proof, not a supported deployment profile.
        "@oma/native/directory-layout": { assertHostDirectoryLayout() { } },
"../runtime/assets.js": { assertStateRoot() { }, assertRuntimeAssets() { }, runtimeAssets: () => ({}),
            hostLaunchLocation: (society, _env, configPath) => ({ society, stateRoot: `/data/oma/${society}`, runRoot: `/run/oma/${society}`,
                configPath: configPath ?? `/data/oma/${society}/config.json` }),
            launchedLocation: (args, society) => ({ society, configPath: args[args.indexOf("--config") + 1],
                stateRoot: args[args.indexOf("--state-root") + 1], runRoot: args[args.indexOf("--run-root") + 1] }) },
        "../runtime/deployment-manifest.js": { assertDeploymentDigest() { calls.push("digest"); } },
        // AV5/P0-8: the run root and the Principal inbox are ensured through the
        // owned-repair primitive, not a plain mkdir.
        "../runtime/user-files.js": { ensureOwnedUserDirectory() { } },
        // AV11: the canonical repository's path has one owner.
        "@oma/domain/paths": { projectGitPathAt: stateRoot => `${stateRoot}/repos/project.git` },
        // AV27: where a Resident's Git reaches that repository has one owner.
        "@oma/domain/resident-paths": { residentProjectGit: () => '/git/project.git' },
        "@oma/domain/agent-spec": { resolvedSpecOf: value => value },
        "@oma/domain/errors": { StoreError: class extends Error {
            } },
        "@oma/domain/identifiers": { isValidSocietyName: value => value === "fixture" },
        "@oma/protocol/host-channel": { HOST_CHANNEL_ENV: "OMA_HOST_CHANNEL", HOST_CHANNEL_FD: 3 },
        "../runtime/supervision-channel.js": { openSupervisionChannel: options => {
                calls.push(`supervision:${options.fd}`);
                supervision = options;
                // Forward an actual process id as data; this fixture does not
                // attest channel credentials, host identity or descendant death.
                return supervisionEstablished ? { hostPid: globalThis.process.pid, ready() { }, grant() { }, refuse() { }, onSession() { }, close() { } } : undefined;
            } },
    };
    const process = { platform: globalThis.process.platform,
        argv: ["node", "broker", ...argv], env: { ...(environment ?? {}) }, exitCode: 0, once() { },
        exit(code) { exits.push(code); throw new Exited(`exit(${code})`); } };
    const lines = [];
    await new Script(executable, { filename: "broker-composition.cjs" }).runInNewContext({
        exports: {}, process, AbortController, console: { error(...parts) { lines.push(parts.join(" ")); } }, require(name) {
if (name === "@oma/protocol/session-handoff" && !Object.hasOwn(modules, name)) return sessionHandoffMeaning;
if (name === "@oma/process/host-loss" && !Object.hasOwn(modules, name)) return hostLossMeaning;
if (name === "@oma/domain/deployment" && !Object.hasOwn(modules, name)) return deploymentMeaning;

            assert.ok(Object.hasOwn(modules, name), `uncontrolled dependency: ${name}`);
            return modules[name];
        },
    });
    if (starts) {
        assert.deepEqual(exits, [], "the entrypoint ended the process on a society it does own");
        assert.equal(process.exitCode, 0, `entrypoint must complete without the startup failure path: ${lines.join(" | ")}; calls=${calls.join(",")}`);
    }
    return { calls, paths, observation, constructorGoal, supervision, exits, exitCode: process.exitCode, residentLocation, gitPaths, lines };
}
test("D03 composition: the product runs the broker itself, so Residents render at its location and are stopped on drain", async () => {
    const product = await compose({ OMA_HOST_CHANNEL: "3" }, { claim: "inherited",
        argv: ["--society", "fixture", "--config", "/c/x.json", "--state-root", "/s/oma/fixture", "--run-root", "/r/oma/fixture"] });
    // The product runs the broker itself: there is no broker unit a Resident
    // could be bound to, whatever cgroup this process happens to be in.
    assert.deepEqual([product.residentLocation.configPath, product.residentLocation.stateRoot, product.residentLocation.runRoot], ["/c/x.json", "/s/oma/fixture", "/r/oma/fixture"]);
    const options = product.paths.find(entry => "principalHost" in entry);
    assert.equal(typeof options.quiesceOnDrain, "function");
    assert.equal(options.stateRoot, "/s/oma/fixture");
    assert.ok(product.calls.indexOf("execution-recover") >= 0 && product.calls.indexOf("execution-recover") < product.calls.indexOf("Store"));
    assert.equal(product.calls.includes("manager"), false);
    const manual = await compose();
    assert.equal(manual.residentLocation.configPath, "/data/oma/fixture/config.json");
});
test("P1 composition root: Git exists when Lifecycle receives its context reader", async () => {
    const result = await compose();
    assert.equal(result.constructorGoal, true);
    assert.ok(result.calls.indexOf("Git") < result.calls.indexOf("Lifecycle"));
    assert.ok(result.calls.indexOf("Lifecycle") < result.calls.indexOf("Reconcile"));
});
test("P1 composition root: all consumers share a live reader that preserves observation failure", async () => {
    const { paths, observation } = await compose();
    assert.equal(paths.length, 3);
    assert.ok(paths.every(options => options.hasGoal === paths[0].hasGoal));
    for (const value of [false, true]) {
        observation.value = value;
        assert.ok(paths.every(options => options.hasGoal() === value));
    }
    const error = new Error("unobservable context");
    observation.error = error;
    for (const options of paths)
        assert.throws(() => options.hasGoal(), caught => caught === error);
});
test("P1 composition root: startup still wires recovery before listen, notify and activation", async () => {
    const { calls } = await compose();
    assert.deepEqual(calls.slice(calls.indexOf("recover")), ["recover", "repair:/data/oma/fixture", "bootstrap", "listen", "notify", "activate", "refresh"]);
    assert.equal(calls.filter(value => value === "Store").length, 1);
    assert.ok(calls.indexOf("digest") < calls.indexOf("Store"));
    assert.equal(calls.includes("storage-quota"), false);
});
test("P1 composition root: only a broker the product started has a Principal endpoint", async () => {
    // PR-001: a broker started by systemd or by hand has no host to register a
    // session with, and opens nothing a stranger could attach to.
    const unsupervised = await compose();
    assert.equal(unsupervised.paths.at(-1).principalHost, undefined);
    assert.ok(!unsupervised.calls.some(call => call.startsWith("supervision:")));
    // A marker that names another descriptor is not this product's channel.
    const wrong = await compose({ OMA_HOST_CHANNEL: "4" });
    assert.equal(wrong.paths.at(-1).principalHost, undefined);
    const supervised = await compose({ OMA_HOST_CHANNEL: "3" });
    assert.ok(supervised.calls.includes("supervision:3"));
    assert.equal(supervised.paths.at(-1).principalHost.hostPid, process.pid);
    // The channel is opened before anything slow, so a host that dies during
    // recovery still takes this broker with it.
    assert.ok(supervised.calls.indexOf("supervision:3") < supervised.calls.indexOf("Store"));
});
test("P0V-28 / N04, P0-5: a broker told it is supervised whose channel cannot be established opens nothing and gives the society back", async () => {
    const { calls, exitCode } = await compose({ OMA_HOST_CHANNEL: "3" }, { supervisionEstablished: false });
    assert.ok(calls.includes("supervision:3"));
    for (const opened of ["config", "Store", "Mail", "Git", "Broker"])
        assert.ok(!calls.includes(opened), `${opened} was opened by a broker that does not know it has a host: ${calls.join(",")}`);
    assert.ok(calls.includes("shutdown"), "the society's lock was not given back through the lifetime");
    assert.equal(exitCode, 1);
});
test("P1 composition root: the host going away stops the broker", async () => {
    // LIFE-006: the audit's orphan. However the host ended, its descriptor
    // closes, and the broker hears it through the channel and shuts down.
    const { calls, supervision } = await compose({ OMA_HOST_CHANNEL: "3" });
    assert.ok(!calls.includes("shutdown"));
    supervision.onHostGone("the host is gone");
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(calls.includes("shutdown"), "the broker did not stop when its host went away");
});
test("DR48 composition: cold restoration precedes SQLite and archival follows drain and Store.close", async () => {
    const { calls, supervision } = await compose({ OMA_HOST_CHANNEL: "3" }, { storage: true });
    assert.ok(calls.indexOf("restore-workspaces") < calls.indexOf("Store"));
    supervision.onHostGone("host ended"); await new Promise(resolve => setImmediate(resolve));
    assert.ok(calls.indexOf("native-quiescence") < calls.indexOf("Store.close"));
    assert.ok(calls.indexOf("Store.close") < calls.indexOf("archive-workspaces"));
});
test("DR48 composition: an unreadable cold snapshot opens no Store and grants no activation", async () => {
    const { calls, exitCode } = await compose(undefined, { storage: true, restoreFails: true });
    assert.equal(exitCode, 1); assert.ok(calls.includes("restore-workspaces"));
    for (const forbidden of ["Store", "Git", "Broker", "listen", "activate", "archive-workspaces"]) assert.equal(calls.includes(forbidden), false);
});
test("P1 composition root: the host's credential channel is the kind of descriptor the broker requires", async () => {
    // The guard above admits a pipe. This asserts the supervisor actually opens
    // one, so the two halves cannot drift into a broker that always refuses.
    const probe = "const s = require('node:fs').fstatSync(3);" +
        "process.stdout.write(JSON.stringify({ pipe: s.isFIFO() || s.isSocket(), file: s.isFile(), tty: s.isCharacterDevice() }))";
    const child = spawn(process.execPath, ["-e", probe], { stdio: ["ignore", "pipe", "ignore", "pipe"] });
    let answer = "";
    child.stdout.on("data", chunk => { answer += String(chunk); });
    await once(child, "close");
    // Node gives a "pipe" child a socketpair rather than a FIFO, so the guard
    // accepts either. What it must never accept is a regular file or a terminal:
    // those are where an inherited registration would spill a credential.
    assert.deepEqual(JSON.parse(answer), { pipe: true, file: false, tty: false });
});
test("P1 composition root: the society lock is taken before anything is opened", async () => {
    // REC-007. Config, SQLite and recovery all touch state the owner owns, so
    // none of them may run before this process knows it is the owner.
    const { calls } = await compose();
    const order = name => calls.indexOf(name);
    assert.ok(order("lock") >= 0, "the entrypoint never took the society lock");
    for (const after of ["config", "Store", "Broker", "listen"])
        assert.ok(order("lock") < order(after), `${after} happened before the society lock`);
});
test("P1 composition root: a society that already has an owner ends with its own status, opening nothing", async () => {
    // The host tells ownership from failure by this status alone: "another oma
    // owns this" must not be restarted, and "I fell over" must be. A generic
    // startup failure here makes the second indistinguishable from the first.
    const { calls, exits } = await compose(undefined, { lockHeld: false });
    assert.deepEqual(exits, [6], `the entrypoint ended with ${JSON.stringify(exits)} instead of the ownership status`);
    for (const opened of ["config", "Store", "Broker", "listen", "recover"])
        assert.equal(calls.includes(opened), false, `${opened} ran for a society this process does not own`);
});
test("P1 composition root: a broker the product did not start takes the society lease itself", async () => {
    // REC-007. `broker.lock` answers "may this process be the single SQLite
    // writer". It never answered "may anything act on this society at all", so a
    // systemd or hand-started broker left that name free and an `oma` took it,
    // wrote the configuration and repaired the rootfs underneath a running
    // broker. This broker now answers the same question the host does.
    const held = await compose();
    const order = name => held.calls.indexOf(name);
    assert.ok(order("claim") >= 0, "the entrypoint never asked who owns the society");
    assert.ok(order("lock") < order("claim"), "the society lease was taken before this broker knew it was the writer");
    for (const after of ["config", "Store", "Broker", "listen", "recover"])
        assert.ok(order("claim") < order(after), `${after} happened before the society lease`);
    const refused = await compose(undefined, { claim: "elsewhere" });
    assert.deepEqual(refused.exits, [6], `a society an oma owns ended with ${JSON.stringify(refused.exits)} instead of the ownership status`);
    for (const opened of ["config", "Store", "Broker", "listen", "recover"])
        assert.equal(refused.calls.includes(opened), false, `${opened} ran on a society an oma already owns`);
    // The writer lock is given back on the way out: refusing to own the society
    // must not leave this society's singleton held by a process that stopped.
    assert.ok(refused.calls.includes("unlock"), "a refused broker kept the society's writer lock");
});
test("P1 composition root: a broker the product started inherits the lease and never takes the name twice", async () => {
    // The host holds this society's lease and hands the descriptor down. Taking
    // the name again would be this broker asking its own host for permission --
    // and being refused, because the name is held by the description it is
    // already holding.
    const supervised = await compose({ OMA_SOCIETY_FENCE_FD: "4" }, { claim: "inherited" });
    assert.equal(supervised.calls.filter(entry => entry === "claim").length, 1, "the entrypoint asked about ownership more than once, or not at all");
    assert.ok(supervised.calls.includes("listen"), "a fenced broker did not start");
    assert.deepEqual(supervised.exits, []);
    // And it cannot take the name even in principle: the entrypoint has no way
    // to reach the acquisition at all. The composition above would still pass if
    // this file merely happened not to call it, so the rule is read off the
    // source rather than off one run of it -- which is what kept this check from
    // drifting back into a predicate the entrypoint owns.
    const source = readFileSync(new URL("../apps/oma/src/entry/broker.ts", import.meta.url), "utf8");
    for (const forbidden of ["tryHoldSociety", "inheritedFence", "SOCIETY_FENCE_FD", "fstatSync"])
        assert.equal(source.includes(forbidden), false, `the entrypoint names ${forbidden}: deciding what a lease is belongs to the module that takes it`);
});
test("P1 composition root: a fence declaration that cannot be honoured is a startup failure, not ownership", async () => {
    // Starting anyway is the unfenced writer the declaration existed to prevent,
    // and reporting it as ownership would stop the host from restarting a broker
    // that merely fell over.
    //
    // Which declarations cannot be honoured -- a descriptor this product does not
    // place the lease on, one that is not open, one holding another society's
    // lease, one that is not a socket at all -- is decided by the module that
    // takes the lease, and `test/society-lease-identity.test.mjs` asks the kernel
    // about each of them. What belongs here is only that the entrypoint treats
    // that refusal as a failure to start rather than as an answer about ownership.
    const result = await compose({ OMA_SOCIETY_FENCE_FD: "4" }, { claim: "unhonourable" });
    assert.deepEqual(result.exits, [], "a fence that could not be honoured was reported as ownership");
    assert.equal(result.exitCode, 1, "a fence that could not be honoured did not fail startup");
    for (const opened of ["config", "Store", "Broker", "listen"])
        assert.equal(result.calls.includes(opened), false, `${opened} ran for a fence that could not be honoured`);
});
test("AV31 / D03, LIFE-006: the broker ends through its drain on every host-loss signal, registered before anything slow", async () => {
    const { calls } = await compose();
    const order = name => calls.indexOf(name);
    assert.ok(order("host-loss") >= 0, "the entrypoint does not stop on host loss through the one signal owner");
    for (const after of ["config", "Store", "Broker", "listen"])
        assert.ok(order("host-loss") < order(after), `${after} happened before host loss could stop the broker`);
});
test("P0V-58 / R03, DR16: the rootfs is put right after the startup quiescence and before anything can wake on it", async () => {
    // The stand-in startup records "recover" -- the quiescence that proves every
    // earlier Resident ended -- and only then runs what startup prepares.
    const { calls, lines } = await compose();
    const order = name => calls.indexOf(name);
    assert.ok(order("recover") < order("repair:/data/oma/fixture"), `the rootfs was repaired before the quiescence: ${calls.join(" ")}`);
    for (const later of ["bootstrap", "listen", "notify", "activate"])
        assert.ok(order("repair:/data/oma/fixture") < order(later), `${later} came before the repair: ${calls.join(" ")}`);
    assert.equal(calls.filter(name => name.startsWith("repair:")).length, 1);
    assert.ok(lines.some(line => /Restored rootfs entry to its expected value: \/data\/oma\/fixture\/rootfs\/etc\/passwd/.test(line)), lines.join(" | "));
});
test("P0V-58 / DR16: a rootfs that could not be put right ends startup: nothing listens and nothing wakes", async () => {
    const { calls, lines } = await compose(undefined, { repairFails: true });
    assert.ok(calls.includes("repair:/data/oma/fixture"));
    for (const never of ["bootstrap", "listen", "notify", "activate"])
        assert.equal(calls.includes(never), false, `${never} ran over a rootfs the product could not vouch for`);
    assert.ok(lines.some(line => /broker startup failed/.test(line)), lines.join(" | "));
});
