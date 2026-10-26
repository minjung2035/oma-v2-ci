import { exceptionText, StoreError } from "@oma/domain/errors";
import { engineStartEffects } from "../engine/start-effects.js";
/** Society execution coordination. HostTenure alone grants authority and holds the fence.
* Broker/Principal callbacks report observations; UI interaction receives narrow commands. */
import { join } from "node:path";
import { DEPLOYMENT_LAYOUT } from "@oma/domain/deployment";
import { encodedPrincipalToolSurface } from "@oma/domain/tool-surface";
import { resolvePiRuntime } from "@oma/engine/pi-runtime";
import { ensureOwnedDirectory } from "@oma/storage/directory";
import { PrincipalSession, newSessionHandle, principalEnvironment, principalSessionDir, principalWorkspace } from "@oma/engine/principal-session";
import { principalSessionProfile } from "../engine/principal-profile.js";
import { PrincipalDelivery, principalHostBroker } from "../runtime/principal-delivery.js";
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
  private preparationStartFailed = false;
  constructor(private readonly bootstrap: SocietyBootstrap, private readonly prepared: PreparedSociety, private readonly view: SocietyConversationView) { this.tenure = bootstrap.tenure; }
  private get config() { return this.prepared.configuration.settings.config; }
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
        if (!this.preparationStartFailed)
          this.startSessionOnce();
        void this.register().then(() => this.deliver());
      });
      this.broker.onLost(() => { this.tenure?.brokerLost(); });
      this.broker.onDisowned(reason => { void this.disown(reason); });
      if (this.broker.state.kind === "started") {
        this.view.notice("Preparing society repositories and Workers; conversation is available while they prepare.");
        this.startSessionOnce(true);
      }
    }
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
      toolSurface: encodedPrincipalToolSurface(),
      fence: owner.fence }, profile, limitsOf(this.config.limits), principalEnvironment({ stateRoot: this.bootstrap.stateRoot, runRoot: this.bootstrap.runRoot, libdir: this.config.installation.libdir }, profile, this.config.limits), {
      errorWords: error => exceptionText(error),
      onAcquire: engine => owner.adopt(engine),
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
    const live = this.currentSession, owner = this.tenure, handle = this.currentHandle;
    const pid = live?.pid ?? null;
    if (pid === null || live === null || this.broker === null || owner === null)
      return;
    const generation = owner.brokerGeneration;
    const credential = await this.broker.register(handle, pid);
    // A reply belongs to this engine as well as this broker. A late reply
    // from an ended engine cannot grant or revoke its successor's authority.
    if (this.tenure !== owner || !owner.held || this.currentSession !== live || !live.running ||
      this.currentHandle !== handle || owner.brokerGeneration !== generation)
      return;
    if (credential === null) {
      owner.principalUnregistered();
      this.view.notice("The broker rejected the Principal session. Requests cannot be sent.");
      this.view.draw();
      return;
    }
    live.grant(credential, handle);
    owner.principalRegistered();
    if (this.delivery === null)
      this.delivery = new PrincipalDelivery({
        get running() { return live.running; },
        get busy() { return live.busy; },
        onEvent: (listener: (event: PiEvent) => void) => live.onEvent(listener),
        deliver: (batchId: string) => live.deliver(batchId),
      }, principalHostBroker(this.bootstrap.runRoot, this.config.limits), {
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
  private startSessionOnce(preparing = false): void {
    if (this.currentSession !== null || this.finishing || this.disowned || this.tenure === null ||
      !(preparing ? this.tenure.canPrepareEngine : this.tenure.canStartEngine))
      return;
    const owner = this.tenure;
    this.preparationStartFailed = false;
    let live: PrincipalSession;
    try {
      live = this.startEngine(owner);
    }
    catch (error) {
      this.preparationStartFailed = preparing;
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
    this.currentConversation = Object.freeze({ sendUi: (event: PiEvent) => live.sendUi(event) });
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
  submit(text: string): PromptOutcome {
    if (this.currentSession !== null)
      return this.currentSession.submit(text);
    if (text.trim() !== "/restart")
      return { kind: "refused", reason: "No Pi session is available. Enter /restart to reopen the conversation." };
    this.startSessionOnce();
    if (this.currentSession === null)
      return { kind: "refused", reason: "The conversation could not start; see the startup notice." };
    void this.register().then(() => this.deliver());
    return { kind: "accepted" };
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
