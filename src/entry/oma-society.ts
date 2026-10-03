#!/usr/bin/env node
/** TUI-002/003: the host product entrypoint.
 *
 * This is the `oma` a Human runs. It is a different executable from the
 * model-facing CLI in the Resident rootfs (src/cli.ts) and shares no argv
 * parser, capability or socket with it. Nothing here is mounted into a sandbox.
 */
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidSocietyName } from "../ids.js";
import { StoreError } from "../domain/errors.js";
import { DEPLOYMENT_LAYOUT } from "../domain/deployment.js";
import { assertHostDirectoryLayout, hostLaunchLocation } from "../runtime/assets.js";
import { resolvePiRuntime } from "../runtime/pi-runtime.js";
import { ensureDirectory, removeUnusedTree } from "../storage/directory.js";
import { TuiApp, type AppPorts } from "../tui/app.js";
import { codeFor, exitFor, fail as exitFailure } from "../tui/exit.js";
import { errorWords, humanStream, surfaceWords } from "../tui/words.js";
import { PanelTerminal } from "../tui/panel-terminal.js";
import { dashboardData } from "../tui/dashboard.js";
import { PrincipalSession, newSessionHandle, principalEnvironment, principalSessionDir, principalSessionProfile, principalWorkspace } from "../tui/session.js";
import { PrincipalDelivery, principalHostBroker } from "../runtime/principal-delivery.js";
import type { PiEvent } from "../runtime/pi-rpc.js";
import { TuiTransport, limitsOf, type Observation } from "../tui/transport.js";
import { principalMailbox, readBody, readMailbox, unreadCount } from "../tui/sources/mail.js";
import { storedMailBytes } from "../domain/mail-values.js";
import { readExtensions, toggleExtension } from "../tui/sources/extensions.js";
import { PRINCIPAL_MODEL, WORKER_MODEL, bootstrapStateOf, commitField, commitManagedEdit, commitRoleSet, deriveSessionSettings,
  engineModelChoiceOf, engineName, fieldsOf, followsEngine, projectBundle, projectSettingsPath, readSettings, readSettingsForEditing,
  roleSetOf, workerModelText, writeSettings, type FieldValue, type SessionOwn, type Settings } from "../tui/sources/settings.js";
import { PACKAGE_USAGE, packageActivation, packageCommand, packageStoreDir, readPackageIndex, writePackageIndex,
  type PackageCommand } from "../runtime/pi-packages.js";
import { applyPackageChange, ensureProjectSettings } from "../tui/project-settings.js";
import { reconcilePersonalSettings } from "../runtime/personal-settings.js";
import { collectManagedGenerations } from "../config/generations.js";
import { defaultHostConfig, defaultSocietyFor, sessionSocietyName, societyFromDirectory } from "../config/defaults.js";
import { sha256Hex } from "../hash.js";
import {
  observeProjectBinding, projectBindingDecision, provisionSociety, publishProjectBinding, residentRootfsPath,
  stateRootHasSociety, type ProvisionReport,
} from "../runtime/provision.js";
import { brokerListening, superviseBroker, type BrokerHandle } from "../runtime/broker-supervisor.js";
import { parseOmaArguments } from "../runtime/host-arguments.js";
import { newSessionBirth, publishSessionBirth } from "../runtime/session-mode.js";
import { RESUME_SESSION_ENV, sessionBirthForHistory, sessionHistoryDirectories } from "../runtime/session-catalog.js";
import { requestHostNewSession } from "../runtime/session-handoff.js";
import { HostHistoryChannel } from "../runtime/host-history-channel.js";
import { isHostHistoryReference } from "../protocol/host-history.js";
import { guestHistoryReference } from "../protocol/guest-history.js";
import { inspectSessionHistory } from "../runtime/session-history.js";
import { HostTenure } from "../runtime/host-tenure.js";
import { tryHoldSociety } from "../runtime/society-lease.js";
import { deploymentDigest } from "../runtime/deployment-manifest.js";
import type { ConfigField, ExtensionRow } from "../tui/model.js";
import type { PromptOutcome } from "../tui/prompt.js";
import { HOST_LOSS_SIGNALS } from "../runtime/broker-lifetime.js";
import { runEngineLogin } from "../tui/login.js";
import { openPrincipalEgress, type PrincipalEgress } from "../runtime/egress-forwarder.js";

function usage(): never {
  humanStream().write("usage: oma [--society <name>] [--config <path>] [--bind-project]\n       oma login\n" +
    `${PACKAGE_USAGE.replace(/^usage: /, "       ")}\n`);
  process.exit(0);
}

/** DR18 (D-9), DR24: `oma login` -- the engine's own login and model selection
 * over the Human's one engine home (tui/login.ts), which every session uses.
 * It needs no session. Two logins do not run at once: the login holds the
 * engine home's own lease for as long as its engine runs. */
