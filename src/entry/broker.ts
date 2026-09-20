// UNIT-004/LIFE-006/REC-007: composition under a single process lifetime.
import { join } from "node:path";
import { fstatSync, mkdirSync } from "node:fs";
import { Store, SCHEMA_PATH } from "../store.js";
import { MailModule } from "../mail.js";
import { UnitsModule, UNIT_TPL_DIR } from "../units.js";
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
import { SOCIETY_FENCE_ENV, SOCIETY_FENCE_FD } from "../process/async.js";
import { tryHoldSociety } from "../runtime/society-lease.js";
import { BrokerLifetime } from "../runtime/broker-lifetime.js";
import { assertRuntimeAssets, runtimeAssets, assertHostDirectoryLayout } from "../runtime/assets.js";
import { assertDeploymentDigest } from "../runtime/deployment-manifest.js";
import { assertStorageQuotaAdmission } from "../storage/quota.js";
import { resolvedSpecOf } from "../authority.js";
import { StoreError } from "../domain/errors.js";
import { isValidSocietyName } from "../ids.js";

function usage(): never { console.error("usage: broker.js --society <name> [--config <path>]"); process.exit(4); }

/** Whether this broker was started by the `oma` that owns the society, which
 * is true exactly when it was handed that society's lease.
 *
 * A declaration that cannot be honoured is a startup failure rather than a
 * shrug: a broker that was told it holds the society but does not would go on
 * to serve a society whose ownership nothing is holding. */
function inheritedSocietyFence(): boolean {
  const declared = process.env[SOCIETY_FENCE_ENV];
  if (declared === undefined) return false;
  if (declared !== String(SOCIETY_FENCE_FD))
    throw new StoreError("INTERNAL_ERROR", `${SOCIETY_FENCE_ENV} names descriptor ${declared}, which is not where this product places the society lease`);
  let kind;
  try { kind = fstatSync(SOCIETY_FENCE_FD); }
  catch { throw new StoreError("INTERNAL_ERROR", `${SOCIETY_FENCE_ENV} names descriptor ${SOCIETY_FENCE_FD}, which is not open`); }
  if (!kind.isSocket())
    throw new StoreError("INTERNAL_ERROR", `${SOCIETY_FENCE_ENV} names descriptor ${SOCIETY_FENCE_FD}, which is not the society lease`);
  return true;
}
const args = process.argv.slice(2);
const societyIdx = args.indexOf("--society"); const configIdx = args.indexOf("--config");
if (societyIdx < 0 || args[societyIdx + 1] === undefined) usage();
const society = args[societyIdx + 1]!;
if (!isValidSocietyName(society)) usage();
const stateRoot = join(process.env.XDG_DATA_HOME ?? join(process.env.HOME ?? "/tmp", ".local", "share"), "oma", society);
const runRoot = join(process.env.XDG_RUNTIME_DIR ?? "/tmp", "oma", society);
const configPath = configIdx >= 0 && args[configIdx + 1] !== undefined ? args[configIdx + 1]! : join(stateRoot, "config.json");
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
  // Nothing releases the lease. The kernel does, when the last descriptor onto
  // it closes, which is the only release that can never come too early.
  const fenced = inheritedSocietyFence();
  const lease = fenced ? null : tryHoldSociety(stateRoot);
  if (!fenced && lease === null) {
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
    assertStorageQuotaAdmission(stateRoot, cfg.quota.storageBytes);
    graceSeconds = cfg.limits.receiptWaitSeconds;
    const integrationPolicy = integrationPolicyFromConfig(cfg.integration);
    assertSupportedIntegration(snapshotIntegrationPolicy(integrationPolicy));
    const store = new Store(join(stateRoot, "runtime.sqlite"), undefined, { society });
    lifetime.retainStore(() => store.close());
    const mail = new MailModule({ stateRoot, society }, store, cfg.limits.replyReferences, cfg.limits.batchMaxMessages, cfg.limits);
    const units = new UnitsModule(society, { node: cfg.installation.node, libdir: cfg.installation.libdir, state: stateRoot, society, agent: "" },
      undefined, Object.fromEntries(Object.entries(cfg.agentProfiles).map(([name, profile]) => [name, profile.resources])),
      agent => store.getAgent(agent)?.incarnation ?? null);
    const views = new ViewsModule(store, stateRoot, society, cfg.principalProfile, cfg.limits);
    const resolveSpec = createChildSpecResolver(() => {
      const current = loadConfig(configPath);
      if (current.society !== society) throw new StoreError("POLICY_CHANGED", "host policy society identity changed");
      return current;
    }, () => store.inTransaction);
    const git = new GitModule({ stateRoot, projectGit: join(stateRoot, "repos", "project.git"), contextGit: join(stateRoot, "repos", "context.git"),
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
    const lifecycle = new LifecycleModule(store, units, { stateRoot, projectGit: join(stateRoot, "repos", "project.git"), society,
      hasGoal, activationAllowed: () => lifetime.permitsActivation }, resolveSpec, mail, cfg.quota);
    const reconcile = new ReconcileModule(store, mail, git, units, lifecycle, {
      projectGit: join(stateRoot, "repos", "project.git"), hasGoal, activationAllowed: () => lifetime.permitsActivation,
      sweepBudgetSeconds: cfg.limits.receiptWaitSeconds,
    });
    // PR-001: only the host that started this process gets a Principal
    // endpoint, and credentials leave only on the channel that host holds --
    // never through a file, an environment or this process's own output.
    const broker = new Broker(store, mail, units, views, lifecycle, git, reconcile,
      { stateRoot, runRoot, society, hasGoal, storageBytes: cfg.quota.storageBytes }, cfg.limits, lock,
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
          for (const directory of ["new", "cur", "tmp"]) mkdirSync(join(stateRoot, "mail", "inboxes", "principal", directory), { recursive: true });
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
