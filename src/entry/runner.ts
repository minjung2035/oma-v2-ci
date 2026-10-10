// RUN-001/UNIT-003: one bound runner identity with trusted Pi RPC delivery.
// The fixed unit supplies a broker-rendered profile; this process never reads SQLite.
import { dirname, join } from "node:path";
import { RunnerModule } from "../runner.js";
import { loadConfiguration } from "../config.js";
import { isValidActorName, isValidSocietyName } from "../ids.js";
import { StoreError, errorCodeOf } from "../domain/errors.js";
import { resolvePiRuntime } from "../runtime/pi-runtime.js";
import { ensureOwnedDirectory } from "../storage/directory.js";
import { realpathSync } from "node:fs";
import { hostSystemLayout } from "../runtime/resident-rootfs.js";
import { requireResidentRootfs } from "../sandbox.js";
import { packageStoreRoot } from "../runtime/packages/index.js";
import { DEPLOYMENT_LAYOUT } from "../domain/deployment.js";
import { parseCanonicalResourceLimits } from "../domain/resources.js";
import { egressPolicyFor } from "../domain/egress.js";
import { launchedLocation, type LaunchLocation } from "../runtime/assets.js";
import { stopOnHostLoss } from "../runtime/broker-lifetime.js";

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
requireResidentRootfs(cfg.installation.rootfs);
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
// The tool-surface plan travels the same hex channel; a unit this broker
// rendered always carries it, and a malformed one is a corrupted channel.
// Like the profile above, the bytes must round-trip as UTF-8 -- hex that
// decodes to invalid UTF-8 is corrupted channel data, not a surface plan.
const toolSurfaceHex = process.env.OMA_TOOL_SURFACE_HEX ?? "";
if (!/^(?:[0-9a-f]{2})+$/.test(toolSurfaceHex)) { console.error(`runner: missing or malformed broker-rendered tool surface for ${agent}`); process.exit(4); }
const toolSurface = Buffer.from(toolSurfaceHex, "hex").toString("utf8");
if (Buffer.from(toolSurface, "utf8").toString("hex") !== toolSurfaceHex) { console.error(`runner: malformed broker-rendered tool surface for ${agent}`); process.exit(4); }
const agentProfile = cfg.agentProfiles[profileName]!;
const modelName = agentProfile.modelProfile;
// UX-08/DR34: the egress clause resolves against this role here, once, from
// the unit's own configuration -- a role whose resolved allowlist is empty
// gets no proxy, and a Human's edit lands on the next runner.
const egressPolicy = egressPolicyFor(cfg.egress, profileName);
const profile = Object.freeze({ name: profileName, modelProfile: modelName, model: Object.freeze({ ...cfg.modelProfiles[modelName]! }),
  workspaceBytes: resources.workspaceBytes,
  // FI-5: the bounds this unit runs under, told to the Resident it starts.
  resources: { cpuQuotaPercent: resources.cpuQuotaPercent, memoryBytes: resources.memoryBytes, tasks: resources.tasks },
  ...(configuration.roles[profileName] ? { settings: configuration.roles[profileName] } : {}),
  ...(egressPolicy === null ? {} : { egress: egressPolicy }),
  // D23/TSP-005: the deployment renders the run's surface plan into this
  // unit's environment as hex, beside the profile and resources; this entry
  // is the boundary that reads it once and makes it declared profile data.
  // The engine's spawn plan emits it and `--clearenv` makes it the only
  // channel -- nothing inherited carries a plan into the confined engine,
  // and the field is never authored role configuration. A unit this broker
  // rendered always carries it; a malformed one names a corrupted channel,
  // which does not start. Both hex gates above have already exited by here,
  // so the plan is always present.
  toolSurface });
// OMA runs the engine it shipped with, never one found on PATH, and points it
// at an agent directory OMA owns so a Pi the user installed stays untouched.
const piRuntime = resolvePiRuntime({
  stateRoot, libdir: cfg.installation.libdir, override: process.env.OMA_PI_COMMAND,
});
// A confined Resident runs the shipped engine entry: piArgs[0] is the bundle
// the mount plan translates. An OMA_PI_COMMAND override resolves to a bare
// executable with no entry argument, so the unit refuses here at startup
// rather than throwing UNSUPPORTED_PROFILE on every delivery.
if (piRuntime.args[0] === undefined) {
  console.error(`runner ${agent}: OMA_PI_COMMAND supplies no shipped engine entry; a Resident requires the bundled engine`);
  process.exit(4);
}
// The engine home is oma's own beside the state root: a mode-000 `.engine`
// left by a stray is repaired within the data root, not wedged on (P0-8).
ensureOwnedDirectory(piRuntime.agentDir, dirname(stateRoot), 0o700);
// SB-001 wants a trusted rootfs holding pinned tools and empty mount targets.
// `installation.rootfs` names it; binding the host root is what SB-001 forbids.
// Society is confined-only, and an unsupported rootfs is refused before any
// RunnerModule exists. Missing bubblewrap is a spawn failure, never permission
// to execute a Resident on the host.
// DR25/C18: the package store's real root, when one exists. The confinement
// mounts it read-only inside; the runner's paths carry it too, so the spawn
// plan can name the store's skills, prompt templates and themes on the argv.
const packages = cfg.installation.packages === undefined ? undefined
  : packageStoreRoot(cfg.installation.packages) ?? undefined;
const confinement = {
  rootfs: cfg.installation.rootfs,
  libdir: cfg.installation.libdir,
  // DR25: the installed packages a role's extensions may name, mounted at the
  // directory the loader pinned them in (on macOS the store is a link to it).
  ...(packages === undefined ? {} : { packages }),
  // Bound as a single file, so resolve a symlinked Node to the real binary.
  node: realpathSync(cfg.installation.node),
  systemBinds: hostSystemLayout().binds,
  tmpBytes: resources.tmpBytes,
};
const runner = new RunnerModule({ runRoot, stateRoot, society,
  piCommand: piRuntime.executable,
  piArgs: piRuntime.args,
  piAgentDir: piRuntime.agentDir,
  coreExtension: join(cfg.installation.libdir, "dist/src/pi-extension.js"),
  cli: join(cfg.installation.libdir, DEPLOYMENT_LAYOUT.cli),
  ...(packages === undefined ? {} : { packages }),
  confinement }, agent, cfg.limits, profile);
let stopping = false;
const stop = (): void => {
  if (stopping) return;
  stopping = true;
  void runner.stop().then(() => { process.exitCode = 0; }, () => {
    console.error(`runner ${agent}: transport shutdown failed`); process.exitCode = 2;
  });
};
// AV31, P0V-81: a SIGHUP or SIGQUIT stops the runner through its drain too.
stopOnHostLoss(stop);
void runner.run().then(
  () => { if (!stopping) process.exitCode = 0; },
  error => {
    if (stopping) return;
    console.error(`runner ${agent} failed: ${errorCodeOf(error)}`);
    process.exitCode = 2;
  },
).finally(() => { process.off("SIGTERM", stop); process.off("SIGINT", stop); });
