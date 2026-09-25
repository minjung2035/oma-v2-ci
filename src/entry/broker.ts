// UNIT-004/LIFE-006/REC-007: composition under a single process lifetime.
import { join } from "node:path";
import { mkdirSync, readFileSync } from "node:fs";
import { ensureDirectory } from "../storage/directory.js";
import { Store, SCHEMA_PATH } from "../store.js";
import { MailModule } from "../mail.js";
import { UnitsModule, UNIT_TPL_DIR, unitName, assertUserManagerReachable } from "../units.js";
import { ViewsModule } from "../views.js";
import { LifecycleModule } from "../lifecycle.js";
import { Broker } from "../broker.js";
import { HOST_CHANNEL_ENV, HOST_CHANNEL_FD } from "../protocol/host-channel.js";
import { openSupervisionChannel } from "../runtime/supervision-channel.js";
import { GitModule } from "../git.js";
import { integrationPolicyFromConfig, snapshotIntegrationPolicy, assertSupportedIntegration } from "../git/integration-policy.js";
import { ReconcileModule } from "../reconcile.js";
import { loadConfig } from "../config.js";
import { createChildSpecResolver } from "../config/policy.js";
import { ProcessLock, SOCIETY_OWNED_EXIT } from "../runtime/process-lock.js";
import { claimSocietyFence } from "../runtime/society-lease.js";
import { BrokerLifetime } from "../runtime/broker-lifetime.js";
import { assertRuntimeAssets, runtimeAssets, assertHostDirectoryLayout, hostLaunchLocation, launchedLocation, type LaunchLocation } from "../runtime/assets.js";
import { assertDeploymentDigest } from "../runtime/deployment-manifest.js";
import { StorageAdmission } from "../storage/quota.js";
import { resolvedSpecOf } from "../authority.js";
import { StoreError } from "../domain/errors.js";
import { isValidSocietyName } from "../ids.js";
import { projectGitPathAt } from "../storage/paths.js";

function usage(): never {
  console.error("usage: broker.js --society <name> [--config <path>] [--state-root <dir> --run-root <dir>]"); process.exit(4);
}

