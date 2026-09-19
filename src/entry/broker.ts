// UNIT-004/LIFE-006/REC-007: composition under a single process lifetime.
import { join } from "node:path";
import { fstatSync, mkdirSync, writeSync } from "node:fs";
import { Store, SCHEMA_PATH } from "../store.js";
import { MailModule } from "../mail.js";
import { UnitsModule, UNIT_TPL_DIR } from "../units.js";
import { ViewsModule } from "../views.js";
import { LifecycleModule } from "../lifecycle.js";
import { Broker, type PrincipalSessionRegistration } from "../broker.js";
import { PRINCIPAL_SESSION_ENV, isPrincipalSessionHandle } from "../protocol/principal-credential.js";

/** The write end the supervising host attached when it started this process.
 * Descriptor 0-2 are the ordinary streams; this is the next one. */
const PRINCIPAL_CREDENTIAL_FD = 3;
import { GitModule } from "../git.js";
import { integrationPolicyFromConfig, snapshotIntegrationPolicy, assertSupportedIntegration } from "../git/integration-policy.js";
import { ReconcileModule } from "../reconcile.js";
import { loadConfig } from "../config.js";
import { createChildSpecResolver } from "../config/policy.js";
import { ProcessLock } from "../runtime/process-lock.js";
import { BrokerLifetime } from "../runtime/broker-lifetime.js";
import { assertRuntimeAssets, runtimeAssets, assertHostDirectoryLayout } from "../runtime/assets.js";
import { assertDeploymentDigest } from "../runtime/deployment-manifest.js";
import { assertStorageQuotaAdmission } from "../storage/quota.js";
import { resolvedSpecOf } from "../authority.js";
import { StoreError } from "../domain/errors.js";
import { isValidSocietyName } from "../ids.js";

function usage(): never { console.error("usage: broker.js --society <name> [--config <path>]"); process.exit(4); }
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
  const lock = ProcessLock.acquire(join(runRoot, "broker.lock"));
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
    // PR-001: only a host that registered a session before this process started
    // gets a Principal endpoint, and its credential leaves on the descriptor
    // that host holds -- never through a file or this process's own output.
    const broker = new Broker(store, mail, units, views, lifecycle, git, reconcile,
      { stateRoot, runRoot, society, hasGoal, storageBytes: cfg.quota.storageBytes }, cfg.limits, lock,
      registeredPrincipalSession());
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
/** The session the host registered, if this broker was started by one.
 *
 * A broker started any other way -- by systemd, or by hand -- registers no
 * session, opens no Principal endpoint, and publishes no credential. That is
 * the truthful outcome: there is no host process to hand a credential to.
 */
function registeredPrincipalSession(): PrincipalSessionRegistration | undefined {
  const sessionHandle = process.env[PRINCIPAL_SESSION_ENV];
  if (!isPrincipalSessionHandle(sessionHandle)) return undefined;
  // The channel has to be the pipe a supervising host attached, and nothing
  // else. A stale registration inherited by a broker started another way would
  // otherwise write a credential into whatever descriptor 3 happens to be --
  // a log, a journal, someone else's file. No channel, no endpoint.
  let channel: ReturnType<typeof fstatSync>;
  try { channel = fstatSync(PRINCIPAL_CREDENTIAL_FD); }
  catch {
    console.error("a principal session is registered but no host channel is attached; no principal endpoint is opened");
    return undefined;
  }
  if (!channel.isFIFO() && !channel.isSocket()) {
    console.error("the principal credential channel is not a pipe; no principal endpoint is opened");
    return undefined;
  }
  return {
    sessionHandle,
    publish: credential => {
      try { writeSync(PRINCIPAL_CREDENTIAL_FD, `${credential}\n`); }
      catch (error) {
        // The host asked for a session and cannot be given one. Say so rather
        // than leave it waiting on a channel that will never answer.
        console.error("principal credential channel unavailable:", error instanceof Error ? error.message : String(error));
      }
    },
  };
}

void main().catch(error => {
  console.error("broker initialization failed:", error instanceof StoreError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
