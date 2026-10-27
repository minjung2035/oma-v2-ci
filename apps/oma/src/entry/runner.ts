// RUN-001/UNIT-003: one bound runner identity with trusted Pi RPC delivery.
// The broker supplies explicit launch identity and profile; this process never reads SQLite.
import { dirname, join } from "node:path";
import { assertNativeRuntime } from "../runtime/native-support.js";
import { RunnerModule } from "../runner.js";
import { loadConfiguration } from "@oma/config";
import { isValidActorName, isValidSocietyName, UUID_V4_RE } from "@oma/domain/identifiers";
import { StoreError, errorCodeOf } from "@oma/domain/errors";
import { resolvePiRuntime } from "@oma/engine/pi-runtime";
import { ensureOwnedDirectory } from "@oma/storage/directory";
import { realpathSync } from "node:fs";
import { packageStoreRoot } from "../runtime/packages/index.js";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
import { launchedLocation, type LaunchLocation } from "../runtime/assets.js";
import { stopOnHostLoss } from "@oma/process/host-loss";
import { Socket } from "node:net";
import { closeOnExec } from "@oma/native/control-socket";
import { decodeMacDeveloperToolsHex } from "@oma/protocol/mac-developer-tools";
import { createResidentEngineEffects } from "../engine/resident-effects.js";