const args = process.argv.slice(2);
const societyIdx = args.indexOf("--society"); const configIdx = args.indexOf("--config");
if (societyIdx < 0 || args[societyIdx + 1] === undefined) usage();
const society = args[societyIdx + 1]!;
if (!isValidSocietyName(society)) usage();
// D03: a broker the product started is handed the product's location whole; a
// broker started any other way is its own host and derives it once, here.
let location: LaunchLocation;
try {
  location = args.includes("--state-root") || args.includes("--run-root")
    ? launchedLocation(args, society)
    : hostLaunchLocation(society, process.env, configIdx >= 0 ? args[configIdx + 1] : undefined);
} catch (error) { console.error(`broker: ${error instanceof Error ? error.message : String(error)}`); usage(); }
const { stateRoot, runRoot, configPath } = location;
// D03: the lifetime dependency a Resident may name is the one that exists. Only
// a broker systemd runs as the society's fixed unit is one a unit can bind to;
// any other broker outlives no Resident it started, so its drain stops them.
const brokerUnit = unitName(society, "broker", "service");
const systemdManaged = process.env[HOST_CHANNEL_ENV] === undefined && ownServiceUnit() === brokerUnit;
function ownServiceUnit(): string | null {
  try {
    const lines = readFileSync("/proc/self/cgroup", "utf8").trim().split("\n");
    const unified = lines.length === 1 && lines[0]!.startsWith("0::/") ? lines[0]!.slice(3) : null;
    return unified === null ? null : unified.slice(unified.lastIndexOf("/") + 1);
  } catch { return null; }
}
async function main(): Promise<void> {
  assertHostDirectoryLayout(runRoot, true);
  mkdirSync(runRoot, { recursive: true });
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
    if (graceSeconds === null) throw new StoreError("INTERNAL_ERROR", "runtime grace requested before host limits were loaded");
    return graceSeconds;
  });
  let exitStatus = 0; let stopping: Promise<void> | null = null;
  const stop = (code: number): Promise<void> => {
    exitStatus = Math.max(exitStatus, code);
    if (stopping) return stopping;
    stopping = lifetime.shutdown().then(() => { process.exitCode = exitStatus; }, error => {
      console.error("broker shutdown requires process termination:", error instanceof Error ? error.message : String(error)); process.exit(1);
    });
    return stopping;
  };
  process.once("SIGTERM", () => { void stop(0); }); process.once("SIGINT", () => { void stop(0); });
  // LIFE-006/PR-001: a broker started by the product holds a supervision
  // channel from it. Opened before anything slow, so a host that dies during
  // recovery still takes this broker with it; a broker started any other way
  // has no channel, opens no Principal endpoint, and runs as before.
  const principalHost = process.env[HOST_CHANNEL_ENV] === String(HOST_CHANNEL_FD)
    ? openSupervisionChannel({
      fd: HOST_CHANNEL_FD,
      onHostGone: reason => { console.error(`${reason}; the broker stops with it`); void stop(0); },
      log: line => { console.error(line); },
    })
    : undefined;
  try {
    const cfg = loadConfig(configPath);
    if (cfg.society !== society) throw new StoreError("INVALID_REQUEST", "config society does not match the requested society");
    assertHostDirectoryLayout(stateRoot, true);
    assertHostDirectoryLayout(cfg.installation.libdir);
    assertHostDirectoryLayout(cfg.installation.rootfs);
    // No schema search, path flattening or cross-installation fallback.
    assertRuntimeAssets(runtimeAssets(cfg.installation.libdir), { schema: SCHEMA_PATH, systemd: UNIT_TPL_DIR });
    assertDeploymentDigest(cfg.installation.libdir, cfg.installation.deploymentDigest);
    // D04: over the admission cap startup still enters bounded recovery (new work
    // is refused per request); only past the settlement headroom does it stop here.
    const storage = new StorageAdmission(stateRoot, cfg.quota.storageBytes, cfg.limits.frameBytes);
    storage.admit("settle")();
    graceSeconds = cfg.limits.receiptWaitSeconds;
    const integrationPolicy = integrationPolicyFromConfig(cfg.integration);
    assertSupportedIntegration(snapshotIntegrationPolicy(integrationPolicy));
    assertUserManagerReachable();
    const store = new Store(join(stateRoot, "runtime.sqlite"), undefined, { society });
    lifetime.retainStore(() => store.close());
    const mail = new MailModule({ stateRoot, society }, store, cfg.limits.replyReferences, cfg.limits.batchMaxMessages, cfg.limits);
    const units = new UnitsModule(society, { node: cfg.installation.node, libdir: cfg.installation.libdir, state: stateRoot, society, agent: "",
      config: configPath, run: runRoot, brokerUnit: systemdManaged ? brokerUnit : "" },
      undefined, Object.fromEntries(Object.entries(cfg.agentProfiles).map(([name, profile]) => [name, profile.resources])),
      agent => store.getAgent(agent)?.incarnation ?? null);
    const views = new ViewsModule(store, stateRoot, society, cfg.principalProfile, cfg.limits);
    const resolveSpec = createChildSpecResolver(() => {
      const current = loadConfig(configPath);
      if (current.society !== society) throw new StoreError("POLICY_CHANGED", "host policy society identity changed");
      return current;
    }, () => store.inTransaction);
    const git = new GitModule({ stateRoot, projectGit: projectGitPathAt(stateRoot), contextGit: join(stateRoot, "repos", "context.git"),
      worldDir: join(stateRoot, "world"), society, quarantineTmpBytes: cfg.limits.bundleBytes,
      quarantineResources: { cpuSeconds: 30, memoryBytes: 512 * 1024 * 1024, tasks: 1024 },
      checkTimeoutSeconds: Math.max(1, ...cfg.integration.checks.map(check => check.resources.checkTimeoutSeconds)),
      checkRootfs: cfg.installation.rootfs, checkAssetsDir: cfg.installation.rootfs,
      checkTmpBytes: Math.max(1, ...cfg.integration.checks.map(check => check.resources.tmpBytes)),
    }, store, mail, integrationPolicy, () => {
      const current = loadConfig(configPath);
      if (current.society !== society) throw new StoreError("POLICY_CHANGED", "host policy society identity changed");
      return integrationPolicyFromConfig(current.integration);
    });
    const hasGoal = (): boolean => git.hasCommittedContext();
    const lifecycle = new LifecycleModule(store, units, { stateRoot, projectGit: projectGitPathAt(stateRoot), society,
      hasGoal, activationAllowed: () => lifetime.permitsActivation }, resolveSpec, mail, cfg.quota);
    const reconcile = new ReconcileModule(store, mail, git, units, lifecycle, {
      projectGit: projectGitPathAt(stateRoot), hasGoal, activationAllowed: () => lifetime.permitsActivation,
      sweepBudgetSeconds: cfg.limits.receiptWaitSeconds, resourceGate: category => storage.admit(category),
    });
    // PR-001: only the host that started this process gets a Principal
    // endpoint, and credentials leave only on the channel that host holds --
    // never through a file, an environment or this process's own output.
    const broker = new Broker(store, mail, units, views, lifecycle, git, reconcile,
      { stateRoot, runRoot, society, hasGoal, storageBytes: cfg.quota.storageBytes, storage,
        ...(systemdManaged ? {} : { quiesceOnDrain: () => reconcile.quiesceForShutdown(), periodicReconcile: true }) }, cfg.limits, lock,
      principalHost);
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
        await reconcile.startup(false, async () => { await lifecycle.bootstrap(cfg); validateStoredProfiles(); });
        if (store.getAgent("principal")) {
          for (const directory of ["new", "cur", "tmp"]) ensureDirectory(join(stateRoot, "mail", "inboxes", "principal", directory));
          units.ensurePrincipal();
        }
      },
      listen: () => broker.start(),
      notify: () => {
        const notified = broker.notifyReady();
        if (process.env.NOTIFY_SOCKET && !notified) throw new StoreError("BROKER_UNAVAILABLE", "systemd READY notification failed");
        console.error(notified ? "broker ready" : "broker listening (foreground, no systemd notification)");
      },
      activate: async () => { await reconcile.sweep(); views.refreshWorld(); },
    });
  } catch (error) {
    console.error("broker startup failed:", error instanceof StoreError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error)); await stop(1);
  }
}
void main().catch(error => {
  console.error("broker initialization failed:", error instanceof StoreError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
