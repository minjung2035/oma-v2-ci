// MUST [UNIT-004]/[LIFE-006]/[REC-007]: broker entrypoint — composition only.
// The society advisory lock is acquired before runtime.sqlite is opened.
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
import { acquireProcessLock, releaseProcessLocks } from "../leaf.js";
import { resolvedSpecOf } from "../authority.js";
import { StoreError } from "../domain/errors.js";
import { isValidSocietyName } from "../ids.js";

function usage(): never {
  console.error("usage: broker.js --society <name> [--config <path>]");
  process.exit(4);
}
const args = process.argv.slice(2);
const societyIdx = args.indexOf("--society");
const configIdx = args.indexOf("--config");
if (societyIdx < 0 || args[societyIdx + 1] === undefined) usage();
const society = args[societyIdx + 1]!;
if (!isValidSocietyName(society)) usage();
const stateRoot = join(process.env.XDG_DATA_HOME ?? join(process.env.HOME ?? "/tmp", ".local", "share"), "oma", society);
const runRoot = join(process.env.XDG_RUNTIME_DIR ?? "/tmp", "oma", society);
const configPath = configIdx >= 0 && args[configIdx + 1] !== undefined ? args[configIdx + 1]! : join(stateRoot, "config.json");

mkdirSync(runRoot, { recursive: true });
if (!acquireProcessLock(join(runRoot, "broker.lock"))) {
  console.error("broker startup failed: another broker holds the society lock");
  process.exit(1);
}
const cfg = loadConfig(configPath);
if (cfg.society !== society) throw new StoreError("INVALID_REQUEST", "config society does not match the requested society");
const integrationPolicy = integrationPolicyFromConfig(cfg.integration);
assertSupportedIntegration(snapshotIntegrationPolicy(integrationPolicy));
const store = new Store(join(stateRoot, "runtime.sqlite"));
const mail = new MailModule({ stateRoot, society: cfg.society }, store, cfg.limits.replyReferences, cfg.limits.batchMaxMessages);
const units = new UnitsModule(cfg.society, {
  node: cfg.installation.node, libdir: cfg.installation.libdir, state: stateRoot, society: cfg.society, agent: "",
}, undefined, Object.fromEntries(Object.entries(cfg.agentProfiles).map(([name, profile]) => [name, profile.resources])),
agent => store.getAgent(agent)?.incarnation ?? null);
const views = new ViewsModule(store, stateRoot, cfg.society, cfg.principalProfile);
const resolveSpec = createChildSpecResolver(() => {
  const current = loadConfig(configPath);
  if (current.society !== society) throw new StoreError("POLICY_CHANGED", "host policy society identity changed");
  return current;
}, () => store.inTransaction);
// A path, prepared candidate or partially notified context is not activation proof.
// The closure resolves its owner before bootstrap, and fails closed during setup.
let contextOwner: GitModule | null = null;
const hasGoal = (): boolean => contextOwner?.hasCommittedContext() ?? false;
const lifecycle = new LifecycleModule(store, units, {
  stateRoot, projectGit: join(stateRoot, "repos", "project.git"), society: cfg.society, hasGoal,
}, resolveSpec, mail, cfg.quota);
const git = new GitModule({
  stateRoot, projectGit: join(stateRoot, "repos", "project.git"), contextGit: join(stateRoot, "repos", "context.git"),
  worldDir: join(stateRoot, "world"), society: cfg.society, quarantineTmpBytes: cfg.limits.bundleBytes,
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
  projectGit: join(stateRoot, "repos", "project.git"), hasGoal,
});
const broker = new Broker(store, mail, units, views, lifecycle, git, reconcile, {
  stateRoot, runRoot, society: cfg.society, hasGoal,
}, cfg.limits);

/** MUST [LIFE-006]/[REC-001]: startup recovery precedes listeners and READY. */
async function bootstrap(): Promise<void> {
  await lifecycle.bootstrap(cfg);
  for (const agent of store.listAgents()) {
    const spec = resolvedSpecOf(agent);
    if (!cfg.agentProfiles[spec.profile] || !cfg.modelProfiles[spec.modelProfile])
      throw new StoreError("UNSUPPORTED_PROFILE", `unsupported stored profile for ${agent.name}`);
  }
  await reconcile.startup(false);
  if (store.getAgent("principal")) {
    for (const subdir of ["new", "cur", "tmp"])
      mkdirSync(join(stateRoot, "mail", "inboxes", "principal", subdir), { recursive: true });
    units.ensurePrincipal();
  }
  broker.start();
  broker.notifyReady();
  console.error("broker ready");
  // Resident units are After=broker; synchronous starts before READY deadlock.
  await reconcile.sweep();
  views.refreshWorld();
}
bootstrap().catch(error => {
  console.error("broker startup failed:", (error as Error).message);
  try { broker.drainAndClose(); } finally { releaseProcessLocks(); }
  process.exitCode = 1;
});
function shutdown(): void {
  try { broker.drainAndClose(); } finally { releaseProcessLocks(); }
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
