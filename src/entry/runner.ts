// MUST [RUN-001]/[UNIT-003]: runner entrypoint — one agent, one sandboxed Pi session.
// The fixed resident unit carries the broker-rendered profile as hex so a
// dynamically-created Resident never re-derives authority from initialResidents
// and the runner never opens runtime.sqlite directly.
import { join } from "node:path";
import { RunnerModule } from "../runner.js";
import { loadConfig } from "../config.js";

function usage(): never {
  console.error(
    "usage: runner.js --society <name> --agent <name> [--config <path>]",
  );
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

const cfg = loadConfig(configPath);
const profileHex = process.env.OMA_PROFILE_HEX ?? "";
if (!/^(?:[0-9a-f]{2})+$/.test(profileHex)) {
  console.error(`runner: missing broker-rendered profile for ${agent}`);
  process.exit(4);
}
const profileName = Buffer.from(profileHex, "hex").toString("utf8");
if (Buffer.from(profileName, "utf8").toString("hex") !== profileHex) {
  console.error(`runner: malformed broker-rendered profile for ${agent}`);
  process.exit(4);
}
if (!cfg.agentProfiles[profileName]) {
  console.error(`runner: unsupported profile ${profileName} for ${agent}`);
  process.exit(4);
}
const runner = new RunnerModule({ runRoot }, agent);

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
