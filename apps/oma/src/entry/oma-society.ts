#!/usr/bin/env node
import { StoreError, exceptionText } from "@oma/domain/errors";
import { engineLoginDirectory } from "../engine/start-effects.js";
import { assertNativeRuntime } from "../runtime/native-support.js";
import { withAsyncCleanup } from "@oma/native/cleanup";
/** Product composition: command selection, admitted session, and process signal wiring. */
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { piAgentDir } from "@oma/engine/pi-runtime";
import { ensureOwnedDirectory } from "@oma/storage/directory";
import { codeFor, exitFor, fail as exitFailure } from "../application/exit.js";
import { PACKAGE_USAGE, packageActivation, packageCommand, packageListLines, packageStoreDir,
  readPackageIndex, writePackageIndex, type PackageCommand } from "../runtime/packages/index.js";
import { packageDirectories } from "../platform/package-files.js";
import { pruneLocalStage, stageLocalPackage } from "../application/local-packages.js";
import { applyPackageChange } from "../application/project-settings.js";
import { reconcilePersonalSettings } from "../runtime/personal-settings.js";
import { parseOmaArguments } from "../runtime/host-arguments.js";
import { tryHoldSociety } from "../runtime/society-lease.js";
import { runEngineLogin } from "@oma/engine/login";
import { HOST_LOSS_SIGNALS } from "@oma/process/host-loss";
import { identifyProject, bootstrapSociety, prepareSociety } from "../application/society-bootstrap.js";
import { SocietyRuntime } from "../application/society-runtime.js";
import { SocietyInteraction } from "../application/society-interaction.js";
import { SocietyTransition } from "../application/society-transition.js";

function usage(): never {
  process.stderr.write("usage: oma [--society <name>] [--config <path>] [--bind-project]\n       oma --mode personal [--no-project-extensions]\n       oma [--mode society|personal] --resume <history>\n       oma login\n" +
    `${PACKAGE_USAGE.replace(/^usage: /, "       ")}\n`);
  process.exit(0);
}

/** DR18 (D-9), DR24: `oma login` -- the engine's own login and model selection
 * over the Human's one engine home (tui/login.ts), which every session uses.
 * It needs no session. Two logins do not run at once: the login holds the
 * engine home's own lease for as long as its engine runs. */
async function login(dataRoot: string, project: string): Promise<never> {
  const stateRoot = join(dataRoot, project);
  const home = piAgentDir(stateRoot);
  let lease: ReturnType<typeof tryHoldSociety>;
  try { lease = tryHoldSociety(home); }
  catch (error) { fail(`Could not take the engine home: ${exceptionText(error)}`, codeFor(error)); }
  if (lease === null) fail("Another oma login is running.", exitFor("BROKER_UNAVAILABLE"));
  let code: number;
  try {
    code = await withAsyncCleanup(() => runEngineLogin(engineLoginDirectory, {
      stateRoot, libdir: fileURLToPath(new URL("../../../../", import.meta.url)),
      override: process.env.OMA_PI_COMMAND, fence: lease.fence, env: process.env }), () => lease.release());
  } catch (error) {
    fail(`Could not start the engine: ${exceptionText(error)}`, codeFor(error));
  }
  process.exit(code);
}

/** DR25: `oma pi <command>` -- the bundled engine's package manager over oma's
 * one package store, never the user's own Pi. After a change, the store's
 * extension index is asked of the engine again and every project's roles are
 * brought to it: a package a role used keeps being used, one removed is
 * dropped. What is installed here is turned on for this project's Principal
 * and Workers; other projects list it, off. */
async function piPackages(dataRoot: string, project: string, decision: Extract<PackageCommand, { kind: "run" }>): Promise<never> {
  const args = decision.args;
  const stateRoot = join(dataRoot, project);
  const store = packageStoreDir(stateRoot);
  const libdir = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
  // The store is oma's own under the data root: a mode-000 `.packages` or
  // `oma` a same-UID stray left is given its owner bits back on the walk,
  // not wedged on EACCES for every `oma pi` command.
  ensureOwnedDirectory(store, dataRoot, 0o700);
  let lease: ReturnType<typeof tryHoldSociety>;
  try { lease = tryHoldSociety(store); }
  catch (error) { fail(`Could not take the package store: ${exceptionText(error)}`, codeFor(error)); }
  if (lease === null) fail("Another oma pi command is running.", exitFor("BROKER_UNAVAILABLE"));
  const code = await withAsyncCleanup(async () => {
    let code: number;
    const before = readPackageIndex(store);
    // C20: a local source is copied into the store first; the engine installs
    // the staged `local/<name>`, never the path the Human gave.
    let run = decision;
    if (decision.local !== undefined)
      run = Object.freeze({ ...decision, args: Object.freeze(["install", await stageLocalPackage(store, decision.local)]) });
    code = await runEngineLogin(engineLoginDirectory, { stateRoot, libdir: `${libdir}/`, override: process.env.OMA_PI_COMMAND, fence: lease.fence,
      env: process.env, packages: { store, args: run.args } });
    if (code === 0 && decision.command !== "list" && !args.includes("--help") && !args.includes("-h")) {
      const after = await writePackageIndex(store, packageDirectories);
      pruneLocalStage(store, packageDirectories);
      const { ok, said } = applyPackageChange({ dataRoot, project, libdir, before, after, activate: packageActivation(run) });
      reconcilePersonalSettings({ dataRoot, libdir, packages: store });
      if (said.length > 0) process.stderr.write(`${said.join("\n")}\n`);
      code = ok ? 0 : 1;
    }
    if (code === 0 && decision.command === "list") {
      const contents = packageListLines(store);
      if (contents.length > 0) process.stdout.write(`Package contents:\n  ${contents.join("\n  ")}\n`);
    }
    return code;
  }, () => lease.release());
  process.exit(code);
}

