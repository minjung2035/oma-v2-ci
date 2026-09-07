// MUST [UNIT-004]/[LIFE-006]: broker entrypoint — composition only. Loads the
// closed host config, recovers durable state, binds endpoints, then READY=1.
import { join } from "node:path";
import { Store } from "../store.js";
import { MailModule } from "../mail.js";
import { UnitsModule } from "../units.js";
import { ViewsModule } from "../views.js";
import { LifecycleModule } from "../lifecycle.js";
import { Broker } from "../broker.js";
import { GitModule } from "../git.js";
import { loadConfig, resolveChildSpec } from "../config.js";

function usage(): never {
  console.error("usage: broker.js --society <name> [--config <path>]");
  process.exit(4);
}

const args = process.argv.slice(2);
const societyIdx = args.indexOf("--society");
const configIdx = args.indexOf("--config");
if (societyIdx < 0 || args[societyIdx + 1] === undefined) usage();
const society = args[societyIdx + 1]!;

const stateRoot = join(
  process.env.XDG_DATA_HOME ?? join(process.env.HOME ?? "/tmp", ".local", "share"),
  "oma", society,
);
const runRoot = join(process.env.XDG_RUNTIME_DIR ?? "/tmp", "oma", society);
const configPath = configIdx >= 0 && args[configIdx + 1] !== undefined ? args[configIdx + 1]! : join(stateRoot, "config.json");

const cfg = loadConfig(configPath);
const store = new Store(join(stateRoot, "runtime.sqlite"));
const mail = new MailModule({ stateRoot, society: cfg.society }, store, cfg.limits.replyReferences);
const units = new UnitsModule(cfg.society, {
  node: cfg.installation.node, libdir: cfg.installation.libdir, state: stateRoot, society: cfg.society, agent: "",
});
const views = new ViewsModule(store, stateRoot, cfg.society, cfg.principalProfile);
const lifecycle = new LifecycleModule(store, units, {
  stateRoot,
  projectGit: join(stateRoot, "repos", "project.git"),
  society: cfg.society,
  hasGoal: () => requireFss().existsSync(join(stateRoot, "world", "context", "current")),
}, (parent, input) => {
  const r = resolveChildSpec(cfg, { name: parent.name, profile: parent.profile }, { name: input.name, from: input.from, brief: input.brief });
  return r ? r.spec : null;
});
const git = new GitModule(
  {
    stateRoot,
    projectGit: join(stateRoot, "repos", "project.git"),
    contextGit: join(stateRoot, "repos", "context.git"),
    worldDir: join(stateRoot, "world"),
    society: cfg.society,
    quarantineTmpBytes: cfg.limits.bundleBytes,
    checkTimeoutSeconds: 60,
  },
  store,
  mail,
  null, // host integration checks come from cfg.integration.checks (phase 8 wiring)
);
const broker = new Broker(store, mail, units, views, lifecycle, git, { stateRoot, runRoot, society: cfg.society });

broker.start();
// MUST [LIFE-006]: reconcile pending physical effects before READY.
void mail.reconcilePending().then(() => {
  broker.notifyReady();
  console.error("broker ready");
});

function shutdown(): void {
  broker.drainAndClose();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

function requireFss(): typeof import("node:fs") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("node:fs") as typeof import("node:fs");
}