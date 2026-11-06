import { exceptionText, StoreError } from "@oma/domain/errors";
import { engineStartEffects } from "../engine/start-effects.js";
/** Society execution coordination. HostTenure alone grants authority and holds the fence.
* Broker/Principal callbacks report observations; UI interaction receives narrow commands. */
import { join } from "node:path";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
import { collaborationSurface } from "@oma/domain/collaboration-surface";
import { resolvePiRuntime } from "@oma/engine/pi-runtime";
import { ensureOwnedDirectory } from "@oma/storage/directory";
import { PrincipalSession, newSessionHandle, principalEnvironment, principalSessionDir, principalWorkspace } from "@oma/engine/principal-session";
import { principalSessionProfile } from "../engine/principal-profile.js";
import { PrincipalDelivery, principalHostBroker } from "../runtime/principal-delivery.js";
import { HUMAN_CONTROL_HELP, humanControlCommand, callHumanControl, humanControlLines } from "../runtime/human-controls.js";
import type { PiEvent } from "@oma/engine/pi-rpc";
import { superviseBroker, type BrokerHandle } from "../runtime/broker-supervisor.js";
import type { HostTenure } from "../runtime/host-tenure.js";
import { limitsOf } from "./status-observation.js";
import type { PromptOutcome } from "@oma/domain/settings";
import type { SocietyBootstrap, PreparedSociety } from "./society-bootstrap.js";
import type { ConversationUi, SocietyConversationView } from "./society-conversation.js";
export type { SocietyConversationView } from "./society-conversation.js";
export class SocietyRuntime {
  private tenure: HostTenure | null;
  get owner(): HostTenure | null { return this.tenure; }
  private currentSession: PrincipalSession | null = null;
  private currentConversation: ConversationUi | null = null;
  get session(): ConversationUi | null { return this.currentConversation; }
  get sessionDirectory(): string { return principalSessionDir(this.bootstrap.stateRoot); }
  private finishing = false;
  get finished(): boolean { return this.finishing; }
  private disowned = false;
  private broker: BrokerHandle | null = null;
  private delivery: PrincipalDelivery | null = null;
  private currentHandle = newSessionHandle();
  private startupRefused = false;
  /** Transient UI destination, never a control command, intent or durable queue. */
  private controlHandoff: PrincipalSession | "local" | null = null;
  private sessionDeferredForControl = false;
  private consoleRetained(): boolean {
    if (this.view.mayHandOffConsole?.() !== false) return false;
    this.sessionDeferredForControl = true;
    return true;
  }
  /** A local ownership transition resumes only an already deferred startup. */
  consoleReleased(): void {
    if (!this.sessionDeferredForControl) return;
    this.sessionDeferredForControl = false;
    this.startSessionOnce();
  }
  constructor(private readonly bootstrap: SocietyBootstrap, private readonly prepared: PreparedSociety, private readonly view: SocietyConversationView) { this.tenure = bootstrap.tenure; }
  private get config() { return this.prepared.configuration.settings.config; }
  /** Darwin dials only the current Broker child this Host acquired; Linux keeps the default peer-credential channel. */
  private readonly hostChannel = () => {
    const broker = this.broker;
    if (broker?.createChannel) return broker.createChannel(this.config.limits);
    if (process.platform === "darwin") throw new StoreError("BROKER_UNAVAILABLE", "this Host has no acquired Broker channel source");
    return undefined;
  };
  async start(): Promise<void> {
    this.broker = this.tenure === null ? null : await superviseBroker({
      node: process.execPath, libdir: this.config.installation.libdir,
      society: this.bootstrap.society, stateRoot: this.bootstrap.stateRoot, runRoot: this.bootstrap.runRoot, configPath: this.bootstrap.configPath, fence: this.tenure.fence,
      projectDir: this.bootstrap.canonicalProjectPath,
      // A broker that started as expected, and the repairs its start makes, are
      // not news on the screen; what went wrong is.
      onEvent: line => { if (!/^(broker (ready|listening)\b|Restored rootfs entry\b)/.test(line))
        this.view.notice(`broker: ${line}`); this.view.draw(); },
    });
    // Startup may finish after shutdown claimed this runtime. Return the late
    // owned broker before registering an engine or acquiring display polling.
    if (this.finishing) { await this.broker?.stop(); return; }
    // OMA runs the engine it shipped with; it never resolves Pi from PATH, and it
    // gives that engine its own agent directory so a Pi the user installed keeps
    // its configuration, extensions and sessions to itself. It starts without
    // authority: the credential reaches it later, on a private socket.
    if (this.broker === null) {
      // No tenure, so no broker was ever started and nothing was written. The
      // product is a Control Panel over state another `oma` owns.
      await this.disown(this.bootstrap.ownershipRefusal);
    }
    else {
      this.broker.onReady(() => {
        if (this.disowned || this.tenure === null)
          return;
        this.tenure.brokerReady();
        if (!this.startSessionOnce()) void this.register().then(() => this.deliver());
      });
      this.broker.onLost(() => { this.tenure?.brokerLost(); });
      this.broker.onDisowned(reason => { void this.disown(reason); });
      // DR35: this current, lease-owned private engine carries no Society grant.
      // Broker record preparation still precedes every credential registration.
      this.startSessionOnce();
      if (this.broker.state.kind === "started") {
        this.view.notice("Preparing society repositories, Workers and permitted Principal records. The private conversation has no Society authority until broker readiness and registration.");
      }
    }
    this.view.notice("Human controls: enter /control to end the Principal conversation and return its terminal to this host, or use Ctrl+X then : when the host already owns stdin. Only the resulting private local editor accepts control commands. Workers and original pending requests are preserved; /restart explicitly reopens the conversation.");
  }
  private startEngine(owner: HostTenure): PrincipalSession {
    const piRuntime = resolvePiRuntime({
      stateRoot: this.bootstrap.stateRoot, libdir: this.config.installation.libdir, override: process.env.OMA_PI_COMMAND,
    });
    if (piRuntime.source !== "bundled")
      throw new StoreError("UNSUPPORTED_PROFILE", "The interactive UI requires the bundled engine. OMA_PI_COMMAND overrides are not supported here.");
    // The engine home is oma's own under the same data root as the store.
    ensureOwnedDirectory(piRuntime.agentDir, this.bootstrap.dataRoot, 0o700);
    // PR-003/PR-004/FS-003: the model's tools and its CLI's cache work in the
    // Principal's private scratch, which provisioning created, not in the
    // private space that holds the Human's session history.
    const workspace = principalWorkspace(this.bootstrap.stateRoot);
    const profile = principalSessionProfile(this.bootstrap.configPath, this.bootstrap.society);
    this.view.starting(this.config.agentProfiles[this.config.principalProfile]?.modelProfile ?? null);
    const started = PrincipalSession.start(engineStartEffects, { piCommand: piRuntime.executable, piArgs: piRuntime.args, piAgentDir: piRuntime.agentDir,
      interactiveEntry: join(this.config.installation.libdir, DEPLOYMENT_LAYOUT.entries.interactive), project: process.cwd(),
      coreExtension: join(this.config.installation.libdir, DEPLOYMENT_LAYOUT.extension),
      sessionDir: principalSessionDir(this.bootstrap.stateRoot), ...(this.bootstrap.sessionFile === undefined ? {} : { sessionFile: this.bootstrap.sessionFile }),
      workspace, home: workspace,
      // D23/TSP-005: the Principal's declared surface, same plan channel a
      // Resident's explicit launch environment feeds its runner -- produced by the
      // deployment, never authored configuration.
      toolSurface: JSON.stringify(collaborationSurface("principal")),
      collaborationStateRoot: this.bootstrap.stateRoot,
      fence: owner.fence }, profile, limitsOf(this.config.limits), principalEnvironment({ stateRoot: this.bootstrap.stateRoot, runRoot: this.bootstrap.runRoot, libdir: this.config.installation.libdir }, profile, this.config.limits), {
      errorWords: error => exceptionText(error),
      onAcquire: engine => owner.adopt(engine),
      onHumanInput: (text: string): PromptOutcome =>
        this.currentSession === started ? this.submit(text) : { kind: "refused", reason: "The original conversation no longer owns this input." },
      // WP09.03: every callback is this engine's; a late one from an engine
      // that is no longer the session cannot clear or re-mark its successor.
      onUi: event => { if (this.currentSession === started && this.currentConversation !== null)
        this.view.onUi(this.currentConversation, event); },
      // The engine's screen shows the run's errors itself; the lines are for
      // this process's own screen, should it have to show it.
      onLine: line => { if (this.currentSession === started)
        this.view.line(line); },
      onBusy: busy => { if (this.currentSession === started)
        this.view.busy(busy); },
      onEnd: reason => {
        if (this.currentSession !== started)
          return;
        this.view.ending();
        this.delivery = null;
        owner.principalUnregistered();
        // Even a submit to an already-closed RPC session can call onEnd.
        // Only the OS end permits a successor or a reclaimed terminal.
        void started.exited.then(() => {
          if (this.currentSession !== started)
            return;
          this.currentSession = null;
          this.currentConversation = null;
          this.view.ended(reason, this.finishing, this.disowned);
          if (this.controlHandoff === started) {
            this.controlHandoff = "local";
            if (!this.finishing && !this.disowned && this.tenure === owner && owner.held && this.view.openControlEditor?.() !== true)
              this.view.notice("The Principal engine ended, but the private Human editor could not open. No Worker control was requested. Use the local Control Panel; preserve original pending invocations.");
          }
        });
      },
      onPromptFailed: (text, reason) => {
        if (this.currentSession !== started)
          return;
        this.view.returnPrompt(text, reason);
        started.sendUi({ type: "return_prompt", text, reason });
      },
      onPromptUnconfirmed: (_text, reason) => {
        if (this.currentSession === started)
          this.view.notice(`⚠ Could not confirm whether the engine accepted the input (not resent automatically): ${reason}`);
      },
    });
    // Every start seeds a new session from the project's committed HEAD, so
    // that is not news; a history the Residents cannot be shown is.
    // DR18 (D-8): the Residents see the project's committed history as of this start.
    if (this.prepared.provisioned?.mirrorNote)
      this.view.notice(`Could not refresh the project commit history for Residents: ${this.prepared.provisioned.mirrorNote}`);
    // UX-09: a seeded or mirrored main carrying gitlinks is reported loudly on
    // every start — the society works for sessions, integration is what refuses.
    if (this.prepared.provisioned?.gitlinkNote)
      this.view.notice(this.prepared.provisioned.gitlinkNote);
    return started;
  }
  private async register(): Promise<void> {
    const live = this.currentSession, owner = this.tenure, handle = this.currentHandle, broker = this.broker;
    const pid = live?.pid ?? null;
    if (pid === null || live === null || broker === null || owner === null) return;
    const generation = owner.brokerGeneration;
    const current = (): boolean => !this.finishing && !this.disowned && this.tenure === owner && owner.held &&
      this.controlHandoff === null && owner.brokerAvailable && this.broker === broker && this.currentSession === live && live.running &&
      this.currentHandle === handle && owner.brokerGeneration === generation;
    if (!current()) return;
    try { await principalHostBroker(this.bootstrap.runRoot, this.config.limits, this.hostChannel).prepare(); }
    catch (error) {
      if (this.currentSession === live && this.tenure === owner) this.view.notice(`Principal records could not be refreshed; no new credential was granted: ${exceptionText(error)}`);
      return;
    }
    if (!current()) return;
    const credential = await broker.register(handle, pid);
    // A reply belongs to this engine as well as this broker. A late reply
    // from an ended engine cannot grant or revoke its successor's authority.
    if (!current()) return;
    if (credential === null) {
      owner.principalUnregistered();
      this.view.notice("The broker rejected the Principal session. Requests cannot be sent.");
      this.view.draw();
      return;
    }
    // Darwin: the engine's client accepts replies only from this Broker child.
    let brokerIdentity: ReturnType<NonNullable<BrokerHandle["identity"]>>;
    try { brokerIdentity = broker.identity?.(); }
    catch (error) {
      owner.principalUnregistered();
      this.view.notice(`The Broker identity could not be attested; no credential was granted: ${exceptionText(error)}`);
      this.view.draw();
      return;
    }
    if (process.platform === "darwin" && brokerIdentity === undefined) {
      owner.principalUnregistered();
      this.view.notice("This Host has no attested Broker identity; no credential was granted.");
      this.view.draw();
      return;
    }
    live.grant(credential, handle, brokerIdentity);
    owner.principalRegistered();
    if (this.delivery === null)
      this.delivery = new PrincipalDelivery({
        get running() { return live.running; },
        get busy() { return live.busy; },
        onEvent: (listener: (event: PiEvent) => void) => live.onEvent(listener),
        deliver: (batchId: string) => live.deliver(batchId),
      }, principalHostBroker(this.bootstrap.runRoot, this.config.limits, this.hostChannel), {
        stateRoot: this.bootstrap.stateRoot, frameBytes: this.config.limits.frameBytes,
        acceptMs: this.config.limits.receiptWaitSeconds * 1000, retryAfterMs: 60000,
      });
  }
  deliver(): void {
    if (this.delivery === null || this.tenure === null || !this.tenure.deliverable)
      return;
    const current = this.delivery;
    void current.tick().then(outcome => {
      if (this.delivery !== current)
        return;
      if (outcome.kind === "delivered") {
        this.view.notice(`[Mail] Delivered ${outcome.messages} messages to the Principal session.`);
        this.view.refresh();
        this.view.draw();
      }
      // WP08.05: completing an already-presented batch is not a new delivery.
      else if (outcome.kind === "settled") {
        this.view.refresh();
        this.view.draw();
      }
      else if (outcome.kind === "failed") {
        this.view.notice(`[Mail] Could not complete delivery (${outcome.phase}):${outcome.reason}`);
        this.view.draw();
      }
    }, (error: unknown) => {
      if (this.delivery !== current)
        return;
      this.view.notice(`[Mail] Delivery error: ${exceptionText(error)}`);
      this.view.draw();
    });
  }
  private startSessionOnce(): boolean {
    if (this.currentSession !== null || this.controlHandoff !== null || this.finishing || this.disowned || this.tenure === null ||
        !this.tenure.canPrepareEngine || this.startupRefused)
      return false;
    if (this.consoleRetained()) return false;
    this.startPreparedSession(this.tenure);
    if (this.currentSession === null) return false;
    void this.register().then(() => this.deliver());
    return true;
  }
  private startPreparedSession(owner: HostTenure): void {
    let live: PrincipalSession;
    try {
      live = this.startEngine(owner);
    }
    catch (error) {
      this.startupRefused = true; // Only an explicit restart may retry failed setup.
      // A setup failure may still own a live child. Neither a kill request nor
      // the thrown constructor gives its terminal or engine slot back.
      void owner.engineExited.then(() => {
        if (this.finishing || this.disowned || this.tenure !== owner || this.currentSession !== null)
          return;
        this.view.reclaim();
        this.view.notice(`Could not start the Pi session: ${exceptionText(error)}`);
        this.view.notice("Enter /restart to try again. Dashboard, Config, and Mail remain available through Ctrl+X.");
        this.view.draw();
      });
      return;
    }
    this.currentSession = live;
    this.currentConversation = Object.freeze({
      sendUi: (event: PiEvent) => live.sendUi(event),
      sendUiAndWait: (event: PiEvent) => live.sendUiAndWait(event),
    });
    this.currentHandle = newSessionHandle();
    live.onEvent(event => { if (this.currentSession === live && event.type === "agent_settled")
      this.deliver(); });
  }
  private async disown(reason: string): Promise<void> {
    if (this.disowned)
      return;
    this.disowned = true;
    this.delivery = null;
    const had = this.currentSession !== null;
    if (this.tenure !== null)
      await this.tenure.end();
    this.tenure = null;
    this.currentSession = null;
    this.currentConversation = null;
    this.view.disowned(reason, had);
  }
  private returnHumanConsole(): PromptOutcome {
    if (this.finishing || this.disowned || this.tenure === null || !this.tenure.held || this.view.openControlEditor === undefined)
      return { kind: "refused", reason: "This host cannot acquire a private Human control console. No Worker control was requested." };
    const live = this.currentSession;
    this.sessionDeferredForControl = false;
    if (live === null) {
      this.controlHandoff = "local";
      return this.view.openControlEditor() ? { kind: "handled" }
        : { kind: "refused", reason: "The private host console is not currently available. No Worker control was requested." };
    }
    if (this.controlHandoff === live) return { kind: "handled" };
    this.controlHandoff = live;
    this.delivery = null;
    this.tenure.principalUnregistered();
    try {
      // An untrusted UI request can end its own conversation, never execute a
      // Worker/Society command. The original onEnd owner waits for OS exit,
      // reclaims stdin, then opens a blank private editor. No text is replayed.
      live.close();
      return { kind: "handled" };
    } catch (error) {
      return { kind: "refused", reason: `Terminal return could not be confirmed: ${exceptionText(error)}. No Worker control was requested; the engine must end before local control input is enabled.` };
    }
  }
  /** Only the separately bound local host-console adapter calls this method. */
  control(text: string): Exclude<PromptOutcome, { kind: "accepted" }> {
    if (this.bootstrap.surface !== "collaboration-v1") return { kind: "refused", reason: "Human collaboration controls require the explicitly selected Society surface." };
    const output = this.view.controlLine?.bind(this.view);
    if (output === undefined) return { kind: "refused", reason: "Private local Human control output is unavailable; no command was submitted." };
    try {
      const command = humanControlCommand(text);
      if (command === null) return { kind: "refused", reason: "The Human control editor accepts /control commands only; nothing is forwarded to the Principal." };
      if (command.kind === "help") output(HUMAN_CONTROL_HELP);
      else {
        const owner = this.tenure;
        const generation = owner?.brokerGeneration;
        const authorize = (): void => {
          if (owner === null || this.tenure !== owner || this.finishing || this.disowned || !owner.brokerAvailable || owner.brokerGeneration !== generation)
            throw new StoreError("BROKER_UNAVAILABLE", "the Human Control Panel has no current supervising broker ownership");
          owner.assertOwned("Human lifecycle control");
        };
        authorize();
        output(`[Human control] Original command (preserve after interruption): ${text.trim()}`);
        let observed: Awaited<ReturnType<typeof callHumanControl>> | undefined;
        void callHumanControl(this.bootstrap.runRoot, this.config.limits, command.input, authorize, result => { observed = result; return undefined; }, this.hostChannel).then(result => {
          for (const line of humanControlLines(result)) output(line);
          this.view.refresh(); this.view.draw();
        }).catch(error => {
          output(observed === undefined
            ? `[Human control] A complete outcome was not observed: ${exceptionText(error)}. Preserve the original command/key and inspect its receipt; do not submit a replacement key. No Principal prompt was submitted.`
            : `[Human control] The original result was observed, but local presentation or refresh failed: ${exceptionText(error)}. The reported canonical result remains valid; inspect the original receipt rather than replacing the command.`);
          if (observed?.kind === "receipt" && observed.receipt !== null)
            output(`[Human control] Retained canonical receipt: original key ${observed.key}; operation ${observed.receipt.operation}; execution ${observed.receipt.state}. Observe /control receipt ${observed.key}; do not replace it.`);
          this.view.draw();
        });
      }
      this.view.draw();
      return { kind: "handled" };
    } catch (error) { return { kind: "refused", reason: exceptionText(error) }; }
  }
  submit(text: string): PromptOutcome {
    if (text.trim() === "/control") return this.returnHumanConsole();
    if (/^\/control(?:\s|$)/.test(text.trim()))
      return { kind: "refused", reason: "Enter /control alone to return this terminal to the host, then enter commands in its private editor. No Principal prompt or Worker control was submitted." };
    if (this.currentSession !== null)
      return this.currentSession.submit(text);
    if (text.trim() !== "/restart")
      return { kind: "refused", reason: "No Pi session is available. Enter /restart to reopen the conversation." };
    if (this.tenure?.canPrepareEngine !== true)
      return { kind: "refused", reason: "The previous engine has not exited or the current broker is not ready. No replacement conversation was started." };
    this.startupRefused = false;
    this.controlHandoff = null; // Only explicit /restart releases the local-console hold.
    return this.startSessionOnce() ? { kind: "accepted" }
      : { kind: "refused", reason: "The conversation could not be reopened. No prompt was submitted." };
  }
  /** Claim the one outgoing transition before stopping any resource. */
  beginFinish(): boolean {
    if (this.finishing)
      return false;
    this.finishing = true;
    return true;
  }
  /** A replacement requires actual engine exit beyond the tenure's polite grace. */
  async end(replacing: boolean): Promise<void> {
    const outgoing = this.currentSession;
    if (this.tenure !== null)
      await this.tenure.end();
    if (replacing)
      await outgoing?.exited;
    this.currentSession = null;
    this.currentConversation = null;
    await this.broker?.stop();
  }
  abandon(): void {
    this.finishing = true;
    this.tenure?.abandon();
    void this.broker?.stop();
  }
}
