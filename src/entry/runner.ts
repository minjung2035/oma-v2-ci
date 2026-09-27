// RUN-001/UNIT-003: one bound runner identity with trusted Pi RPC delivery.
// The fixed unit supplies a broker-rendered profile; this process never reads SQLite.
import { join } from "node:path";
import { RunnerModule } from "../runner.js";
import { loadConfiguration } from "../config.js";
import { isValidActorName, isValidSocietyName } from "../ids.js";
import { StoreError, errorCodeOf } from "../domain/errors.js";
import { resolvePiRuntime } from "../runtime/pi-runtime.js";
import { ensureDirectory } from "../storage/directory.js";
import { realpathSync } from "node:fs";
import { hostSystemLayout } from "../runtime/resident-rootfs.js";
import { residentsConfined } from "../sandbox.js";
import { DEPLOYMENT_LAYOUT } from "../domain/deployment.js";
import { parseCanonicalResourceLimits } from "../domain/resources.js";
import { launchedLocation, type LaunchLocation } from "../runtime/assets.js";

function usage(): never {
  console.error("usage: runner.js --society <name> --agent <name> --config <path> --state-root <dir> --run-root <dir>");
  process.exit(4);
}
const args = process.argv.slice(2);
const societyIdx = args.indexOf("--society");
const agentIdx = args.indexOf("--agent");
if (societyIdx < 0 || args[societyIdx + 1] === undefined) usage();
if (agentIdx < 0 || args[agentIdx + 1] === undefined) usage();
const society = args[societyIdx + 1]!;
const agent = args[agentIdx + 1]!;
if (!isValidSocietyName(society) || !isValidActorName(agent)) usage();
// D03: the unit carries the broker's resolved location. The user manager's
// environment is not the product's, so deriving it here again would let this
// runner read another configuration or serve another run root.
let location: LaunchLocation;
try { location = launchedLocation(args, society); }
catch (error) { console.error(`runner: ${error instanceof Error ? error.message : String(error)}`); usage(); }
const { stateRoot, runRoot, configPath } = location;
const configuration = loadConfiguration(configPath);
const cfg = configuration.config;
if (cfg.society !== society) { console.error("runner: config society does not match the requested society"); process.exit(4); }
const profileHex = process.env.OMA_PROFILE_HEX ?? "";
if (!/^(?:[0-9a-f]{2})+$/.test(profileHex)) { console.error(`runner: missing broker-rendered profile for ${agent}`); process.exit(4); }
const profileName = Buffer.from(profileHex, "hex").toString("utf8");
if (Buffer.from(profileName, "utf8").toString("hex") !== profileHex) { console.error(`runner: malformed broker-rendered profile for ${agent}`); process.exit(4); }
if (!cfg.agentProfiles[profileName]) { console.error(`runner: unsupported profile for ${agent}`); process.exit(4); }
// D05/WP25: resources are the agent's accepted spec, which the broker rendered
// into the unit when it was created. The current profile names the model only;
// an edited profile never re-sizes a Resident that was accepted with other limits.
const resourcesHex = process.env.OMA_RESOURCES_HEX ?? "";
const resources = /^(?:[0-9a-f]{2})+$/.test(resourcesHex) ? parseCanonicalResourceLimits(Buffer.from(resourcesHex, "hex").toString("utf8")) : null;
if (resources === null) { console.error(`runner: missing or malformed broker-rendered resources for ${agent}`); process.exit(4); }
const agentProfile = cfg.agentProfiles[profileName]!;
const modelName = agentProfile.modelProfile;
const profile = Object.freeze({ name: profileName, model: Object.freeze({ ...cfg.modelProfiles[modelName]! }),
  workspaceBytes: resources.workspaceBytes,
  ...(configuration.roles[profileName] ? { settings: configuration.roles[profileName] } : {}) });
// OMA runs the engine it shipped with, never one found on PATH, and points it
// at an agent directory OMA owns so a Pi the user installed stays untouched.
const piRuntime = resolvePiRuntime({
  stateRoot, libdir: cfg.installation.libdir, override: process.env.OMA_PI_COMMAND,
});
ensureDirectory(piRuntime.agentDir, 0o700);
// SB-001 wants a trusted rootfs holding pinned tools and empty mount targets.
// `installation.rootfs` names it; the value `/` means the deployment declared
// none, because binding the host root is exactly what SB-001 forbids. That is a
// real difference in what OMA can promise, so it is said once, out loud, rather
// than inferred later from an absent bwrap process.
const confinement = !residentsConfined(cfg.installation.rootfs) ? undefined : {
  rootfs: cfg.installation.rootfs,
  libdir: cfg.installation.libdir,
  // Bound as a single file, so resolve a symlinked Node to the real binary.
  node: realpathSync(cfg.installation.node),
  systemBinds: hostSystemLayout().binds,
  tmpBytes: resources.tmpBytes,
  checkResources: resources,
};
if (confinement === undefined)
  console.error(`runner ${agent}: no trusted rootfs is declared; the engine runs unconfined on this host`);
const runner = new RunnerModule({ runRoot, stateRoot, society,
  piCommand: piRuntime.executable,
  piArgs: piRuntime.args,
  piAgentDir: piRuntime.agentDir,
  coreExtension: join(cfg.installation.libdir, "dist/src/pi-extension.js"),
  cli: join(cfg.installation.libdir, DEPLOYMENT_LAYOUT.cli),
  ...(confinement === undefined ? {} : { confinement }) }, agent, cfg.limits, profile);
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
    console.error(`runner ${agent} failed: ${errorCodeOf(error)}`);
    process.exitCode = 2;
  },
).finally(() => { process.off("SIGTERM", stop); process.off("SIGINT", stop); });
