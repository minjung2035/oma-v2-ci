// MUST [UNIT-004]/[LIFE-006]/[REC-007]: composition under a single process lifetime.
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { Store } from "../store.js";
import { MailModule } from "../mail.js";
import { UnitsModule } from "../units.js";
import { ViewsModule } from "../views.js";
import { LifecycleModule } from "../lifecycle.js";
import { Broker } from "../broker.js";
import { GitModule } from "../git.js";
import { integrationPolicyFromConfig, snapshotIntegrationPolicy, assertSupportedIntegration } from "../git/integration-policy.js";
import { ReconcileModule } from "../reconcile.js";
import { loadConfig } from "../config.js";
import { createChildSpecResolver } from "../config/policy.js";
import { ProcessLock } from "../runtime/process-lock.js";
import { BrokerLifetime } from "../runtime/broker-lifetime.js";
import { resolvedSpecOf } from "../authority.js";
import { StoreError } from "../domain/errors.js";
import { isValidSocietyName } from "../ids.js";

function usage(): never {
  console.error("usage: broker.js --society <name> [--config <path>]"); process.exit(4);
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
  mkdirSync(runRoot, { recursive: true });
  // No config, database, migration, bootstrap or repository observation precedes this lock.
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
      console.error("broker shutdown requires process termination:", error instanceof Error ? error.message : String(error));
      // Grace expiry keeps DB/lock held. OS termination releases descriptors;
      // durable accepted intents remain recovery input, never fabricated success.
      process.exit(1);
    });
    return stopping;
  };
  process.once("SIGTERM", () => { void stop(0); });
  process.once("SIGINT", () => { void stop(0); });
  try {
    const cfg = loadConfig(configPath);
    if (cfg.society !== society) throw new StoreError("INVALID_REQUEST", "config society does not match the requested society");
    graceSeconds = cfg.limits.receiptWaitSeconds;
    const integrationPolicy = integrationPolicyFromConfig(cfg.integration);
    assertSupportedIntegration(snapshotIntegrationPolicy(integrationPolicy));
    const store = new Store(join(stateRoot, "runtime.sqlite"), undefined, { society });
    lifetime.retainStore(() => store.close());
    const mail = new MailModule({ stateRoot, society }, store, cfg.limits.replyReferences, cfg.limits.batchMaxMessages);
    const units = new UnitsModule(society, {
      node: cfg.installation.node, libdir: cfg.installation.libdir, state: stateRoot, society, agent: "",
    }, undefined, Object.fromEntries(Object.entries(cfg.agentProfiles).map(([name, profile]) => [name, profile.resources])),
    agent => store.getAgent(agent)?.incarnation ?? null);
    const views = new ViewsModule(store, stateRoot, society, cfg.principalProfile);
    const resolveSpec = createChildSpecResolver(() => {
      const current = loadConfig(configPath);
      if (current.society !== society) throw new StoreError("POLICY_CHANGED", "host policy society identity changed");
      return current;
    }, () => store.inTransaction);
    let contextOwner: GitModule | null = null;
    const hasGoal = (): boolean => contextOwner?.hasCommittedContext() ?? false;
    const lifecycle = new LifecycleModule(store, units, {
      stateRoot, projectGit: join(stateRoot, "repos", "project.git"), society, hasGoal,
    }, resolveSpec, mail, cfg.quota);
    const git = new GitModule({
      stateRoot, projectGit: join(stateRoot, "repos", "project.git"), contextGit: join(stateRoot, "repos", "context.git"),
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
    contextOwner = git;
    const reconcile = new ReconcileModule(store, mail, git, units, lifecycle, {
      projectGit: join(stateRoot, "repos", "project.git"), hasGoal, activationAllowed: () => lifetime.permitsActivation,
    });
    const broker = new Broker(store, mail, units, views, lifecycle, git, reconcile, {
      stateRoot, runRoot, society, hasGoal,
    }, cfg.limits, lock);
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
      // Resident units are After=broker. Activation cannot precede READY.
      activate: async () => { await reconcile.sweep(); views.refreshWorld(); },
    });
  } catch (error) {
    console.error("broker startup failed:", error instanceof Error ? error.message : String(error));
    await stop(1);
  }
}
void main().catch(error => {
  console.error("broker initialization failed:", error instanceof Error ? error.message : String(error)); process.exitCode = 1;
});
