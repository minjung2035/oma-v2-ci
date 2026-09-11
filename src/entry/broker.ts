// MUST [UNIT-004]/[LIFE-006]/[REC-007]: broker entrypoint — composition only.
// The society advisory lock is acquired before runtime.sqlite is opened.
import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { Store } from "../store.js";
import { MailModule } from "../mail.js";
import { UnitsModule } from "../units.js";
import { ViewsModule } from "../views.js";
import { LifecycleModule } from "../lifecycle.js";
import { Broker } from "../broker.js";
import { GitModule } from "../git.js";
import { ReconcileModule } from "../reconcile.js";
import { loadConfig, resolveChildSpec } from "../config.js";
import { acquireProcessLock, releaseProcessLocks } from "../leaf.js";
import { resolvedSpecOf } from "../authority.js";
import { StoreError } from "../store.js";
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

const stateRoot = join(
  process.env.XDG_DATA_HOME ??
    join(process.env.HOME ?? "/tmp", ".local", "share"),
  "oma",
  society,
);
const runRoot = join(process.env.XDG_RUNTIME_DIR ?? "/tmp", "oma", society);
const configPath =
  configIdx >= 0 && args[configIdx + 1] !== undefined
    ? args[configIdx + 1]!
    : join(stateRoot, "config.json");

// MUST [REC-007]: the singleton decision precedes Store construction/migration
// and every reconcile/Git/mail write reachable from bootstrap.
mkdirSync(runRoot, { recursive: true });
if (!acquireProcessLock(join(runRoot, "broker.lock"))) {
  console.error("broker startup failed: another broker holds the society lock");
  process.exit(1);
}

const cfg = loadConfig(configPath);
if (cfg.society !== society)
  throw new StoreError("INVALID_REQUEST", "config society does not match the requested society");
if (cfg.integration.checks.length > 0)
  throw new StoreError("SPIKE_UNRESOLVED", "S-01-CANDIDATE does not support nonempty checks profiles yet");
// CFG-005 admits `/` as the whole-repository protected subtree, but Git paths
// are relative. Until the integration matcher is explicitly root-aware, refuse
// this profile rather than silently running with no paths protected.
if (cfg.integration.protectedPaths.includes("/"))
  throw new StoreError("SPIKE_UNRESOLVED", "root protected-path matching is not implemented yet");
const store = new Store(join(stateRoot, "runtime.sqlite"));
const mail = new MailModule(
  { stateRoot, society: cfg.society },
  store,
  cfg.limits.replyReferences,
  cfg.limits.batchMaxMessages,
);
const units = new UnitsModule(
  cfg.society,
  {
    node: cfg.installation.node,
    libdir: cfg.installation.libdir,
    state: stateRoot,
    society: cfg.society,
    agent: "",
  },
  undefined,
  Object.fromEntries(
    Object.entries(cfg.agentProfiles).map(([name, profile]) => [
      name,
      profile.resources,
    ]),
  ),
  (agent) => store.getAgent(agent)?.incarnation ?? null,
);
const views = new ViewsModule(
  store,
  stateRoot,
  cfg.society,
  cfg.principalProfile,
);
const lifecycle = new LifecycleModule(
  store,
  units,
  {
    stateRoot,
    projectGit: join(stateRoot, "repos", "project.git"),
    society: cfg.society,
    hasGoal: () => existsSync(join(stateRoot, "world", "context", "current")),
  },
  (parent, input) => {
    const r = resolveChildSpec(
      loadConfig(configPath),
      {
        name: parent.name,
        profile: parent.profile,
        capabilities: parent.capabilities,
      },
      { name: input.name, from: input.from, brief: input.brief },
    );
    return r ? r.spec : null;
  },
  mail,
  cfg.quota,
);
const git = new GitModule(
  {
    stateRoot,
    projectGit: join(stateRoot, "repos", "project.git"),
    contextGit: join(stateRoot, "repos", "context.git"),
    worldDir: join(stateRoot, "world"),
    society: cfg.society,
    quarantineTmpBytes: cfg.limits.bundleBytes,
    quarantineResources: {
      cpuSeconds: 30,
      memoryBytes: 512 * 1024 * 1024,
      tasks: 1024,
    },
    checkTimeoutSeconds: Math.max(
      1,
      ...cfg.integration.checks.map((c) => c.resources.checkTimeoutSeconds),
    ),
    checkRootfs: cfg.installation.rootfs,
    checkAssetsDir: cfg.installation.rootfs,
    checkTmpBytes: Math.max(
      1,
      ...cfg.integration.checks.map((c) => c.resources.tmpBytes),
    ),
  },
  store,
  mail,
  {
    policyRevision: cfg.integration.policyRevision,
    protectedPaths: [...cfg.integration.protectedPaths],
    checks: cfg.integration.checks.map((c) => ({
      id: c.id,
      argv: [...c.argv],
      env: { ...c.env },
      timeoutSeconds: c.resources.checkTimeoutSeconds,
      tmpBytes: c.resources.tmpBytes,
      resources: { ...c.resources },
    })),
  },
  () => loadConfig(configPath).integration.policyRevision,
);
const reconcile = new ReconcileModule(store, mail, git, units, lifecycle, {
  projectGit: join(stateRoot, "repos", "project.git"),
  hasGoal: () => existsSync(join(stateRoot, "world", "context", "current")),
});
const broker = new Broker(
  store,
  mail,
  units,
  views,
  lifecycle,
  git,
  reconcile,
  {
    stateRoot,
    runRoot,
    society: cfg.society,
    hasGoal: () => existsSync(join(stateRoot, "world", "context", "current")),
  },
  cfg.limits,
);

/**
 * MUST [LIFE-006]/[REC-001]: ordered bootstrap — start-up recovery completes
 * before sockets bind and READY=1 is signalled.
 */
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

bootstrap().catch((e) => {
  console.error("broker startup failed:", (e as Error).message);
  try {
    broker.drainAndClose();
  } finally {
    releaseProcessLocks();
  }
  process.exitCode = 1;
});

function shutdown(): void {
  try {
    broker.drainAndClose();
  } finally {
    releaseProcessLocks();
  }
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