function usage(): never {
  console.error("usage: runner.js --society <name> --agent <name> --execution <uuid> --config <path> --state-root <dir> --run-root <dir>");
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
const executionIdx = args.indexOf("--execution");
const execution = args[executionIdx + 1];
if (executionIdx < 0 || executionIdx !== args.lastIndexOf("--execution") || !UUID_V4_RE.test(execution ?? "")) usage();
const invocationId = execution!.replaceAll("-", "");
// D03: the broker carries its resolved location on this launch's argv.
// Re-deriving it from ambient state could select another config or run root.
let location: LaunchLocation;
try { location = launchedLocation(args, society); }
catch (error) { console.error(`runner: ${error instanceof Error ? error.message : String(error)}`); usage(); }
const { stateRoot, runRoot, configPath } = location;
// Fixed direct-spawn capability. No pathname or environment fallback. Mark
// CLOEXEC before any engine/tool child can be created.
const control = (() => {
  try { closeOnExec(6); return new Socket({ fd: 6, readable: true, writable: true }); }
  catch { console.error("runner: inherited control descriptor is unavailable"); process.exit(4); }
})();
control.on("error", () => {});
try { assertNativeRuntime(); }
catch (error) { console.error(`runner: ${error instanceof Error ? error.message : String(error)}`); process.exit(4); }
const configuration = loadConfiguration(configPath);
const cfg = configuration.config;
// Private Broker input, decoded once. It is never role configuration or a
// Worker environment entry; no ambient/unprepared Mac toolchain fallback.
const developerTools = process.platform === "darwin" ? decodeMacDeveloperToolsHex(process.env.OMA_DEVELOPER_TOOLS_HEX) : undefined;
if (process.platform !== "darwin" && process.env.OMA_DEVELOPER_TOOLS_HEX !== undefined)
  throw new StoreError("UNSUPPORTED_PROFILE", "non-Mac Runner received a Mac toolchain launch");
delete process.env.OMA_DEVELOPER_TOOLS_HEX;
const engineEffects = createResidentEngineEffects(developerTools);
if (cfg.society !== society) { console.error("runner: config society does not match the requested society"); process.exit(4); }
const profileHex = process.env.OMA_PROFILE_HEX ?? "";
if (!/^(?:[0-9a-f]{2})+$/.test(profileHex)) { console.error(`runner: missing broker-rendered profile for ${agent}`); process.exit(4); }
const profileName = Buffer.from(profileHex, "hex").toString("utf8");
if (Buffer.from(profileName, "utf8").toString("hex") !== profileHex) { console.error(`runner: malformed broker-rendered profile for ${agent}`); process.exit(4); }
if (!cfg.agentProfiles[profileName]) { console.error(`runner: unsupported profile for ${agent}`); process.exit(4); }
// DR46-F01: the model reference is an accepted fact, never re-derived from
// the current role. Only the contents of that fixed reference apply now.
const modelHex = process.env.OMA_MODEL_PROFILE_HEX ?? "";
if (!/^(?:[0-9a-f]{2})+$/.test(modelHex)) { console.error(`runner: missing broker-rendered model reference for ${agent}`); process.exit(4); }
const modelName = Buffer.from(modelHex, "hex").toString("utf8");
if (Buffer.from(modelName, "utf8").toString("hex") !== modelHex || !Object.hasOwn(cfg.modelProfiles, modelName)) {
  console.error(`runner: malformed or unsupported accepted model reference for ${agent}`); process.exit(4);
}
// The tool-surface plan travels the same explicit hex launch channel.
// Every broker launch carries it; malformed bytes refuse startup.
// Like the profile above, the bytes must round-trip as UTF-8 -- hex that
// decodes to invalid UTF-8 is corrupted channel data, not a surface plan.
const toolSurfaceHex = process.env.OMA_TOOL_SURFACE_HEX ?? "";
if (!/^(?:[0-9a-f]{2})+$/.test(toolSurfaceHex)) { console.error(`runner: missing or malformed broker-rendered tool surface for ${agent}`); process.exit(4); }
const toolSurface = Buffer.from(toolSurfaceHex, "hex").toString("utf8");
if (Buffer.from(toolSurface, "utf8").toString("hex") !== toolSurfaceHex) { console.error(`runner: malformed broker-rendered tool surface for ${agent}`); process.exit(4); }
const profile = Object.freeze({ name: profileName, modelProfile: modelName, model: Object.freeze({ ...cfg.modelProfiles[modelName]! }),
  ...(configuration.roles[profileName] ? { settings: configuration.roles[profileName] } : {}),
  // D23/TSP-005: the deployment renders the run's surface plan into this
  // launch environment as hex, beside the accepted profile and model reference; this entry
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
// executable with no entry argument, so the runner refuses here at startup
// rather than throwing UNSUPPORTED_PROFILE on every delivery.
if (piRuntime.args[0] === undefined) {
  console.error(`runner ${agent}: OMA_PI_COMMAND supplies no shipped engine entry; a Resident requires the bundled engine`);
  process.exit(4);
}
// The engine home is oma's own beside the state root: a mode-000 `.engine`
// left by a stray is repaired within the data root, not wedged on (P0-8).
ensureOwnedDirectory(piRuntime.agentDir, dirname(stateRoot), 0o700);
// Every Worker requires confinement. The platform selects its private roots;
// configuration cannot select the host root or opt out of the sandbox.
// DR25/C18: the package store's real root, when one exists. The confinement
// mounts it read-only inside; the runner's paths carry it too, so the spawn
// plan can name the store's skills, prompt templates and themes on the argv.
const packages = cfg.installation.packages === undefined ? undefined
  : packageStoreRoot(cfg.installation.packages) ?? undefined;
const confinement = {
  libdir: cfg.installation.libdir,
  // DR25: the installed packages a role's extensions may name, mounted at the
  // directory the loader pinned them in.
  ...(packages === undefined ? {} : { packages }),
  // Bound as a single file, so resolve a symlinked Node to the real binary.
  node: realpathSync(cfg.installation.node),
};
const runner = new RunnerModule({ runRoot, stateRoot, society,
  piCommand: piRuntime.executable,
  piArgs: piRuntime.args,
  piAgentDir: piRuntime.agentDir,
  coreExtension: join(cfg.installation.libdir, DEPLOYMENT_LAYOUT.extension),
  cli: join(cfg.installation.libdir, DEPLOYMENT_LAYOUT.cli),
  ...(packages === undefined ? {} : { packages }),
  confinement }, agent, invocationId, cfg.limits, profile, control, engineEffects);
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
