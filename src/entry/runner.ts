// MUST [RUN-001]: runner entrypoint — one agent, one sandboxed Pi session.
import { join } from "node:path";
import { Store } from "../store.js";
import { SandboxModule } from "../sandbox.js";
import { RunnerModule } from "../runner.js";
import { loadConfig } from "../config.js";

function usage(): never {
  console.error("usage: runner.js --society <name> --agent <name> [--config <path>]");
  process.exit(4);
}

const args = process.argv.slice(2);
const societyIdx = args.indexOf("--society");
const agentIdx = args.indexOf("--agent");
const configIdx = args.indexOf("--config");
if (societyIdx < 0 || args[societyIdx + 1] === undefined) usage();
if (agentIdx < 0 || args[agentIdx + 1] === undefined) usage();
const society = args[societyIdx + 1]!;
const agent = args[agentIdx + 1]!;

const stateRoot = join(
  process.env.XDG_DATA_HOME ?? join(process.env.HOME ?? "/tmp", ".local", "share"),
  "oma", society,
);
const runRoot = join(process.env.XDG_RUNTIME_DIR ?? "/tmp", "oma", society);
const configPath = configIdx >= 0 && args[configIdx + 1] !== undefined ? args[configIdx + 1]! : join(stateRoot, "config.json");

const cfg = loadConfig(configPath);
const resident = cfg.initialResidents.find((r) => r.name === agent);
const profileName = resident?.profile ?? (agent === "principal" ? cfg.principalProfile : undefined);
const resources = profileName ? cfg.agentProfiles[profileName]?.resources : undefined;
if (!resources) {
  console.error(`runner: unsupported profile for ${agent}`);
  process.exit(4);
}
const sandbox = new SandboxModule({
  rootfs: cfg.installation.rootfs,
  node: "/usr/bin/node", // in-rootfs executable paths
  pi: "/usr/bin/pi",
  piModeArgs: ["--mode", "rpc", "-e", "/opt/oma/pi-extension.js"],
  tmpBytes: 512 * 1024 * 1024,
  checkResources: resources,
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const store = new Store(join(stateRoot, "runtime.sqlite")); // open+close validates write access
store.close();

const runner = new RunnerModule(
  { runRoot, stateRoot, society, extensionArtifact: join(cfg.installation.libdir, "dist", "pi-extension.js") },
  sandbox,
  agent,
  join(stateRoot, "agents", agent, "home"),
  join(stateRoot, "agents", agent, "workspace"),
);

process.on("SIGTERM", () => {
  void runner.stop().then(() => process.exit(0));
});

runner.run().then(
  () => process.exit(0),
  (e) => {
    console.error(`runner ${agent} failed: ${(e as Error).message}`);
    process.exit(2);
  },
);