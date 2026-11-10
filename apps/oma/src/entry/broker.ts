import { inspect } from "node:util";
import { createBroker } from "../broker/broker-composition.js";
import { assertNativeRuntime } from "../runtime/native-support.js";
import { createReconcileModule } from "../broker/reconcile-composition.js";
import { createLifecycleModule } from "../broker/lifecycle-composition.js";
import { createGitServices } from "../broker/git-composition.js";
import { createMailModule } from "../broker/mail-composition.js";
// UNIT-004/LIFE-006/REC-007: composition under a single process lifetime.
import { createHash } from "node:crypto";
import { createMachBrokerTransport } from "@oma/platform-mac/mach-transport";
import { collectRuntimeArtifacts } from "../runtime/mac-runtime-artifact.js";
import { prepareMacRuntimeGeneration, type MacRuntimeGeneration } from "../runtime/mac-runtime-generation.js";
import { withProtectedMacNode } from "../runtime/mac-protected-node.js";
import { dirname, join } from "node:path";
import { ensureOwnedUserDirectory } from "../runtime/user-files.js";
import { Store, SCHEMA_PATH } from "@oma/storage";
import { MailModule } from "@oma/mail";
import { createNativeResidents, type NativeResidents } from "../runtime/native-residents.js";
import { cleanupAll, withAsyncCleanup, withCleanup } from "@oma/native/cleanup";
import { ViewsModule } from "../views.js";
import { LifecycleModule } from "@oma/lifecycle";
import { Broker } from "@oma/broker";
import { HOST_CHANNEL_ENV, HOST_CHANNEL_FD } from "@oma/protocol/host-channel";
import { openSupervisionChannel } from "../runtime/supervision-channel.js";
import { GitModule } from "@oma/git";
import { CandidateChecks } from "../runtime/candidate-checks.js";
import { quarantineExecution } from "../runtime/quarantine-execution.js";
import { launchDarwinJobScope } from "@oma/platform-mac/job-scope";
import { ExecutionRuntime } from "../runtime/execution-runtime.js";
import { prepareResidentTools } from "../runtime/resident-tools.js";
import type { MacDeveloperTools } from "@oma/protocol/mac-developer-tools";
import { observeProjectBinding, repairSociety } from "../runtime/provision.js";
import { prepareSociety } from "../runtime/society-preparation.js";
import { openDirectory } from "@oma/native/files";
import { openOwnedDirectoryPath } from "@oma/storage/directory";
import { closeSync, realpathSync } from "node:fs";
import { integrationPolicyFromConfig, snapshotIntegrationPolicy, assertSupportedIntegration } from "@oma/domain/integration-policy";
import { ReconcileModule } from "@oma/reconcile";
import { loadConfig, readCurrentHostPolicy } from "@oma/config";
import { createChildSpecResolver } from "@oma/config/policy";
import { ProcessLock, SOCIETY_OWNED_EXIT } from "@oma/native/process-lock";
import { claimSocietyFence } from "../runtime/society-lease.js";
import { BrokerLifetime } from "@oma/broker/lifetime";
import { stopOnHostLoss } from "@oma/process/host-loss";
import { assertRuntimeAssets, runtimeAssets, assertStateRoot, hostLaunchLocation, launchedLocation, type LaunchLocation } from "../runtime/assets.js";
import { assertHostDirectoryLayout } from "@oma/native/directory-layout";
import { assertDeploymentDigest } from "../runtime/deployment-manifest.js";
import { resolvedSpecOf } from "@oma/domain/agent-spec";
import { StoreError } from "@oma/domain/errors";
import { isValidSocietyName } from "@oma/domain/identifiers";
import { projectGitPathAt } from "@oma/domain/paths";
import { residentProjectGit } from "@oma/domain/resident-paths";
import { SessionStorage } from "../runtime/session-storage.js";
import type { StorageResident } from "../runtime/session-storage-state.js";
import { collaborationSocietyBirth, readSessionBirth, requireCollaborationSociety } from "../runtime/session-mode.js";
function usage(): never {
    console.error("usage: broker.js --society <name> [--config <path>] [--state-root <dir> --run-root <dir>]");
    process.exit(4);
}
const args = process.argv.slice(2);
const societyIdx = args.indexOf("--society");
const configIdx = args.indexOf("--config");
if (societyIdx < 0 || args[societyIdx + 1] === undefined)
    usage();
