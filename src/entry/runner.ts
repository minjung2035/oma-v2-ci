// RUN-001/UNIT-003: one bound runner identity. S-03 still prevents Pi consumption.
// The fixed unit supplies a broker-rendered profile; this process never reads SQLite.
import { join } from "node:path";
import { RunnerModule } from "../runner.js";
import { loadConfig } from "../config.js";
import { isValidActorName, isValidSocietyName } from "../ids.js";
import { StoreError } from "../domain/errors.js";

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
if (!isValidSocietyName(society) || !isValidActorName(agent)) usage();
const stateRoot = join(process.env.XDG_DATA_HOME ?? join(process.env.HOME ?? "/tmp", ".local", "share"), "oma", society);
const runRoot = join(process.env.XDG_RUNTIME_DIR ?? "/tmp", "oma", society);
const configPath = configIdx >= 0 && args[configIdx + 1] !== undefined ? args[configIdx + 1]! : join(stateRoot, "config.json");
const cfg = loadConfig(configPath);
if (cfg.society !== society) { console.error("runner: config society does not match the requested society"); process.exit(4); }
const profileHex = process.env.OMA_PROFILE_HEX ?? "";
if (!/^(?:[0-9a-f]{2})+$/.test(profileHex)) { console.error(`runner: missing broker-rendered profile for ${agent}`); process.exit(4); }
const profileName = Buffer.from(profileHex, "hex").toString("utf8");
if (Buffer.from(profileName, "utf8").toString("hex") !== profileHex) { console.error(`runner: malformed broker-rendered profile for ${agent}`); process.exit(4); }
if (!cfg.agentProfiles[profileName]) { console.error(`runner: unsupported profile for ${agent}`); process.exit(4); }
const runner = new RunnerModule({ runRoot }, agent, cfg.limits);
let stopping = false;
const stop = (): void => {
  if (stopping) return;
  stopping = true;
  void runner.stop().then(() => { process.exitCode = 0; }, () => {
    console.error(`runner ${agent}: transport shutdown failed`); process.exitCode = 2;
  });
};
process.once("SIGTERM", stop); process.once("SIGINT", stop);
void runner.run().then(
  () => { if (!stopping) process.exitCode = 0; },
  error => {
    if (stopping) return;
    console.error(`runner ${agent} failed: ${error instanceof StoreError ? error.code : "INTERNAL_ERROR"}`);
    process.exitCode = 2;
  },
).finally(() => { process.off("SIGTERM", stop); process.off("SIGINT", stop); });
