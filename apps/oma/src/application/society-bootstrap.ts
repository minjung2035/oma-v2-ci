/** Application admission: choose one session, acquire its tenure, then verify binding. */
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { isValidSocietyName } from "@oma/domain/identifiers";
import { assertHostDirectoryLayout } from "@oma/native/directory-layout";
import { hostLaunchLocation } from "../runtime/assets.js";
import { defaultSocietyFor, sessionSocietyName } from "@oma/config/defaults";
import { sha256Hex } from "@oma/domain/canonical-json";
import { observeProjectBinding, projectBindingDecision, publishProjectBinding, stateRootHasSociety, provisionSociety, type ProvisionReport } from "../runtime/provision.js";
import { brokerListening } from "../runtime/broker-supervisor.js";
import { HostTenure } from "../runtime/host-tenure.js";
import { RESUME_SESSION_ENV } from "@oma/protocol/session-handoff";
import { sessionBirthForHistory } from "../runtime/session-catalog.js";
import { newSessionBirth, publishSessionBirth } from "../runtime/session-mode.js";
import { deploymentDigest } from "../runtime/deployment-manifest.js";
import { packageStoreDir } from "../runtime/packages/index.js";
import { collectManagedGenerations } from "@oma/config/generations";
import { recoverExecutionState } from "../runtime/execution-runtime.js";
import { ProjectSessionSettings } from "./project-session-settings.js";
import type { SessionOwn } from "./settings.js";
import { codeFor, exitFor } from "./exit.js";
import { exceptionText } from "@oma/domain/errors";
type Fail = (message: string, code: ReturnType<typeof codeFor>) => never;

/** Observe cwd once; login, package commands and sessions share this project identity. */
export function identifyProject(fail: Fail) {
  let canonicalProjectPath: string;
  try { canonicalProjectPath = realpathSync(process.cwd()); }
  catch (error) { fail(`Cannot verify the project directory: ${exceptionText(error)}`, codeFor(error)); }
  const project = defaultSocietyFor(canonicalProjectPath, sha256Hex(canonicalProjectPath));
  if (!isValidSocietyName(project)) fail("Invalid project name", exitFor("INVALID_REQUEST"));
  const dataRoot = dirname(hostLaunchLocation(project, process.env).stateRoot);
  return { canonicalProjectPath, project, dataRoot };
}