const society = args[societyIdx + 1]!;
if (!isValidSocietyName(society))
    usage();
// D03: a broker the product started is handed the product's location whole; a
// broker started any other way is its own host and derives it once, here.
let location: LaunchLocation;
try {
    location = args.includes("--state-root") || args.includes("--run-root")
        ? launchedLocation(args, society)
        : hostLaunchLocation(society, process.env, configIdx >= 0 ? args[configIdx + 1] : undefined);
}
catch (error) {
    console.error(`broker: ${error instanceof Error ? error.message : String(error)}`);
    usage();
}
const { stateRoot, runRoot, configPath } = location;
async function main(): Promise<void> {
    let canonicalDirectory: number | undefined;
    let contextDirectory: number | undefined;
    let worldDirectory: number | undefined;
    let stateDirectory: number | undefined;
    // DR72: standalone startup must refuse before run-root/lock creation,
    // Store open, workspace restore, execution recovery or provisioning.
    requireCollaborationSociety(readSessionBirth(stateRoot), society);
    assertNativeRuntime();
    assertHostDirectoryLayout(runRoot, true);
    // P0-8: the run root's parent (`…/oma` under the runtime dir) is oma's own;
    // a mode-000 directory there is repaired within that boundary, not wedged on.
    ensureOwnedUserDirectory(runRoot, dirname(runRoot));
    // The lock is the society's singleton, and it is taken before configuration,
    // SQLite or recovery. A broker that does not get it says so with a status of
    // its own rather than the generic startup failure: the host reads ownership
    // off this, and "someone else owns the society" must not look like "the
    // broker fell over", which is restartable.
    const held = ProcessLock.tryAcquire(join(runRoot, "broker.lock"));
    if (held === null) {
        console.error("another broker already owns this society; this one does not start");
        process.exit(SOCIETY_OWNED_EXIT);
    }
    const lock = held;
    // REC-007: this lock answers "may this process be the society's single
    // SQLite writer". It does not answer "may anything act on this society at
    // all" -- that is the society lease, and a broker started outside the
    // product used to answer neither, which is what let an `oma` take a free
    // lease over a society this broker was already serving, write its
    // configuration and repair its rootfs underneath it. The host now asks
    // before it writes; this is the other half, and it is the half that closes
    // the window between that question and the writes that follow it.
    //
    // A broker the product started inherited the lease on the declared
    // descriptor. It must not take the name again -- it is already held, by the
    // very description this process is holding -- and its host's ownership is
    // the one that counts. A broker started any other way speaks for itself, so
    // it takes the lease, and a society an `oma` already owns refuses it.
    //
    // A descriptor declared as the lease but holding something else is a startup
    // failure, not a reason to fall back to taking the lease: the fallback is
    // what a forged declaration wanted. It would leave a broker serving a
    // society whose ownership nothing holds, having announced that it did.
    //
    // Nothing releases the lease. The kernel does, when the last descriptor onto
    // it closes, which is the only release that can never come too early.
    const claim = claimSocietyFence(stateRoot);
    if (claim.kind === "elsewhere") {
        console.error("an oma already owns this society; this broker does not start");
        lock.close();
        process.exit(SOCIETY_OWNED_EXIT);
    }
    let graceSeconds: number | null = null;
    const lifetime = new BrokerLifetime(lock, () => {
        if (graceSeconds === null)
            throw new StoreError("INTERNAL_ERROR", "runtime grace requested before host limits were loaded");
        return graceSeconds;
    });
    let exitStatus = 0;
    let stopping: Promise<void> | null = null;
    const preparationAbort = new AbortController();
    let preparation: ReturnType<typeof prepareSociety> | null = null;
    let storagePreparation: Promise<void> | null = null;
    let toolPreparation: Promise<MacDeveloperTools | undefined> | null = null;
    let sessionStorage: SessionStorage | null = null;
    let storageCloseMode: "keep-hot" | "on-close" = "keep-hot";
    let executions: ExecutionRuntime | null = null;
    let residents: NativeResidents | null = null;
    let runtimeGeneration: MacRuntimeGeneration | undefined;
    let runtimePreparation: Promise<MacRuntimeGeneration> | null = null;
    let storageResidents: readonly StorageResident[] | null = null;
    let freshVerifiedMain: string | undefined;
    let principalHost: ReturnType<typeof openSupervisionChannel>;
    const stop = (code: number): Promise<void> => {
        exitStatus = Math.max(exitStatus, code);
        if (stopping)
            return stopping;
        preparationAbort.abort();
        stopping = (async () => {
            if (preparation !== null)
                await preparation.catch(() => { });
            if (storagePreparation !== null)
                await storagePreparation.catch(() => { });
            if (toolPreparation !== null)
                await toolPreparation.catch(() => { });
            if (runtimePreparation !== null)
                await runtimePreparation.catch(() => {});
            await lifetime.shutdown();
            cleanupAll([() => { const fd = worldDirectory; worldDirectory = undefined; if (fd !== undefined) closeSync(fd); },
                () => { const fd = contextDirectory; contextDirectory = undefined; if (fd !== undefined) closeSync(fd); },
                () => { const fd = canonicalDirectory; canonicalDirectory = undefined; if (fd !== undefined) closeSync(fd); },
                () => { const fd = stateDirectory; stateDirectory = undefined; if (fd !== undefined) closeSync(fd); }]);
            if (exitStatus === 0 && sessionStorage !== null && storageResidents !== null) {
                try { await sessionStorage.close(storageResidents, storageCloseMode); }
                catch (error) { console.error("Session workspace reclamation did not finish; recovery data retained:", error instanceof Error ? error.message : String(error)); }
            }
            principalHost?.close();
        })().then(() => { process.exitCode = exitStatus; }, error => {
            // P0V-58: e.g. a Resident whose end the drain could not prove. The
            // Store and lock are given back; the drain did not finish, and says so.
            console.error("broker drain did not finish:", inspect(error, { depth: 6, breakLength: Infinity }));
            process.exit(1);
        });
        return stopping;
    };
    stopOnHostLoss(() => { void stop(0); });
    // LIFE-006/PR-001: a broker started by the product holds a supervision
    // channel from it. Opened before anything slow, so a host that dies during
    // recovery still takes this broker with it; a broker started any other way
    // has no channel, opens no Principal endpoint, and runs as before.
    const supervised = process.env[HOST_CHANNEL_ENV] === String(HOST_CHANNEL_FD);
    principalHost = supervised
        ? openSupervisionChannel({
            fd: HOST_CHANNEL_FD,
            onHostGone: reason => { console.error(`${reason}; the broker stops with it`); void stop(0); },
            log: line => { console.error(line); },
        })
        : undefined;
    // P0V-28, P0-5: a broker told it is supervised whose channel could not be
    // established -- no descriptor, not a socket, a peer that is not this user or
    // is not observed running (a host that died before this looked) -- does not
    // know that it has a host. That is not "started without one": running on as
    // if it were would keep the society's lock with nothing left to stop it. It
    // gives the society back before anything is opened.
    if (supervised && principalHost === undefined) {
        console.error("the supervision channel this broker was started with could not be established; this broker does not start");
        await stop(1);
        return;
    }
    try {
        const cfg = loadConfig(configPath);
        graceSeconds = cfg.limits.receiptWaitSeconds;
        storageCloseMode = cfg.storage?.closeMode ?? "keep-hot";
        if (cfg.schemaVersion === 4 && cfg.storage === undefined)
            console.error("Session storage now defaults to keep-hot: closing retains workspace disk usage. Use oma archive --society " + society + " or storage.closeMode=on-close in configuration v5 to reclaim it.");
        if (cfg.society !== society)
            throw new StoreError("INVALID_REQUEST", "config society does not match the requested society");
        assertHostDirectoryLayout(cfg.installation.libdir);
        // Configuration accepts the normalized `${libdir}/` spelling; physical owners receive one canonical root.
        const libdir = cfg.installation.libdir.endsWith("/") ? cfg.installation.libdir.slice(0, -1) : cfg.installation.libdir;
        // No schema search, path flattening or cross-installation fallback.
        assertRuntimeAssets(runtimeAssets(cfg.installation.libdir), { schema: SCHEMA_PATH });
        assertDeploymentDigest(cfg.installation.libdir, cfg.installation.deploymentDigest);
        executions = new ExecutionRuntime(stateRoot, process.platform === "darwin" ? launchDarwinJobScope : undefined,
            process.platform === "darwin" ? claim.fence : undefined);
        const nativeOwner = executions;
        lifetime.retainNative(() => withAsyncCleanup(() => withAsyncCleanup(async () => { await residents?.close(); }, () => nativeOwner.close()), () => runtimeGeneration?.closeAsync()));
        await executions.recover();
        if (process.platform === "darwin") {
            const cache = join(dirname(stateRoot), ".runtime-" + createHash("sha256").update(stateRoot).digest("hex"));
            ensureOwnedUserDirectory(cache, cache);
            await executions.recoverAndMaintain(() => collectRuntimeArtifacts(cache, preparationAbort.signal));
            if (stopping !== null) { await stopping; return; }
            runtimePreparation = withProtectedMacNode(cfg.installation.node, stateRoot, nativeOwner, preparationAbort.signal,
                () => { if (preparationAbort.signal.aborted) throw new StoreError("CANCELLED_BEFORE_COMMIT", "runtime preparation was cancelled"); },
                node => prepareMacRuntimeGeneration(cfg.installation, cache, preparationAbort.signal, node));
            runtimeGeneration = await runtimePreparation;
            if (stopping !== null) { await stopping; return; }
        }
        if (cfg.resources !== undefined) {
            const resources = executions.configureResources(cfg.resources, stateRoot);
            console.error(JSON.stringify({ event: "workload.resources", observedAtMs: Date.now(), ...resources }));
        }
        sessionStorage = SessionStorage.forSociety({ stateRoot, society, fence: claim.fence,
            log: line => console.error(line), quiesce: (residents, action) => {
                // SQLite is closed here. This projection is bound to its exact
                // closed bytes by the checkpoint; it is not a replayed death proof.
                for (const actor of residents) {
                    if (!executions?.confirmDead(`resident:${actor.name}`))
                        throw new StoreError("RUN_TERMINATION_UNKNOWN", `workspace storage cannot prove ${actor.name} ended`);
                }
            } });
        if (sessionStorage !== null) {
            storagePreparation = sessionStorage.restore(preparationAbort.signal);
            await storagePreparation;
        }
        if (stopping !== null) { await stopping; return; }
        const projectIdx = args.indexOf("--project-dir");
        if (projectIdx >= 0) {
            const projectDir = args[projectIdx + 1];
            const binding = observeProjectBinding(stateRoot);
            if (projectDir === undefined || realpathSync(projectDir) !== projectDir || binding.kind !== "bound" ||
                binding.binding.society !== society || binding.binding.canonicalProjectPath !== projectDir)
                throw new StoreError("INVALID_REQUEST", "startup project does not match the society's committed binding");
            preparation = prepareSociety({ node: cfg.installation.node, libdir,
                stateRoot, society, projectDir, fence: claim.fence,
                signal: preparationAbort.signal, log: line => console.error(line) });
            const prepared = await preparation;
            freshVerifiedMain = prepared.verifiedMain ?? undefined;
        }
        if (stopping !== null) {
            await stopping;
            return;
        }
        assertStateRoot(stateRoot);
        let developerTools: MacDeveloperTools | undefined;
        if (process.platform === "darwin") {
            toolPreparation = prepareResidentTools(stateRoot, executions, preparationAbort.signal, () => {
                if (preparationAbort.signal.aborted || stopping !== null)
                    throw new StoreError("REF_STATE_UNKNOWN", "Broker is stopping before runtime tool observation");
            });
            developerTools = await toolPreparation;
            if (stopping !== null) { await stopping; return; }
        }
        const integrationPolicy = integrationPolicyFromConfig(cfg);
        assertSupportedIntegration(snapshotIntegrationPolicy(integrationPolicy));
        const storeDirectory = process.platform === "darwin" ? stateDirectory = openDirectory(stateRoot) : undefined;
        const openStore = () => {
            const store = new Store(join(stateRoot, "runtime.sqlite"), undefined, { society }, undefined,
                storeDirectory === undefined ? {} : { directoryFd: storeDirectory });
            lifetime.retainStore(() => store.close()); return store;
        };
        const store = openStore();
        const mail = createMailModule({ stateRoot, society }, store, cfg.limits.replyReferences, cfg.limits.batchMaxMessages,
            cfg.limits, () => broker.hintWork());
        const transport = process.platform === "darwin" ? createMachBrokerTransport(cfg.limits.idleStreamSeconds) : undefined;
        const units = createNativeResidents(store, executions, location, cfg,
            (socket, peer) => broker.attachRunner(socket, peer), () => broker.hintWork(), (actor, invocation) => broker.residentIncarnation(actor, invocation),
            { ...(developerTools === undefined ? {} : { developerTools }),
                ...(transport === undefined || runtimeGeneration === undefined ? {} : { darwin: { launchNode: runtimeGeneration.launchNode, reservePeer: transport.reservePeer } }) });
        residents = units;
        const resolveSpec = createChildSpecResolver(() => readCurrentHostPolicy(configPath, society), () => store.inTransaction);
        const gitPaths = { stateRoot, projectGit: projectGitPathAt(stateRoot), contextGit: join(stateRoot, "repos", "context.git"),
            worldDir: join(stateRoot, "world"), society,
            ownerSignal: preparationAbort.signal,
            checkNode: cfg.installation.node, checkAssetsDir: libdir, };
        if (developerTools !== undefined) {
            try { canonicalDirectory = openDirectory(gitPaths.projectGit); }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
                throw new StoreError("BROKER_UNAVAILABLE", "the Society's project repository is not prepared; start it through oma or with --project-dir", { cause: error });
            }
        }
        const canonicalExecution = developerTools === undefined || canonicalDirectory === undefined ? undefined :
            { executable: developerTools.git, directories: new Map([[gitPaths.projectGit, canonicalDirectory]]),
                directory(repository: string): number | undefined {
                    if (repository === gitPaths.worldDir) {
                        if (worldDirectory !== undefined) return worldDirectory;
                        try { return worldDirectory = openOwnedDirectoryPath(gitPaths.worldDir); }
                        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
                    }
                    if (repository !== gitPaths.contextGit) return undefined;
                    if (contextDirectory !== undefined) return contextDirectory;
                    try { return contextDirectory = openDirectory(gitPaths.contextGit); }
                    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
                } };
        const views = new ViewsModule(store, stateRoot, society, cfg.principalProfile, cfg.limits, units.workerSurface,
            { ...(canonicalExecution === undefined ? {} : { worldDirectory: () => canonicalExecution.directory(gitPaths.worldDir) }),
                ...(stateDirectory === undefined ? {} : { stateDirectory: () => stateDirectory }) });
        const executionOwner = executions;
        const checks = new CandidateChecks(gitPaths, (command, signal, authorize, inheritedFds, prepared, physicalLaunch) => executionOwner.run("candidate", command, signal, authorize, inheritedFds, undefined, prepared, physicalLaunch), undefined, preparationAbort.signal,
            () => executionOwner.confirmDead("candidate"), cfg.resources, runtimeGeneration?.launchNode);
        const { git, reviews } = createGitServices(gitPaths, store, mail, integrationPolicy, () => integrationPolicyFromConfig(readCurrentHostPolicy(configPath, society)), (candidate, check, cancellation, authorize, attempt) => checks.run(candidate, check, cancellation, authorize, attempt), { mailBodyBytes: cfg.limits.mailBodyBytes, subjectBytes: cfg.limits.subjectBytes,
            bundleBytes: cfg.limits.bundleBytes }, quarantineExecution(gitPaths, executionOwner, runtimeGeneration?.launchNode), canonicalExecution);
        const hasGoal = (): boolean => git.hasCommittedContext();
        const activationAllowed = (): boolean => {
            lifecycle.assertActiveCapacity();
            return lifetime.permitsActivation;
        };
        const lifecycle = createLifecycleModule(store, units, { stateRoot, projectGit: projectGitPathAt(stateRoot), society,
            ownerSignal: preparationAbort.signal, hasGoal, activationAllowed,
            residentProjectGit: residentProjectGit() }, resolveSpec, mail, git);
        views.bindCollaborationRecords({ mail, git, lifecycle,
            reviews: auth => reviews.observeRecords(auth, collaborationSocietyBirth(stateRoot, society, store.getAgent("principal"))),
            logs: actor => units.logFiles(actor) });
        const reconcile = createReconcileModule(store, mail, git, reviews, units, lifecycle, {
            projectGit: projectGitPathAt(stateRoot), hasGoal, activationAllowed,
            ...(freshVerifiedMain === undefined ? {} : { freshVerifiedMain }),
            sweepBudgetSeconds: cfg.limits.receiptWaitSeconds,
        }, canonicalExecution);
        // PR-001: only the host that started this process gets a Principal
        // endpoint, and credentials leave only on the channel that host holds --
        // never through a file, an environment or this process's own output.
        const broker = createBroker({ ...(cfg.collaborationFreshMutations === undefined ? {} : { collaborationFreshMutations: cfg.collaborationFreshMutations }), store: store, mail: mail, units: units, views: views, lifecycle: lifecycle, git: git, reviews: reviews, reviewTargets: reviews, reconcile: reconcile, paths: { stateRoot, runRoot, society, hasGoal,
            quiesceOnDrain: async () => {
                await reconcile.quiesceForShutdown();
                storageResidents = store.listAgents().filter(agent => agent.role === "resident")
                    .map(agent => ({ name: agent.name, incarnation: agent.incarnation }));
            } }, limits: cfg.limits, lock: lock, principalHost: principalHost, ...(transport === undefined ? {} : { transport }) });
        lifetime.attach(broker);
        const validateStoredProfiles = () => {
            for (const agent of store.listAgents()) {
                const spec = resolvedSpecOf(agent);
                if (!cfg.agentProfiles[spec.profile] || !cfg.modelProfiles[spec.modelProfile])
                    throw new StoreError("UNSUPPORTED_PROFILE", `unsupported stored profile for ${agent.name}`);
            }
        };
        await lifetime.start({
            recover: async () => {
                validateStoredProfiles();
                await reconcile.startup(false, async () => {
                    // P0V-58, DR16 (REC-007): the Residents' rootfs is put right here --
                    // after the startup quiescence proved every earlier Resident ended,
                    // so nothing still runs on it, and before recovery, listening or
                    // activation can wake one on it. A repair that fails ends startup:
                    // no broker listens or grants authority over an unverified rootfs.
                    // DR35's private host conversation uses no Resident rootfs.
                    if (process.platform === "linux")
                        for (const path of repairSociety(stateRoot))
                            console.error(`Restored rootfs entry to its expected value: ${path}`);
                    await lifecycle.bootstrap(cfg);
                    validateStoredProfiles();
                    lifecycle.assertActiveCapacity();
                });
                if (store.getAgent("principal")) {
                    for (const directory of ["new", "cur", "tmp"])
                        ensureOwnedUserDirectory(join(stateRoot, "mail", "inboxes", "principal", directory), stateRoot);
                }
            },
            listen: () => broker.start(),
            notify: () => {
                broker.notifyReady();
                console.error("broker ready");
                if (cfg.collaborationFreshMutations === "closed")
                    console.error("Selected collaboration-v1 fresh model mutations are closed for this broker lifetime. Original accepted recovery, observations, legacy sessions and supervising-host controls remain available. This is not Worker termination or completed drain evidence.");
            },
            activate: async () => { await reconcile.sweep(); views.refreshWorld(); },
        });
    }
    catch (error) {
        if (preparationAbort.signal.aborted) {
            await stop(0);
            return;
        }
        console.error("broker startup failed:", inspect(error, { depth: 6, breakLength: Infinity }));
        await stop(1);
    }
}
void main().catch(error => {
    console.error("broker initialization failed:", error instanceof StoreError ? `${error.code}: ${error.message}` : error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
});