/** Registered as each resource is acquired, before any fallible startup work. */
let abandon: (() => void) | null = null;

/** Immediate exits bypass main's rejection handler, but not resource ownership. */
function fail(message: string, code: ReturnType<typeof codeFor>): never {
  abandon?.();
  exitFailure(message, code);
}

async function main(argv: readonly string[]): Promise<void> {
  const command = parseOmaArguments(argv);
  if (command.kind === "help") usage();
  assertNativeRuntime();
  if (command.kind === "session" && command.mode === "personal")
    fail("Personal cannot start through the Society entry", exitFor("INVALID_REQUEST"));
  const packages = command.kind === "pi" ? packageCommand(command.args) : null;
  if (packages?.kind === "refused") fail(packages.words, exitFor("INVALID_REQUEST"));
  const { dataRoot, project, canonicalProjectPath } = identifyProject(fail);
  if (command.kind === "login") return login(dataRoot, project);
  if (packages?.kind === "run") return piPackages(dataRoot, project, packages);
  const bootstrap = await bootstrapSociety({ dataRoot, project, canonicalProjectPath,
    requestedSociety: command.kind === "session" ? command.society : undefined,
    externalConfigPath: command.kind === "session" ? command.config : undefined,
    bindRequested: command.kind === "session" && command.bindProject,
    resume: command.kind === "session" ? command.resume : undefined,
    acquired: cleanup => { abandon = cleanup; }, fail });
  const libdir = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
  let runtime: SocietyRuntime | undefined;
  let interaction: SocietyInteraction;
  const owner = () => runtime === undefined ? bootstrap.tenure : runtime.owner;
  const prepared = prepareSociety(bootstrap, libdir, {
    owns: () => owner() !== null,
    assertWritable: what => {
      const tenure = owner();
      if (tenure === null) throw new StoreError("BROKER_UNAVAILABLE", `Cannot change ${what}: another oma process owns this society`);
      tenure.assertOwned(what);
    },
    notice: text => interaction.notice(text), fail,
  });
  // Register the channel immediately, before display construction can fail.
  abandon = () => { bootstrap.tenure?.abandon(); };
  let transition: SocietyTransition;
  interaction = new SocietyInteraction(bootstrap, prepared.configuration, {
    session: () => runtime?.session ?? null, owned: () => owner() !== null,
    sessionDirectory: () => runtime!.sessionDirectory,
    finished: () => runtime?.finished ?? false,
    submit: text => runtime!.submit(text), deliver: () => runtime!.deliver(),
    shutdown: code => transition.shutdown(code), relaunch: (resume, mode) => transition.relaunch(resume, mode),
  }, cleanup => {
    abandon = () => {
      if (runtime !== undefined) runtime.abandon(); else bootstrap.tenure?.abandon();
      cleanup();
    };
  });
  runtime = new SocietyRuntime(bootstrap, prepared, interaction);
  transition = new SocietyTransition(bootstrap, prepared, libdir, runtime, interaction, fail);
  process.on("uncaughtException", error => {
    abandon?.(); process.stderr.write(`oma: ${exceptionText(error)}\n`); process.exit(codeFor(error));
  });
  for (const signal of HOST_LOSS_SIGNALS) process.on(signal, () => { void transition.shutdown(0); });
  await runtime.start();
  await interaction.observe();
}

main(process.argv.slice(2)).catch((error: unknown) => {
  // WP28: a failure after the terminal opened leaves it the way a crash does --
  // restored, broker stopped, engine ended -- and the reason is written after
  // the alternate screen is gone, where the Human can still read it.
  abandon?.();
  process.stderr.write(`oma: ${exceptionText(error)}\n`);
  process.exit(codeFor(error));
});