export async function bootstrapSociety(options: {
  readonly requestedSociety: string | undefined;
  readonly externalConfigPath: string | undefined;
  readonly bindRequested: boolean;
  readonly resume: string | undefined;
  readonly dataRoot: string;
  readonly project: string;
  readonly canonicalProjectPath: string;
  readonly acquired: (abandon: () => void) => void;
  readonly fail: Fail;
}) {
  const { dataRoot, project, canonicalProjectPath, acquired, bindRequested } = options;
  const fail: Fail = options.fail;
  const explicitSociety = options.requestedSociety;
  const configArgument = options.externalConfigPath;
  const resumeFile = options.resume ?? process.env[RESUME_SESSION_ENV];
  delete process.env[RESUME_SESSION_ENV];
  const resumedBirth = resumeFile === undefined ? null : await sessionBirthForHistory(dataRoot, resumeFile, canonicalProjectPath);
  if (resumedBirth !== null && resumedBirth.mode !== "society")
    fail("Personal cannot resume through the Society entry", exitFor("INVALID_REQUEST"));
  const resumedSociety = resumedBirth?.id ?? null;
  let society: string = explicitSociety ?? resumedSociety ?? sessionSocietyName(project, Date.now());
  for (let stamp = Date.now() + 1; explicitSociety === undefined && resumedSociety === null && stateRootHasSociety(join(dataRoot, society)); stamp += 1)
    society = sessionSocietyName(project, stamp);
  if (!isValidSocietyName(society))
    fail("Invalid society name", exitFor("INVALID_REQUEST"));
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
  try {
    assertHostDirectoryLayout(runRoot, true);
  }
  catch (error) {
    fail(`The society run directory cannot be trusted: ${exceptionText(error)}`, codeFor(error));
  }
  let tenure: HostTenure | null;
  try {
    tenure = HostTenure.take(stateRoot);
  }
  catch (error) {
    fail(`Could not verify society ownership: ${exceptionText(error)}`, codeFor(error));
  }
  acquired(() => { tenure?.abandon(); });
  // A broker that is already listening owns the writing of this society, no
  // matter who started it -- an operator by hand, or an `oma`
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
    if (tenure !== null) {
      await tenure.end();
      tenure = null;
    }
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
    const decision = projectBindingDecision({ observation, society, canonicalProjectPath, hasSociety,
      bindRequested: bindRequested && tenure !== null });
    if (decision.kind === "refuse" || (decision.kind === "publish" && tenure === null && hasSociety)) {
      if (tenure !== null)
        await tenure.end();
      fail(decision.kind === "refuse" ? `Cannot open this society from this project: ${decision.reason}` :
        "This society has no project binding and is owned by another oma process", exitFor(decision.kind === "refuse" ? decision.code : "BROKER_UNAVAILABLE"));
    }
    if (tenure !== null) {
      try { await recoverExecutionState(stateRoot, createdHere); }
      catch (error) { await tenure.end(); fail(`Cannot recover native execution state: ${exceptionText(error)}`, codeFor(error)); }
    }
    if (decision.kind === "publish" && tenure !== null) {
      try {
        publishProjectBinding(stateRoot, { society, canonicalProjectPath });
      }
      catch (error) {
        await tenure.end();
        fail(`Could not record the society's project binding: ${exceptionText(error)}`, codeFor(error));
      }
    }
  }
  if (tenure !== null)
    publishSessionBirth(stateRoot, newSessionBirth(stateRoot, "society", canonicalProjectPath));
  return { dataRoot, project, canonicalProjectPath, society, stateRoot, runRoot, configPath,
    configArgument, sessionFile, tenure, createdHere, ownershipRefusal };
}
export type SocietyBootstrap = Awaited<ReturnType<typeof bootstrapSociety>>;
/** Settings and conversation tree are prepared only after identity admission.
* Resident rootfs repair remains the broker's post-quiescence responsibility. */
export function prepareSociety(bootstrap: SocietyBootstrap, libdir: string, effects: {
  readonly owns: () => boolean;
  readonly assertWritable: (what: string) => void;
  readonly notice: (text: string) => void;
  readonly fail: Fail;
}) {
  const { dataRoot, project, society, stateRoot, configPath, configArgument, tenure } = bootstrap;
  const fail: Fail = effects.fail;
  const packageStore = packageStoreDir(stateRoot);
  const own = (digest = deploymentDigest(libdir)): SessionOwn => ({ society, node: process.execPath,
    libdir: `${libdir}/`,  deploymentDigest: digest, packages: packageStore });
  let configuration: ProjectSessionSettings;
  try {
    configuration = new ProjectSessionSettings({ dataRoot, project, libdir, configPath, packageStore,
      externalConfig: configArgument !== undefined, own, owns: effects.owns,
      assertWritable: effects.assertWritable, notice: effects.notice });
  }
  catch (error) {
    if (tenure === null && !existsSync(configPath))
      fail("Another oma process owns this society and its configuration is not ready. Try again shortly.", exitFor("BROKER_UNAVAILABLE"));
    fail(`Cannot read settings: ${exceptionText(error)}`, codeFor(error));
  }
  if (configuration.settings.config.society !== society)
    fail("Configured society differs from the requested society", exitFor("INVALID_REQUEST"));
  // REC-007: the society's tree is made to exist before anything can act on
  // it. P0V-58, DR16: it is made right -- the rootfs repair -- by the broker,
  // right after its startup quiescence proved every earlier Resident ended and
  // before it can wake one. Repairing here, before the broker, ran while a
  // Resident an earlier broker failed to stop could still be running, or
  // restarting and building its sandbox, on the entries being rewritten.
  let provisioned: ProvisionReport | null = null;
  if (tenure !== null) {
    try {
      provisioned = provisionSociety(stateRoot, { conversationOnly: true });
    }
    catch (error) {
      fail(`Could not prepare the society: ${exceptionText(error)}`, codeFor(error));
    }
    // D02/WP13: configuration generations no reader can still use are
    // collected only here -- this process owns the society, no broker is
    // listening and nothing it will start has read the configuration yet. The
    // current and the previously committed generation are kept. A failed
    // collection only leaves history behind, which a later edit reports.
    if (configuration.settings.snapshot !== null) {
      try {
        collectManagedGenerations(configuration.settings.snapshot);
      }
      catch { /* history kept; the edit budget says so */ }
    }
    // DR25: the project's settings keep their history the same way; a session
    // reading one reads the current or the previous generation, which stay.
    const projectSnapshot = configuration.projectSettings?.snapshot;
    if (projectSnapshot) {
      try {
        collectManagedGenerations(projectSnapshot);
      }
      catch { /* history kept; the edit budget says so */ }
    }
  }
  return { configuration, provisioned };
}
export type PreparedSociety = ReturnType<typeof prepareSociety>;
