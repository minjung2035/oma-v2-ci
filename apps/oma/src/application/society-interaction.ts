import { StoreError, exceptionText } from "@oma/domain/errors";
/** Application interaction: translate engine events and observed settings/mail into TUI data.
* No broker, engine or lease is acquired here. */
import { Buffer } from "node:buffer";
import { TuiApp, type AppPorts } from "@oma/tui/app";
import { PanelTerminal } from "@oma/tui/panel-terminal";
import { engineName, engineModelChoiceOf, WORKER_MODEL, workerModelText, bootstrapStateOf, type FieldValue } from "./settings.js";
import { societyPanelPorts } from "./society-panel.js";
import { TuiTransport, type Observation } from "./status-observation.js";
import { sessionHistoryDirectories } from "../runtime/session-catalog.js";
import type { PiEvent } from "@oma/engine/pi-rpc";
import type { ProjectSessionSettings } from "./project-session-settings.js";
import type { SocietyBootstrap } from "./society-bootstrap.js";
import type { ConversationCommands, ConversationUi, SocietyConversationView } from "./society-conversation.js";
export class SocietyInteraction implements SocietyConversationView {
  private readonly app: TuiApp;
  private readonly terminal: PanelTerminal;
  private readonly transport: TuiTransport;
  private poll: ReturnType<typeof setInterval> | undefined;
  private observation: Observation = { kind: "unknown", reason: "Not yet observed", observedAtMs: Date.now() };
  private screenReady = false;
  private sessionModel: string | null = null;
  private engineState: {
    model: string | null;
    thinking: string | null;
  } = { model: null, thinking: null };
  private readonly early: string[] = [];
  private saidLeftOut = "";
  constructor(private readonly bootstrap: SocietyBootstrap, private readonly configuration: ProjectSessionSettings, private readonly commands: ConversationCommands, acquired: (cleanup: () => void) => void) {
    this.transport = new TuiTransport(bootstrap.stateRoot, bootstrap.society, configuration.settings.config.limits.frameBytes);
    this.terminal = new PanelTerminal({ input: process.stdin, output: process.stdout }, () => this.app.snapshot.open);
    acquired(() => this.restore());
    const ports: AppPorts = {
      ...societyPanelPorts(configuration, bootstrap.stateRoot, () => ({
        observation: this.observation, owned: commands.owned(), conversationOpen: commands.session() !== null,
        screenReady: this.screenReady, sessionModel: this.sessionModel, engine: this.engineState,
      })),
      submitPrompt: text => commands.submit(text),
      engineCommand: command => { commands.session()?.sendUi({ type: "engine_command", command }); },
      quit: () => { void commands.shutdown(0); },
    };
    this.app = new TuiApp(ports, this.terminal, configuration.settings.config.limits.frameBytes);
    acquired(() => { this.close(); this.restore(); });
    this.terminal.onResize(() => this.draw());
    this.terminal.whenUnclaimed(() => this.draw());
    this.terminal.onKeys(chunk => this.app.feed(chunk));
    this.sayLeftOut();
    this.refresh();
  }
  private saveField(field: string, value: FieldValue): ReturnType<AppPorts["setField"]> {
    return this.configuration.saveField(field, value, bootstrapStateOf(this.observation));
  }
  notice(text: string): void {
    this.app.line(text);
    const session = this.commands.session();
    if (session !== null && this.screenReady)
      session.sendUi({ type: "notice", text });
    else if (this.early.push(text) > 16)
      this.early.shift();
  }
  /** DR25: said once per derivation that left an extension out. */
  private sayLeftOut(): void {
    const words = this.configuration.leftOut.length === 0 ? "" : `Not loaded, its file is gone: ${this.configuration.leftOut.join(", ")}. ` +
      "Turn it off in Ctrl+X > Config > Extensions, or install its package again with oma pi install.";
    if (words !== this.saidLeftOut && words.length > 0)
      this.notice(words);
    this.saidLeftOut = words;
  }
  onUi(live: ConversationUi, event: PiEvent): void {
    if (this.commands.session() !== live)
      return;
    if (event.type === "quit") {
      void this.commands.shutdown(0);
      return;
    }
    if (event.type === "panel_open") {
      this.terminal.open(event);
      this.app.refresh();
      if (!this.app.snapshot.open)
        this.app.key({ kind: "panel" });
      else
        this.app.draw();
    }
    else if (event.type === "panel_size") {
      this.terminal.size(event);
      this.app.draw();
    }
    else if (event.type === "panel_key" && typeof event.data === "string" && this.app.snapshot.open)
      this.app.feed(Buffer.from(event.data));
    else if (event.type === "sessions_request" && typeof event.id === "string") {
      const id = event.id;
      void (async () => {
        if (!this.commands.finished() && this.commands.session() === live)
          live.sendUi({ type: "session_dirs", id,
            dirs: sessionHistoryDirectories(this.bootstrap.dataRoot, this.bootstrap.canonicalProjectPath).map(entry => entry.dir),
            current: this.commands.sessionDirectory(),
          });
      })().catch(error => { if (!this.commands.finished() && this.commands.session() === live)
        live.sendUi({ type: "session_dirs", id, dirs: [], error: exceptionText(error) }); });
    }
    else if (event.type === "switch") {
      if (event.mode !== undefined && (event.mode !== "personal" || event.session !== undefined)) return;
      void this.commands.relaunch(typeof event.session === "string" ? event.session : null,
        event.mode === "personal" ? "personal" : undefined);
    }
    else if (event.type === "engine_state") {
      this.engineState = { model: engineName(event.model), thinking: engineName(event.thinking) };
      this.app.refresh();
      this.app.draw();
    }
    else if (event.type === "worker_model") {
      // DR24: a Worker's model and effort, chosen from the engine's
      // lists, is the Worker model field's value, saved as any is.
      const project = (this.configuration.projectSettings ?? this.configuration.settings).config;
      const value: FieldValue | null = event.same === true
        ? project.agentProfiles[project.principalProfile]?.modelProfile ?? null
        : engineModelChoiceOf(event);
      if (value !== null) {
        try {
          const saved = this.saveField(WORKER_MODEL, value);
          this.notice(saved.kind === "saved-unread" ? `Worker model saved; could not read settings back: ${saved.reason}`
            : `Worker model: ${workerModelText(this.configuration.settings.config, this.configuration.settings.workerProfile)}${saved.kind === "unchanged" ? " (unchanged)" : " · saved; applies from the next activation"}`);
        }
        catch (error) {
          this.notice(`Could not save the worker model: ${exceptionText(error)}`);
        }
        this.app.refresh();
        this.app.draw();
      }
    }
    else if (event.type === "ready") {
      this.screenReady = true;
      // One notice: the engine's status line keeps only the latest.
      const said = this.early.splice(0);
      if (said.length > 0)
        live.sendUi({ type: "notice", text: said.join("\n") });
      this.commands.deliver();
    }
  }
  async observe(): Promise<void> {
    if (this.commands.finished())
      return;
    this.poll = setInterval(() => {
      if (this.commands.finished())
        return;
      void this.transport.status().then(next => {
        if (this.commands.finished())
          return;
        this.observation = next;
        this.app.refresh();
        this.app.draw();
      });
      this.commands.deliver();
      // DR24: a setting saved in another session of this project is made this
      // society's too; this process writes only its own society's configuration.
      if (this.commands.owned() && !this.commands.finished() && this.configuration.changed()) {
        if (this.configuration.rederive()) {
          this.configuration.readBack();
          this.sayLeftOut();
          this.app.refresh();
          this.app.draw();
        }
      }
    }, 5000);
    this.poll.unref();
    const initialObservation = await this.transport.status();
    if (this.commands.finished())
      return;
    this.observation = initialObservation;
    this.app.refresh();
    this.app.draw();
  }
  starting(model: string | null): void {
    this.sessionModel = model;
    this.terminal.handoff(event => this.commands.session()?.sendUi(event));
  }
  ending(): void { this.screenReady = false; }
  ended(reason: string, finished: boolean, disowned: boolean): void {
    this.sessionModel = null;
    this.engineState = { model: null, thinking: null };
    this.busy(false);
    if (finished)
      return;
    this.reclaim();
    this.notice(reason);
    if (!disowned)
      this.notice("Enter /restart to reopen the conversation. Earlier input is not resent automatically.");
    this.refresh();
    this.draw();
  }
  disowned(reason: string, had: boolean): void {
    this.reclaim();
    this.notice(`This process does not own this society's broker: ${reason}.`);
    this.notice(had ? "Ownership lost; the Pi session was closed. Dashboard, Config, and Mail remain available through Ctrl+X."
      : "Cannot open an authorized conversation session. Dashboard, Config, and Mail remain available through Ctrl+X.");
    this.draw();
  }
  returnPrompt(text: string, reason: string): void { this.app.returnPrompt(text, reason); }
  refresh(): void { this.app.refresh(); }
  draw(): void { this.app.draw(); }
  line(text: string): void { this.app.line(text); }
  busy(value: boolean): void { this.app.setBusy(value); }
  reclaim(): void { this.terminal.reclaim(); }
  restore(): void { this.terminal.restore(); }
  close(): void {
    if (this.poll !== undefined)
      clearInterval(this.poll);
    this.poll = undefined;
    this.app.close();
  }
}