async function login(dataRoot: string, project: string): Promise<never> {
  const stateRoot = join(dataRoot, project);
  const home = resolvePiRuntime({ stateRoot, override: process.env.OMA_PI_COMMAND }).agentDir;
  let lease: ReturnType<typeof tryHoldSociety>;
  try { lease = tryHoldSociety(home); }
  catch (error) { fail(`Could not take the engine home: ${errorWords(error)}`, codeFor(error)); }
  if (lease === null) fail("Another oma login is running.", exitFor("BROKER_UNAVAILABLE"));
  let code: number;
  try {
    code = await runEngineLogin({ stateRoot, libdir: fileURLToPath(new URL("../../../", import.meta.url)),
      override: process.env.OMA_PI_COMMAND, fence: lease.fence, env: process.env });
  } catch (error) {
    lease.release();
    fail(`Could not start the engine: ${errorWords(error)}`, codeFor(error));
  }
  lease.release();
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
  const libdir = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
  ensureDirectory(store, 0o700);
  let lease: ReturnType<typeof tryHoldSociety>;
  try { lease = tryHoldSociety(store); }
  catch (error) { fail(`Could not take the package store: ${errorWords(error)}`, codeFor(error)); }
  if (lease === null) fail("Another oma pi command is running.", exitFor("BROKER_UNAVAILABLE"));
  let code: number;
  try {
    const before = readPackageIndex(store);
    code = await runEngineLogin({ stateRoot, libdir: `${libdir}/`, override: process.env.OMA_PI_COMMAND, fence: lease.fence,
      env: process.env, packages: { store, args: decision.args } });
    if (code === 0 && decision.command !== "list" && !args.includes("--help") && !args.includes("-h")) {
      const after = await writePackageIndex(store);
      const { ok, said } = applyPackageChange({ dataRoot, project, libdir, before, after, activate: packageActivation(decision) });
      reconcilePersonalSettings({ dataRoot, libdir, packages: store });
      if (said.length > 0) humanStream().write(`${said.join("\n")}\n`);
      code = ok ? 0 : 1;
    }
  } finally { lease.release(); }
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
  if (command.kind === "session" && command.mode === "personal")
    fail("Personal cannot start through the Society entry", exitFor("INVALID_REQUEST"));
  const packages = command.kind === "pi" ? packageCommand(command.args) : null;
  if (packages?.kind === "refused") fail(packages.words, exitFor("INVALID_REQUEST"));
  // No society given: derive one from the project directory, so running `oma`
  // in a checkout just works and two checkouts stay separate.
  // D05/WP16.01: the project directory is observed once, here; the identity
  // derived from it is pure, and it names a society only through the binding
  // checked below before anything of that society is written.
  let canonicalProjectPath: string;
  try { canonicalProjectPath = realpathSync(process.cwd()); }
  catch (error) { fail(`Cannot verify the project directory: ${errorWords(error)}`, codeFor(error)); }
  const explicitSociety = command.kind === "session" ? command.society : undefined;
  const configArgument = command.kind === "session" ? command.config : undefined;
  const bindRequested = command.kind === "session" && command.bindProject;
  // DR24: the project has one name, which its settings are kept under (and its
  // first society had); each session of it is a society of its own.
  const project = defaultSocietyFor(canonicalProjectPath, sha256Hex(canonicalProjectPath));
  if (!isValidSocietyName(project)) fail("Invalid project name", exitFor("INVALID_REQUEST"));
  const dataRoot = dirname(hostLaunchLocation(project, process.env).stateRoot);
  if (command.kind === "login") return login(dataRoot, project);
  if (packages?.kind === "run") return piPackages(dataRoot, project, packages);
  // A start is a new session, as the engine's own is. `/resume` reopens an
  // earlier one by starting this process again with its session file, so the
  // session's society -- conversation, mail, workers, repositories -- is the
  // one reopened, whole.
  const resumeFile = command.kind === "session" ? command.resume ?? process.env[RESUME_SESSION_ENV] : process.env[RESUME_SESSION_ENV];
  delete process.env[RESUME_SESSION_ENV];
  const resumedBirth = resumeFile === undefined ? null : await sessionBirthForHistory(dataRoot, resumeFile, canonicalProjectPath);
  if (resumedBirth !== null && resumedBirth.mode !== "society")
    fail("Personal cannot resume through the Society entry", exitFor("INVALID_REQUEST"));
  const resumedSociety = resumedBirth?.id ?? null;
  let society: string = explicitSociety ?? resumedSociety ?? sessionSocietyName(project, Date.now());
  for (let stamp = Date.now() + 1; explicitSociety === undefined && resumedSociety === null && stateRootHasSociety(join(dataRoot, society)); stamp += 1)
    society = sessionSocietyName(project, stamp);
  if (!isValidSocietyName(society)) fail("Invalid society name", exitFor("INVALID_REQUEST"));
  const sessionFile = resumedSociety !== null && society === resumedSociety ? resumeFile : undefined;
  // D03: this is where the society's location is decided; everything this
  // process starts is handed it rather than deriving its own.
  const location = hostLaunchLocation(society, process.env, configArgument);
  const { stateRoot, runRoot, configPath } = location;

  // TUI-004/REC-007: before a byte of this society's state is written and
  // before any broker is started, this process either owns the society or it
  // does not. Ownership is this tenure and nothing else -- not a spawned pid,
  // not a broker that happens to be up, and not a lock that dies with a child,
  // which left a gap at every broker restart for a second `oma` to walk into.
  // A refusal here also covers the case no earlier design could: an `oma` that
  // is already gone but whose engine is still running holds the society until
  // that engine exits, because the engine inherited the lease.
  //
  // The paths the answer is derived from are checked before they are used, not
  // after. An `oma` pointed at a relative, denormalized or symlinked run root
  // would otherwise take the society, write its configuration, provision it and
  // repair it -- a repair that edits `/etc/passwd`, `/etc/group` and symlinks
  // inside the rootfs -- and only discover afterwards that the place it was
  // told to work in is not the place it checked. The state root is checked by
  // the lease itself, because that is where the name it takes comes from
  // (VAL-002, FS-005).
  try { assertHostDirectoryLayout(runRoot, true); }
  catch (error) { fail(`The society run directory cannot be trusted: ${errorWords(error)}`, codeFor(error)); }

  let tenure: HostTenure | null;
  try { tenure = HostTenure.take(stateRoot); }
  catch (error) { fail(`Could not verify society ownership: ${errorWords(error)}`, codeFor(error)); }
  abandon = () => { tenure?.abandon(); };

  // A broker that is already listening owns the writing of this society, no
  // matter who started it -- a systemd unit, an operator by hand, or an `oma`
  // whose host is gone. This question used to be asked inside `superviseBroker`,
  // which runs after the configuration has been written and after the society
  // has been provisioned and repaired: this process would have modified files
  // inside a rootfs another broker was already serving Residents from, and only
  // then stood down. It is asked here instead, before anything is written, so
  // standing down costs nothing and changes nothing.
  //
  // The lease is given up with it. Holding a society this process has refused
  // to act on would keep the next `oma` out for no reason.
  //
  // The question is asked whether or not this process got the lease. A broker
  // started outside the product now takes the society lease itself, so a
  // refused lease is often that broker rather than another `oma`, and a
  // refusal that names the wrong thing sends the Human to look for the wrong
  // process.
  let ownershipRefusal = "Another oma process owns this society";
  if (await brokerListening(runRoot)) {
    if (tenure !== null) { await tenure.end(); tenure = null; }
    ownershipRefusal = "This society's broker is already running";
  }

  // D05/WP16.02-03: a society is acted on only for the project it is bound
  // to, decided before this process writes anything of it. A fresh society is
  // bound to this project; an existing unbound one only on --bind-project; a
  // mismatch is refused even with --society. An earlier default name for this
  // project is never taken over or renamed implicitly.
  /** Whether this process made the society: a session it may remove again if
   * nothing was said in it. */
  let createdHere = false;
  {
    const observation = observeProjectBinding(stateRoot);
    const hasSociety = stateRootHasSociety(stateRoot);
    createdHere = !hasSociety;
    const firstRoot = join(dataRoot, project);
    if (explicitSociety === undefined && resumedSociety === null && !stateRootHasSociety(firstRoot)
      && observeProjectBinding(firstRoot).kind === "absent") {
      const legacy = societyFromDirectory(canonicalProjectPath);
      if (legacy !== project && isValidSocietyName(legacy) && stateRootHasSociety(join(dataRoot, legacy))) {
        if (tenure !== null) await tenure.end();
        fail(`A legacy society '${legacy}' exists for this project name. To keep using it, verify that it belongs to this project, then run \`oma --society ${legacy} --bind-project\`. No new society was started.`, exitFor("INVALID_REQUEST"));
      }
    }
    const decision = projectBindingDecision({ observation, society, canonicalProjectPath, hasSociety,
      bindRequested: bindRequested && tenure !== null });
    if (decision.kind === "refuse" || (decision.kind === "publish" && tenure === null && hasSociety)) {
      if (tenure !== null) await tenure.end();
      fail(decision.kind === "refuse" ? `Cannot open this society from this project: ${surfaceWords(decision.reason, `Error code ${decision.code}`)}` :
        "This society has no project binding and is owned by another oma process",
        exitFor(decision.kind === "refuse" ? decision.code : "BROKER_UNAVAILABLE"));
    }
    if (decision.kind === "publish" && tenure !== null) {
      try { publishProjectBinding(stateRoot, { society, canonicalProjectPath }); }
      catch (error) {
        await tenure.end();
        fail(`Could not record the society's project binding: ${errorWords(error)}`, codeFor(error));
      }
    }
  }

  if (tenure !== null) publishSessionBirth(stateRoot, newSessionBirth(stateRoot, "society", canonicalProjectPath));

  // DR24: the owner makes the society's configuration from the project's
  // settings, so a setting saved in any session holds in this one; what is the
  // society's own -- its name, rootfs and the installation it runs from
  // (CFG-001's pin, re-pinned when this installation was rebuilt) -- is its own.
  const libdir = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
  const projectPath = projectSettingsPath(dataRoot, project);
  const packageStore = packageStoreDir(stateRoot);
  const own = (): SessionOwn => ({ society, node: process.execPath, libdir: `${libdir}/`, rootfs: residentRootfsPath(stateRoot),
    deploymentDigest: deploymentDigest(libdir), packages: packageStore });
  /** DR25: the extensions a project names whose files are gone, left out of this session. */
  let leftOut: readonly string[] = [];
  let projectSeen = "";
  /** The project's settings as this society's configuration was last made
   * from: what the screen shows, and what an edit is committed against. */
  let projectSettings: Settings | null = null;
  const deriveSettings = (): Settings => {
    // The project's settings begin as its first society's, or this one's, or the product's defaults.
    projectSettings = ensureProjectSettings(dataRoot, project, libdir, configPath);
    const derived = deriveSessionSettings(projectSettings, configPath, own());
    leftOut = derived.missing;
    projectSeen = projectVersion();
    return derived.settings;
  };
  const projectVersion = (): string => {
    try { const stat = statSync(projectPath); return `${stat.mtimeMs}/${stat.size}`; } catch { return ""; }
  };
  let settings: Settings;
  try { settings = tenure === null ? readSettings(configPath) : deriveSettings(); }
  catch (error) {
    // A process that does not own the society writes nothing into it, so it
    // does not create the configuration it is missing either.
    if (tenure === null && !existsSync(configPath))
      fail("Another oma process owns this society and its configuration is not ready. Try again shortly.", exitFor("BROKER_UNAVAILABLE"));
    fail(`Cannot read settings: ${errorWords(error)}`, codeFor(error));
  }
  if (settings.config.society !== society)
    fail("Configured society differs from the requested society", exitFor("INVALID_REQUEST"));

  // REC-007: the society's tree is made to exist before anything can act on
  // it. P0V-58, DR16: it is made right -- the rootfs repair -- by the broker,
  // right after its startup quiescence proved every earlier Resident ended and
  // before it can wake one. Repairing here, before the broker, ran while a
  // Resident an earlier broker failed to stop could still be running, or
  // restarting and building its sandbox, on the entries being rewritten.
  let provisioned: ProvisionReport | null = null;
  if (tenure !== null) {
    try { provisioned = provisionSociety(stateRoot, { projectDir: process.cwd() }); }
    catch (error) { fail(`Could not prepare the society: ${errorWords(error)}`, codeFor(error)); }
    // D02/WP13: configuration generations no reader can still use are
    // collected only here -- this process owns the society, no broker is
    // listening and nothing it will start has read the configuration yet. The
    // current and the previously committed generation are kept. A failed
    // collection only leaves history behind, which a later edit reports.
    if (settings.snapshot !== null) {
      try { collectManagedGenerations(settings.snapshot); } catch { /* history kept; the edit budget says so */ }
    }
    // DR25: the project's settings keep their history the same way; a session
    // reading one reads the current or the previous generation, which stay.
    const projectSnapshot = (projectSettings as Settings | null)?.snapshot;
    if (projectSnapshot) {
      try { collectManagedGenerations(projectSnapshot); } catch { /* history kept; the edit budget says so */ }
    }
  }

  const mailbox = principalMailbox(stateRoot);
  const transport = new TuiTransport(stateRoot, society, settings.config.limits.frameBytes);
  let observation: Observation = { kind: "unknown", reason: "Not yet observed", observedAtMs: Date.now() };
  /** DR24/DR25: extensions are chosen in the project's settings, which every
   * session of the project is made from, among the installation's files and
   * the installed packages; a process that does not own this society shows
   * the society's own. */
  const extensionsOf = (): ReturnType<typeof readExtensions> =>
    readExtensions(projectSettings?.snapshot ?? settings.snapshot ?? configPath, settings.config.principalProfile, settings.workerProfile,
      readPackageIndex(packageStore));
  let extensionContext = extensionsOf();

  const reload = (): void => {
    settings = readSettings(configPath);
    if (tenure !== null) projectSettings = readSettingsForEditing(projectPath);
    extensionContext = extensionsOf();
  };

  const terminal: PanelTerminal = new PanelTerminal({ input: process.stdin, output: process.stdout }, () => app.snapshot.open);
  // Until the broker exists, this is all a failure has to undo.
  abandon = () => { tenure?.abandon(); terminal.restore(); };
  let session: PrincipalSession | null = null;
  /** WP15.05: the model profile the running session was started with. */
  let sessionModel: string | null = null;
  /** WP15.03: why the configuration could not be read back after a save. */
  let settingsUnread: string | null = null;
  /** WP15.03, P0: the screen shows the configuration as last read. After any
   * attempt to write it -- committed, refused or unconfirmed -- it is read
   * again, so a refusal because the file changed since it was read shows what
   * the file now holds instead of the snapshot the edit was made from, and the
   * next edit is made from it. A read-back that fails is an unknown. */
  const readBack = (): boolean => {
    try { reload(); settingsUnread = null; return true; }
    catch (error) { settingsUnread = errorWords(error); return false; }
  };

  /** Every write this product performs on behalf of the Human passes here.
   *
   * A process without the tenure is a Control Panel over a society another
   * `oma` owns: it may read that society's configuration and mail, and it may
   * not change them. That was stated in the architecture and enforced only at
   * startup, so the panels themselves still called the real write paths -- two
   * `oma` processes could edit one running society's policy files at the same
   * time. The check belongs at the write, which is the only place that knows a
   * write is about to happen. */
  const owning = (what: string): HostTenure => {
    if (tenure === null) throw new StoreError("BROKER_UNAVAILABLE", `Cannot change ${what}: another oma process owns this society`);
    tenure.assertOwned(what);
    return tenure;
  };

  /** What the engine says it runs: its model and effort, reported by its screen. */
  let engineState: { model: string | null; thinking: string | null } = { model: null, thinking: null };
  const engineText = (): string | null => engineState.model === null ? null
    : `${engineState.model}${engineState.thinking === null ? "" : ` · ${engineState.thinking}`}`;
  const principalFollowsEngine = (): boolean =>
    followsEngine(settings.config.modelProfiles[settings.config.agentProfiles[settings.config.principalProfile]?.modelProfile ?? ""]);
  /** DR24: the Principal's and a Worker's model are one row each -- the model
   * and its effort -- and Enter chooses both in one go from the engine's own
   * lists, which need the conversation's screen. The Principal's row is the
   * engine's own choice when its profile leaves the model to the engine;
   * otherwise it stays the profile's. */
  const modelRows = (fields: readonly ConfigField[]): readonly ConfigField[] => {
    if (tenure === null) return fields;
    const unavailable = session === null || !screenReady ? "Available while the conversation is open" : null;
    return fields.map(field => {
      if (field.id === PRINCIPAL_MODEL && principalFollowsEngine())
        return Object.freeze({ kind: "link" as const, id: field.id, label: field.label, value: engineText() ?? "unknown", blocked: unavailable });
      if (field.id === WORKER_MODEL)
        return Object.freeze({ kind: "link" as const, id: field.id, label: field.label, blocked: field.blocked ?? unavailable,
          value: workerModelText(settings.config, settings.workerProfile) });
      return field;
    });
  };
  /** DR24/DR25: this session made again from the project's settings. A
   * session that cannot take them on now -- its configuration history is
   * full, say -- keeps what it runs with and says so once; the project keeps
   * the change, and the next start takes it on. */
  let cannotFollow = "";
  const rederive = (): boolean => {
    try { settings = deriveSettings(); cannotFollow = ""; return true; }
    catch (error) {
      const words = `Saved for the project; this session takes it on from its next start (${errorWords(error)}).`;
      if (words !== cannotFollow) notice(words);
      cannotFollow = words;
      return false;
    }
  };
  /** DR24: saved to the project's settings, then made this society's, so it
   * holds in every session of the project, this one's next one included.
   * WP15.03: committed against the settings the screen was made from; a file
   * changed since is refused, and the screen then shows what it holds. */
  const saveField = (field: string, value: FieldValue): ReturnType<AppPorts["setField"]> => {
    owning("settings");
    let committed: ReturnType<typeof commitField>;
    try { committed = commitField(projectSettings ?? readSettings(projectPath), field, value, bootstrapStateOf(observation)); }
    catch (error) { rederive(); readBack(); throw error; }
    rederive();
    // WP15.03: a failed read-back does not undo the commit, and the old
    // values are not shown as current meanwhile.
    if (!readBack()) return { kind: "saved-unread" as const, reason: settingsUnread! };
    return committed;
  };
  const ports: AppPorts = {
    // WP15: fields are judged against the latest observation of the society,
    // and against nothing while the configuration could not be read back.
    configFields: () => {
      const fields = settingsUnread === null ? fieldsOf(settings.config, settings.workerProfile, bootstrapStateOf(observation))
        : fieldsOf(settings.config, settings.workerProfile).map(field => field.kind === "link" ? field
          : Object.freeze({ kind: "choice" as const, id: field.id, label: field.label, value: "?", options: Object.freeze([]),
            apply: field.apply, blocked: `Could not read settings back: ${settingsUnread}` }));
      return settingsUnread === null ? modelRows(fields) : fields;
    },
    dashboard: () => dashboardData({
      config: settings.config,
      principalModel: {
        configured: settingsUnread === null ? settings.config.agentProfiles[settings.config.principalProfile]?.modelProfile ?? "unknown" : "unknown",
        session: session === null ? null : sessionModel,
        ...(engineText() === null ? {} : { engine: engineText()! }),
        engineManaged: settingsUnread === null && principalFollowsEngine(),
      },
      ...(settingsUnread === null ? { workerModel: workerModelText(settings.config, settings.workerProfile) } : {}),
      unread: unreadCount(mailbox),
      observation,
    }),
    mail: () => readMailbox(mailbox),
    extensions: (): readonly ExtensionRow[] => extensionContext.rows,
    // P0V-42: a stored message is read within the most one of this society's
    // messages can take, and a longer one is shown as partial.
    body: (path: string) => (path.length === 0 ? null : readBody(path, storedMailBytes(settings.config.limits.mailBodyBytes))),
    setField: (field, value) => saveField(field, value),
    setExtension: (id, role, enabled) => {
      owning("extensions");
      // DR24/DR25: saved to the project's settings, then made this society's,
      // so it holds in every session of the project and in the next. A toggle
      // that was committed is not reported as unsaved because the read-back
      // failed (P0-5); the fields then say the read-back failed.
      try { toggleExtension(extensionContext, id, role, enabled); }
      finally { rederive(); readBack(); }
    },
    submitPrompt: (text: string): PromptOutcome => {
      if (session === null) {
        if (text.trim() !== "/restart") return { kind: "refused", reason: "No Pi session is available. Enter /restart to reopen the conversation." };
        startSessionOnce();
        if (session === null) return { kind: "refused", reason: "The conversation could not start; see the startup notice." };
        void register().then(deliver);
        return { kind: "accepted" };
      }
      return session.submit(text);
    },
    engineCommand: command => { session?.sendUi({ type: "engine_command", command }); },
    quit: () => { void shutdown(0); },
  };

  const app = new TuiApp(ports, terminal, settings.config.limits.frameBytes);
  let poll: ReturnType<typeof setInterval> | undefined;
  const closeApp = (): void => {
    if (poll !== undefined) clearInterval(poll);
    poll = undefined;
    app.close();
  };
  abandon = () => { closeApp(); tenure?.abandon(); terminal.restore(); };
  /** Said before the engine's screen exists; shown there once it is ready,
   * since the engine's screen replaces whatever was drawn before it. */
  const early: string[] = [];
  let screenReady = false;
  const notice = (text: string): void => {
    app.line(text);
    if (session !== null && screenReady) session.sendUi({ type: "notice", text });
    else if (early.push(text) > 16) early.shift();
  };
  /** DR25: said once per derivation that left an extension out. */
  let saidLeftOut = "";
  const sayLeftOut = (): void => {
    const words = leftOut.length === 0 ? "" : `Not loaded, its file is gone: ${leftOut.join(", ")}. ` +
      "Turn it off in Ctrl+X > Config > Extensions, or install its package again with oma pi install.";
    if (words !== saidLeftOut && words.length > 0) notice(words);
    saidLeftOut = words;
  };
  sayLeftOut();
  app.refresh();

  let broker: BrokerHandle | null = null;
  // DR18: the Principal's provider path in the macOS guest, opened below.
  let principalEgress: PrincipalEgress | null = null;
  let finished = false;
  const hostHistories = HostHistoryChannel.open(settings.config.limits.receiptWaitSeconds);
  const shutdown = async (code: number): Promise<void> => {
    if (finished) return;
    finished = true;
    hostHistories?.close();
    closeApp();
    // The tenure closes the engine and waits for the operating system to say
    // it is gone before the lease is given up. Order alone was never enough:
    // `close()` on a child is a signal, and the next `oma` could start its own
    // engine while this one was still running.
    // The tenure's end also closes what it holds (the provider path).
    if (tenure !== null) await tenure.end();
    session = null;
    await broker?.stop();
    removeIfUnused();
    terminal.restore();
    process.exit(code);
  };

  /** A session this process started, in which nothing was said and no worker
   * was seeded, is not kept: every start is a new session, and an unused one
   * would otherwise leave a society behind each time. */
  const removeIfUnused = (): void => {
    if (!createdHere || settings.config.initialResidents.length > 0) return;
    let said: boolean;
    try { said = readdirSync(principalSessionDir(stateRoot)).some(name => name.endsWith(".jsonl")); } catch { said = true; }
    if (said) return;
    try { removeUnusedTree(stateRoot); removeUnusedTree(runRoot); } catch { /* left behind, not lost */ }
  };
  /** `/new` and `/resume`: this session ends, and this process starts again as
   * the chosen one -- a new session, or an earlier one whole. */
  let relaunchPending = false;
  const relaunch = async (resume: string | null): Promise<void> => {
    if (finished || relaunchPending) return;
    const outgoing = session;
    relaunchPending = true;
    try {
    let resumeCwd = canonicalProjectPath;
    let guestResume: string | undefined;
    const hostResume = resume !== null && isHostHistoryReference(resume);
    if (hostResume) {
      try {
        if (hostHistories === null) throw new StoreError("INVALID_REQUEST", "Host Personal histories require a Mac host screen");
        await hostHistories.inspect(resume);
        if (finished || session !== outgoing) return;
      } catch (error) { if (!finished && session === outgoing) outgoing?.sendUi({ type: "notice", text: errorWords(error) }); return; }
    } else if (resume !== null) {
      let birth;
      try {
        birth = await sessionBirthForHistory(dataRoot, resume, canonicalProjectPath);
        // Admission observes history, not authority to resurrect an ended host.
        if (finished || session !== outgoing) return;
        resumeCwd = realpathSync(birth.cwd);
        if (resumeCwd !== birth.cwd || !statSync(resumeCwd).isDirectory())
          throw new StoreError("INVALID_REQUEST", "Session cwd no longer identifies its saved directory");
        if (hostHistories !== null) {
          if (birth.mode !== "society") throw new StoreError("INVALID_REQUEST", "Personal histories must be observed on the host");
          const header = await inspectSessionHistory(resume, birth, principalWorkspace(join(dataRoot, birth.id)));
          guestResume = guestHistoryReference({ projectId: basename(birth.cwd), society: birth.id, file: basename(resume), sessionId: header.id });
          if (finished || session !== outgoing) return;
        }
      } catch (error) { if (!finished && session === outgoing) outgoing?.sendUi({ type: "notice", text: errorWords(error) }); return; }
      const target = birth.mode === "personal" ? null : birth.id;
      if (target !== null && target !== society) {
        let probe: ReturnType<typeof tryHoldSociety>;
        try { probe = tryHoldSociety(join(dataRoot, target)); } catch { probe = null; }
        if (probe === null) { session?.sendUi({ type: "notice", text: "That session is open in another oma window." }); return; }
        probe.release();
      }
    }
    finished = true;
    closeApp();
    if (tenure !== null) await tenure.end();
    // Quitting may return a bounded, fenced tenure. A replacement history
    // requires the outgoing engine's actual exit, even after that grace.
    await outgoing?.exited;
    session = null;
    await broker?.stop();
    removeIfUnused();
    terminal.restore();
    // A hidden-VM session returns a new birth to the Mac, only after its
    // actual engine and owned broker ended. No guest Personal or guest path.
    if (hostHistories !== null) {
      await hostHistories.finish(guestResume ?? resume); process.exit(0); return;
    }
    if (resume === null && requestHostNewSession()) { process.exit(0); return; }
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env[RESUME_SESSION_ENV];
    if (resume !== null) env[RESUME_SESSION_ENV] = resume;
    // This Node has execve (24+): the new session is this process, its
    // terminal and its place in the shell unchanged.
    if (process.execve === undefined) fail("This Node cannot restart oma in place; start oma again.", exitFor("UNSUPPORTED_PROFILE"));
    process.chdir(resumeCwd);
    process.execve(process.execPath, [process.execPath, ...process.execArgv, join(libdir, DEPLOYMENT_LAYOUT.entries.tui)], env);
    } finally { relaunchPending = false; }
  };

  // A crash still stops the broker this process started, and still ends the
  // engine. It cannot wait for the engine to die -- the next statement is the
  // exit -- and it does not have to: the engine holds the lease's descriptor,
  // so the society stays this dying process's until the engine is really gone.
  abandon = () => {
    finished = true;
    hostHistories?.close();
    closeApp();
    tenure?.abandon();
    broker?.stop();
    terminal.restore();
  };
  process.on("uncaughtException", error => {
    abandon?.();
    humanStream().write(`oma: ${errorWords(error)}\n`);
    process.exit(codeFor(error));
  });
  // AV31, P0V-81: every way this process is asked to end takes the same path --
  // the engine reaped, the lease given back, the terminal restored. A default
  // SIGHUP or SIGQUIT ended it with none of them.
  for (const signal of HOST_LOSS_SIGNALS) process.on(signal, () => { void shutdown(0); });
  terminal.onResize(() => app.draw());
  terminal.whenUnclaimed(() => app.draw());
  terminal.onKeys(chunk => app.feed(chunk));

  // One command starts the society. A broker another `oma` already owns is left
  // alone and gives this process no Principal authority; a broker this process
  // started is supervised: restarted if it ends unexpectedly, and stopped when
  // this process exits -- or, if this process is killed, by itself when the
  // supervision channel closes. It inherits the lease so that a broker still
  // able to write to the society keeps the society from changing hands.
  broker = tenure === null ? null : await superviseBroker({
    node: process.execPath, libdir: settings.config.installation.libdir,
    society, stateRoot, runRoot, configPath, fence: tenure.fence,
    // A broker that started as expected, and the repairs its start makes, are
    // not news on the screen; what went wrong is.
    onEvent: line => { if (!/^(broker (ready|listening)\b|Restored rootfs entry\b)/.test(line)) notice(`broker: ${line}`); app.draw(); },
  });
  // OMA runs the engine it shipped with; it never resolves Pi from PATH, and it
  // gives that engine its own agent directory so a Pi the user installed keeps
  // its configuration, extensions and sessions to itself. It starts without
  // authority: the credential reaches it later, on a private socket.
  // DR18 (D-4 with D-10): in the macOS guest the Principal's engine reaches its
  // provider through the guest's egress, as a Resident's does -- one
  // placeholder and forwarder for this process, kept across engine restarts.
  // On Linux the environment names no egress socket and this is null.
  // P0V-114 (G04-01): it is the tenure's -- opened only by the owner, closed as
  // the tenure ends however it ends, and closed at once if the tenure ended
  // while it was opening.
  const egressOwner = tenure;
  if (egressOwner !== null) try {
    const egressProfile = principalSessionProfile(configPath, society);
    const opened = await openPrincipalEgress({ society, runRoot, provider: egressProfile.provider, model: egressProfile.model, inferenceSeconds: egressProfile.inferenceSeconds,
      modelProfile: settings.config.agentProfiles[settings.config.principalProfile]?.modelProfile ?? settings.config.principalProfile,
      frameBytes: settings.config.limits.frameBytes, deadlineMs: settings.config.limits.receiptWaitSeconds * 1000, env: process.env });
    if (opened !== null && await egressOwner.hold(opened)) principalEgress = opened;
  } catch (error) {
    notice(`⚠ Could not open the provider connection: ${errorWords(error)}`);
  }
  // The session environment is principalEnvironment's own value, with the
  // provider path added only where there is one.
  const withEgress = (environment: Record<string, string>): Record<string, string> =>
    principalEgress === null ? environment : { ...environment, ...principalEgress.env };
  const startEngine = (owner: HostTenure): PrincipalSession => {
    const piRuntime = resolvePiRuntime({
      stateRoot, libdir: settings.config.installation.libdir, override: process.env.OMA_PI_COMMAND,
    });
    if (piRuntime.source !== "bundled")
      throw new StoreError("UNSUPPORTED_PROFILE", "The interactive UI requires the bundled engine. OMA_PI_COMMAND overrides are not supported here.");
    ensureDirectory(piRuntime.agentDir, 0o700);
    // PR-003/PR-004/FS-003: the model's tools and its CLI's cache work in the
    // Principal's private scratch, which provisioning created, not in the
    // private space that holds the Human's session history.
    const workspace = principalWorkspace(stateRoot);
    const profile = principalSessionProfile(configPath, society);
    sessionModel = settings.config.agentProfiles[settings.config.principalProfile]?.modelProfile ?? null;
    terminal.handoff(event => session?.sendUi(event));
    const started = PrincipalSession.start(
      { piCommand: piRuntime.executable, piArgs: piRuntime.args, piAgentDir: piRuntime.agentDir,
        interactiveEntry: join(settings.config.installation.libdir, DEPLOYMENT_LAYOUT.entries.interactive), project: process.cwd(),
        coreExtension: join(settings.config.installation.libdir, DEPLOYMENT_LAYOUT.extension),
        sessionDir: principalSessionDir(stateRoot), ...(sessionFile === undefined ? {} : { sessionFile }),
        workspace, home: workspace,
        fence: owner.fence },
      profile,
      limitsOf(settings.config.limits),
      withEgress(principalEnvironment({ stateRoot, runRoot, libdir: settings.config.installation.libdir }, profile, settings.config.limits)),
      {
        onAcquire: engine => owner.adopt(engine),
        // WP09.03: every callback is this engine's; a late one from an engine
        // that is no longer the session cannot clear or re-mark its successor.
        onUi: event => {
          if (session !== started) return;
          if (event.type === "quit") { void shutdown(0); return; }
          if (event.type === "panel_open") {
            terminal.open(event); app.refresh();
            if (!app.snapshot.open) app.key({ kind: "panel" });
            else app.draw();
          } else if (event.type === "panel_size") { terminal.size(event); app.draw(); }
          else if (event.type === "panel_key" && typeof event.data === "string" && app.snapshot.open)
            app.feed(Buffer.from(event.data));
          else if (event.type === "sessions_request" && typeof event.id === "string") {
            const id = event.id;
            void (async () => {
              let error: string | undefined;
              try {
                await hostHistories?.pages(page => {
                  if (finished || session !== started) return;
                  let sessions: typeof page.sessions[number][] = [];
                  const publish = (): void => { if (sessions.length > 0) started.sendUi({ type: "host_history_page", id, page: { sessions, after: null } }); };
                  for (const info of page.sessions) {
                    const event = { type: "host_history_page", id, page: { sessions: [...sessions, info], after: null } };
                    if (Buffer.byteLength(JSON.stringify(event)) > settings.config.limits.frameBytes) { publish(); sessions = []; }
                    const single = { type: "host_history_page", id, page: { sessions: [info], after: null } };
                    if (Buffer.byteLength(JSON.stringify(single)) > settings.config.limits.frameBytes)
                      throw new StoreError("FRAME_TOO_LARGE", "Host history metadata exceeds the UI frame limit");
                    sessions.push(info);
                  }
                  publish();
                });
              } catch { error = "Host Personal histories could not be observed; attach a host terminal and try again"; }
              if (!finished && session === started) started.sendUi({ type: "session_dirs", id,
                dirs: sessionHistoryDirectories(dataRoot, canonicalProjectPath).map(entry => entry.dir),
                current: principalSessionDir(stateRoot),
                ...(error === undefined ? {} : { error }) });
            })().catch(error => { if (!finished && session === started) started.sendUi({ type: "session_dirs", id, dirs: [], error: errorWords(error) }); });
          }
          else if (event.type === "switch")
            void relaunch(typeof event.session === "string" ? event.session : null);
          else if (event.type === "engine_state") {
            engineState = { model: engineName(event.model), thinking: engineName(event.thinking) };
            app.refresh(); app.draw();
          }
          else if (event.type === "worker_model") {
            // DR24: a Worker's model and effort, chosen from the engine's
            // lists, is the Worker model field's value, saved as any is.
            const project = (projectSettings ?? settings).config;
            const value: FieldValue | null = event.same === true
              ? project.agentProfiles[project.principalProfile]?.modelProfile ?? null
              : engineModelChoiceOf(event);
            if (value !== null) {
              try {
                const saved = saveField(WORKER_MODEL, value);
                notice(saved.kind === "saved-unread" ? `Worker model saved; could not read settings back: ${saved.reason}`
                  : `Worker model: ${workerModelText(settings.config, settings.workerProfile)}${saved.kind === "unchanged" ? " (unchanged)" : " · saved; applies from the next activation"}`);
              } catch (error) { notice(`Could not save the worker model: ${errorWords(error)}`); }
              app.refresh(); app.draw();
            }
          }
          else if (event.type === "ready") {
            screenReady = true;
            // One notice: the engine's status line keeps only the latest.
            const said = early.splice(0);
            if (said.length > 0) started.sendUi({ type: "notice", text: said.join("\n") });
            deliver();
          }
        },
        // The engine's screen shows the run's errors itself; the lines are for
        // this process's own screen, should it have to show it.
        onLine: line => { if (session === started) app.line(line); },
        onBusy: busy => { if (session === started) app.setBusy(busy); },
        onEnd: reason => {
          if (session !== started) return;
          screenReady = false; delivery = null; owner.principalUnregistered();
          // Even a submit to an already-closed RPC session can call onEnd.
          // Only the OS end permits a successor or a reclaimed terminal.
          void started.exited.then(() => {
            if (session !== started) return;
            session = null; sessionModel = null; engineState = { model: null, thinking: null };
            app.setBusy(false);
            if (!finished) {
              terminal.reclaim(); notice(reason);
              if (!disowned) notice("Enter /restart to reopen the conversation. Earlier input is not resent automatically.");
              app.refresh(); app.draw();
            }
          });
        },
        onPromptFailed: (text, reason) => {
          if (session !== started) return;
          app.returnPrompt(text, reason); started.sendUi({ type: "return_prompt", text, reason });
        },
        onPromptUnconfirmed: (_text, reason) => {
          if (session === started) notice(`⚠ Could not confirm whether the engine accepted the input (not resent automatically): ${reason}`);
        },
      },
    );
    // Every start seeds a new session from the project's committed HEAD, so
    // that is not news; a history the Residents cannot be shown is.
    // DR18 (D-8): the Residents see the project's committed history as of this start.
    if (provisioned?.mirrorNote) notice(`Could not refresh the project commit history for Residents: ${provisioned.mirrorNote}`);
    return started;
  };
  // PR-001/LIFE-006: each time a broker of this process's becomes ready -- at
  // start, and again after it is restarted -- the engine is named to it and
  // receives the credential it mints. A restarted broker's credential replaces
  // the old one in the engine, so the Principal reconnects without the Human
  // doing anything.
  //
  // The registration is not a formality that precedes delivery in program
  // order; it is what makes delivery permissible at all, so its outcome is
  // recorded on the tenure and delivery asks the tenure. A refusal used to
  // print a line and resolve, and the delivery chained after it ran anyway.
  let sessionHandle = newSessionHandle();
  const register = async (): Promise<void> => {
    const live = session, owner = tenure, handle = sessionHandle;
    const pid = live?.pid ?? null;
    if (pid === null || live === null || broker === null || owner === null) return;
    const generation = owner.brokerGeneration;
    const credential = await broker.register(handle, pid);
    // A reply belongs to this engine as well as this broker. A late reply
    // from an ended engine cannot grant or revoke its successor's authority.
    if (tenure !== owner || !owner.held || session !== live || !live.running ||
        sessionHandle !== handle || owner.brokerGeneration !== generation) return;
    if (credential === null) {
      owner.principalUnregistered();
      notice("The broker rejected the Principal session. Requests cannot be sent.");
      app.draw();
      return;
    }
    live.grant(credential, handle);
    owner.principalRegistered();
  };

  // PR-002: pending mail reaches the Principal while this product runs, one
  // bounded batch at a time, whenever the session is idle. Built with the
  // engine, because there is nothing to deliver into before one exists.
  let delivery: PrincipalDelivery | null = null;
  /** Said once and never taken back, exactly as the supervisor says it. */
  let disowned = false;
  const deliver = (): void => {
    if (delivery === null || tenure === null || !tenure.deliverable) return;
    const current = delivery;
    void current.tick().then(outcome => {
      if (delivery !== current) return;
      if (outcome.kind === "delivered") { notice(`[Mail] Delivered ${outcome.messages} messages to the Principal session.`); app.refresh(); app.draw(); }
      // WP08.05: completing an already-presented batch is not a new delivery.
      else if (outcome.kind === "settled") { app.refresh(); app.draw(); }
      else if (outcome.kind === "failed") { notice(`[Mail] Could not complete delivery (${outcome.phase}):${surfaceWords(outcome.reason, "See the log for details")}`); app.draw(); }
    }, (error: unknown) => {
      if (delivery !== current) return;
      notice(`[Mail] Delivery error: ${errorWords(error)}`);
      app.draw();
    });
  };

  // One engine per society, and this is the only place one is started.
  //
  // A spawned broker is not an owned society. The supervisor probes, spawns and
  // hands back a pid, and between that probe and the lock the child takes,
  // another `oma` can take the society; the loser's broker exits and the
  // product that started it would have had a second engine on one society, a
  // second writer of the same private workspace and session history. So the
  // engine waits for the one fact that settles ownership: a broker of this
  // process's saying it is ready, which it says only after it holds the society
  // lock. Nothing branches on `broker.state` to decide this -- a state that is
  // merely "not already-running" has never been proof of anything.
  const startSessionOnce = (): void => {
    if (session !== null || finished || disowned || tenure === null || !tenure.canStartEngine) return;
    const owner = tenure;
    let live: PrincipalSession;
    try { live = startEngine(owner); }
    catch (error) {
      // A setup failure may still own a live child. Neither a kill request nor
      // the thrown constructor gives its terminal or engine slot back.
      void owner.engineExited.then(() => {
        if (finished || disowned || tenure !== owner || session !== null) return;
        terminal.reclaim();
        notice(`Could not start the Pi session: ${errorWords(error)}`);
        notice("Enter /restart to try again. Dashboard, Config, and Mail remain available through Ctrl+X.");
        app.draw();
      });
      return;
    }
    session = live;
    sessionHandle = newSessionHandle();
    delivery = new PrincipalDelivery({
      get running() { return live.running; },
      get busy() { return live.busy; },
      onEvent: (listener: (event: PiEvent) => void) => live.onEvent(listener),
      deliver: (batchId: string) => live.deliver(batchId),
    }, principalHostBroker(runRoot, settings.config.limits), {
      stateRoot, frameBytes: settings.config.limits.frameBytes,
      acceptMs: settings.config.limits.receiptWaitSeconds * 1000, retryAfterMs: 60_000,
    });
    live.onEvent(event => { if (session === live && event.type === "agent_settled") deliver(); });
  };

  // A society this process will not own, or has stopped owning: another `oma`
  // holds it, or no broker of this process's could be kept running.
  //
  // This is a teardown, not a message. Everything that existed because this
  // process owned the society ends here, and the lease is given up only once
  // the engine is actually gone -- the instant the society is free another
  // `oma` may take it and start its own engine, and two engines on one society
  // are two writers of one private workspace and one session history. Leaving
  // "the session the Human was using" alive across that boundary is the same
  // invariant violation as starting a second engine; it just takes longer to
  // notice.
  const disown = async (reason: string): Promise<void> => {
    if (disowned) return;
    disowned = true;
    delivery = null;
    const had = session !== null;
    if (tenure !== null) await tenure.end();
    tenure = null;
    session = null;
    // No engine will take the terminal: this process's own screen is the product now.
    terminal.reclaim();
    notice(`This process does not own this society's broker: ${reason}.`);
    notice(had
      ? "Ownership lost; the Pi session was closed. Dashboard, Config, and Mail remain available through Ctrl+X."
      : "Cannot open an authorized conversation session. Dashboard, Config, and Mail remain available through Ctrl+X.");
    app.draw();
  };

  if (broker === null) {
    // No tenure, so no broker was ever started and nothing was written. The
    // product is a Control Panel over state another `oma` owns.
    await disown(ownershipRefusal);
  } else {
    broker.onReady(() => {
      if (disowned || tenure === null) return;
      tenure.brokerReady();
      startSessionOnce();
      void register().then(deliver);
    });
    broker.onLost(() => { tenure?.brokerLost(); });
    broker.onDisowned(reason => { void disown(reason); });
  }

  if (finished) return;
  poll = setInterval(() => {
    if (finished) return;
    void transport.status().then(next => {
      if (finished) return;
      observation = next; app.refresh(); app.draw();
    });
    deliver();
    // DR24: a setting saved in another session of this project is made this
    // society's too; this process writes only its own society's configuration.
    if (tenure !== null && !finished && projectVersion() !== projectSeen) {
      if (rederive()) { readBack(); sayLeftOut(); app.refresh(); app.draw(); }
    }
  }, 5000);
  poll.unref();
  const initialObservation = await transport.status();
  if (finished) return;
  observation = initialObservation;
  app.refresh();
  app.draw();
}

main(process.argv.slice(2)).catch((error: unknown) => {
  // WP28: a failure after the terminal opened leaves it the way a crash does --
  // restored, broker stopped, engine ended -- and the reason is written after
  // the alternate screen is gone, where the Human can still read it.
  abandon?.();
  humanStream().write(`oma: ${errorWords(error)}\n`);
  process.exit(codeFor(error));
});
