/** Principal-only interactive host. Pi and Open TUI own presentation, commands
 * and settings as they ship; OMA owns only where a plain Human prompt goes and
 * how mail reaches the session. */
import "../runtime/client-preload.js";
import { Socket } from "node:net";
import { readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { basename, join, dirname, relative, isAbsolute, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import { createAgentSessionRuntime, createAgentSessionServices, createAgentSessionFromServices,
  DynamicBorder, InteractiveMode, ModelSelectorComponent, SessionManager, SessionSelectorComponent, SettingsManager,
  ThinkingSelectorComponent, VERSION, type AgentSession,
  type ExtensionContext, type SessionInfo,
  type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { InteractiveChannel, INTERACTIVE_RPC_FD, INTERACTIVE_UI_FD } from "../runtime/interactive-channel.js";
import type { PiEvent } from "../runtime/pi-rpc.js";
import { ownedEditor, type Suggestion } from "../tui/interactive-editor.js";
import { safeToolPresentation } from "../runtime/interactive-display.js";
import { stylePanel } from "../tui/panel-style.js";
import { ProjectSessionDirectories } from "../tui/project-session-directories.js";
import { parseHostHistoryReference } from "../protocol/host-history.js";
import { brandFooter, brandHeader, type OpenTuiBrand } from "../tui/open-tui-brand.js";
import { preparePiInteractive } from "../runtime/pi-runtime.js";
import { ExtensionModules } from "../runtime/extension-modules.js";
import { humanPromptFitsFrame } from "../tui/limits.js";
import { UNSEEN, UNSEEN_EXCEPT_LAYOUT } from "../domain/unseen-text.js";
import { EFFORT_LEVELS } from "../config.js";
import type { EffortLevel } from "../../implementation/contracts.js";

type EngineModel = NonNullable<AgentSession["model"]>;
type EngineEffort = ConstructorParameters<typeof ThinkingSelectorComponent>[0];

/** The effort levels the engine offers for a model, as its own effort list
 * does (the engine's getSupportedThinkingLevels); a test holds this to it. */
export function effortLevelsOf(model: { readonly reasoning?: boolean; readonly thinkingLevelMap?: Readonly<Record<string, unknown>> }): EffortLevel[] {
  if (model.reasoning !== true) return ["off"];
  return EFFORT_LEVELS.filter(level => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    return level === "xhigh" || level === "max" ? mapped !== undefined : true;
  });
}

const numberEnv = (name: string): number => {
  const value = Number(process.env[name]);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`invalid ${name}`);
  return value;
};

/** The commands Pi's own editor handles, mirrored from the engine's
 * BUILTIN_SLASH_COMMANDS plus the ones it handles without listing them. A test
 * holds this to the engine's list, so an engine upgrade cannot drift from it. */
export const PI_BUILTIN_COMMANDS: ReadonlySet<string> = new Set(["settings", "model", "tree", "thinking", "scoped-models",
  "export", "import", "share", "bug", "copy", "name", "session", "changelog", "hotkeys", "fork", "clone", "trust", "login",
  "logout", "new", "compact", "resume", "reload", "quit", "debug", "arminsayshi", "dementedelves"]);

/** How oma describes the engine's commands whose own words name the engine as
 * the product. */
const COMMAND_WORDS: Readonly<Record<string, string>> = Object.freeze({
  quit: "Quit oma",
  changelog: "Show the bundled engine's changelog",
  new: "Start a new oma session (its own conversation, mail, workers and repositories)",
  resume: "Reopen an earlier oma session of this project",
});

/** The engine's commands that mean nothing in oma, or would mix another
 * product's state into it, and what is said instead. */
export const NOT_IN_OMA: Readonly<Record<string, string>> = Object.freeze({
  trust: "oma loads no project resources (extensions, skills, prompts or context files), so there is no project trust to save.",
  // The engine's report uploads the session -- the Principal's conversation
  // and its mail -- to the engine's developers, who do not make oma.
  bug: "oma does not send its sessions to the bundled engine's developers.",
  // A session file from elsewhere -- the engine's own history among them --
  // would become this session's conversation without its mail or workers.
  import: "oma does not import session files; reopen an earlier oma session of this project with /resume.",
});

/** `/export` writes where the Human is, under oma's name: a relative path is
 * the project's, and no path is the session's own `oma-session-<id>.html` in
 * the project. The engine would write into the Principal's private workspace,
 * its own working directory, as `pi-session-<id>.html`. Null leaves the
 * command as it was typed. */
export function omaExportCommand(given: string | undefined, project: string, sessionFile: string | undefined): string | null {
  let target: string;
  if (given === undefined) {
    if (sessionFile === undefined) return null;
    target = join(project, `oma-session-${basename(sessionFile, ".jsonl")}.html`);
  } else if (given.startsWith("~") || isAbsolute(given)) return null;
  else target = resolve(project, given);
  if (!/\s/.test(target) && !/^["']/.test(target)) return `/export ${target}`;
  const quote = !target.includes('"') ? '"' : !target.includes("'") ? "'" : null;
  return quote === null ? null : `/export ${quote}${target}${quote}`;
}

/** The engine's advice when a crash points at an extension names its own CLI
 * (`pi config`, `pi -ne`), which would change another Pi, not oma. A test
 * holds this to the engine's words. */
export const ENGINE_EXTENSION_ADVICE = /Try disabling (it|them) with `pi config`, or run `pi -ne` to confirm\./;
export function omaCrashHint(hint: string | undefined): string | undefined {
  return hint?.replace(ENGINE_EXTENSION_ADVICE, (_advice, pronoun: string) =>
    `If you added ${pronoun}, turn ${pronoun} off in Ctrl+X > Config > Extensions to confirm.`);
}

/** The terminal's title names oma, the session and the Human's project, as
 * the header does; the engine's names itself and its working directory. */
export function omaTerminalTitle(session: string | undefined, project: string): string {
  const name = session?.replace(UNSEEN, "").trim();
  return ["oma", ...(name ? [name] : []), basename(project).replace(UNSEEN, "")].join(" - ");
}

/** The OMA-internal delivery command. Only the host's delivery sends it. */
const DELIVERY_COMMAND = "oma-deliver";
const commandName = (text: string): string => text.trim().slice(1).split(/\s/, 1)[0] ?? "";

/** The project as the Human knows it: under their home, written from `~`. */
function projectDisplay(path: string): string {
  const home = userInfo().homedir;
  const inside = relative(home, path);
  if (inside === "") return "~";
  return inside.startsWith("..") || isAbsolute(inside) ? path : `~${sep}${inside}`;
}

export async function runInteractive(): Promise<void> {
  const limits = { frameBytes: numberEnv("OMA_FRAME_BYTES"), idleStreamSeconds: numberEnv("OMA_UI_IDLE_SECONDS"),
    receiptWaitSeconds: numberEnv("OMA_UI_RECEIPT_SECONDS") };
  const argv = process.argv.slice(2);
  const flag = (name: string): string => {
    const index = argv.indexOf(name);
    if (index < 0 || !argv[index + 1]) throw new Error(`missing ${name}`);
    return argv[index + 1]!;
  };
  const agentDir = process.env.PI_CODING_AGENT_DIR;
  if (!agentDir) throw new Error("interactive engine needs its private agent directory");
  preparePiInteractive(agentDir);
  const cwd = process.cwd();
  /** The Human's project, which the Principal's private workspace (this process's cwd) is not. */
  const projectDir = process.env.OMA_PROJECT_DISPLAY ?? cwd;
  const brand: OpenTuiBrand = {
    title: "oma",
    version: (JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version: string }).version,
    engineVersion: VERSION,
    project: projectDisplay(projectDir.replace(UNSEEN, "")),
    tip: "Ctrl+X oma settings",
    society: (process.env.OMA_SOCIETY ?? "").replace(UNSEEN, ""),
  };
  let editorInstalled = false;
  let context: ExtensionContext | undefined;
  let ready = false;
  const notices: { text: string; level: "info" | "warning" | "error" }[] = [];
  const notify = (text: string, level: "info" | "warning" | "error"): void => {
    const clean = text.replace(UNSEEN_EXCEPT_LAYOUT, "");
    if (context && ready) context.ui.notify(clean, level); else notices.push({ text: clean, level });
  };
  let panelOpen = false;
  let panelDone: (() => void) | undefined;
  let panelLines: string[] = [];
  let redraw: (() => void) | undefined;
  let inputSequence = 0;
  let pendingInput: { id: string; text: string } | undefined;
  let stopping = false;
  let quitting = false;
  // P0-4: deferred UI work belongs to one session, never its replacement.
  let uiEpoch = 0;
  const uiTimers = new Set<ReturnType<typeof setTimeout>>();
  const currentUi = (epoch: number): boolean => !stopping && !quitting && context !== undefined && epoch === uiEpoch;
  const leaveUi = (): void => {
    uiEpoch++;
    for (const timer of uiTimers) clearTimeout(timer);
    uiTimers.clear();
    const done = panelDone;
    panelDone = undefined; redraw = undefined; panelOpen = false; panelLines = [];
    context = undefined;
    done?.();
  };
  const deferUi = (action: () => void): void => {
    const epoch = uiEpoch;
    if (!currentUi(epoch)) return;
    const timer = setTimeout(() => {
      if (!uiTimers.delete(timer) || !currentUi(epoch)) return;
      action();
    }, 0);
    uiTimers.add(timer);
  };
  const ownSessions = flag("--session-dir");
  const sessionDirs = new ProjectSessionDirectories(ownSessions, limits.receiptWaitSeconds, event => ui.send(event));
  const die = (): void => {
    if (stopping) return;
    stopping = true;
    leaveUi();
    sessionDirs.close();
    process.kill(process.pid, "SIGTERM");
  };
  const ui = new InteractiveChannel(new Socket({ fd: INTERACTIVE_UI_FD, readable: true, writable: true }), limits, event => {
    if (stopping || quitting) return;
    if (event.type === "input_result" && pendingInput && pendingInput.id === event.id) {
      const text = pendingInput.text;
      pendingInput = undefined;
      if (event.accepted !== true) {
        // The editor cleared the draft on Enter; a refused prompt comes back.
        if (context?.ui.getEditorText() === "") context.ui.setEditorText(text);
        notify(typeof event.reason === "string" ? event.reason : "Input was not accepted", "error");
      } else if (event.queued === true) notify("Queued; it runs after the current response.", "info");
    } else if (event.type === "notice" && typeof event.text === "string") notify(event.text, "info");
    else if (event.type === "return_prompt" && typeof event.text === "string") {
      notify(`Unsent input: ${event.text}`, "error");
      if (context?.ui.getEditorText() === "") context.ui.setEditorText(event.text);
    } else if (event.type === "session_dirs" || event.type === "host_history_page") {
      sessionDirs.accept(event);
    } else if (event.type === "engine_command" && (event.command === "principal-model" || event.command === "worker-model")) {
      // DR24: the engine's own lists take the screen the panel leaves -- the
      // model, then its effort, in one go -- and give oma's settings back.
      const epoch = uiEpoch;
      panelDone?.();
      const choose = event.command === "principal-model" ? choosePrincipalModel : chooseWorkerModel;
      deferUi(() => {
        void choose().catch(error => {
          if (currentUi(epoch)) notify(error instanceof Error ? error.message : String(error), "error");
        }).finally(() => { if (currentUi(epoch)) deferUi(openPanel); });
      });
    } else if (event.type === "panel_frame" && Array.isArray(event.lines) && event.lines.every(x => typeof x === "string")) {
      panelLines = event.lines; redraw?.();
      if (event.open === false) panelDone?.();
    }
  }, die);
  const openPanel = (): void => {
    const epoch = uiEpoch;
    if (!context || !currentUi(epoch) || panelOpen) return;
    panelOpen = true;
    void context.ui.custom<void>((tui, theme, _keys, done) => {
      panelDone = () => done(); redraw = () => tui.requestRender();
      const border = new DynamicBorder(text => theme.fg("borderAccent", text));
      // The panel takes the editor's place, as the engine's own selectors do.
      const rows = (): number => Math.max(10, Math.min(tui.terminal.rows - 6, 32));
      ui.send({ type: "panel_open", columns: tui.terminal.columns, rows: rows() });
      let previous = "";
      return {
        render(width: number) {
          if (!currentUi(epoch)) return [];
          const size = `${width}/${rows()}`;
          if (size !== previous) { previous = size; ui.send({ type: "panel_size", columns: width, rows: rows() }); }
          return [...border.render(width), ...stylePanel(panelLines, theme), ...border.render(width)];
        },
        invalidate() {},
        handleInput(data: string) { if (currentUi(epoch)) ui.send({ type: "panel_key", data }); },
      };
    }).finally(() => {
      if (epoch !== uiEpoch) return;
      panelOpen = false; panelDone = undefined; redraw = undefined;
    });
  };
  const submit = (text: string): void => {
    // The delivery command presents a broker-prepared batch; only OMA's
    // delivery, which owns the run it starts, sends it.
    if (text.trim().startsWith("/") && commandName(text) === DELIVERY_COMMAND) {
      if (context?.ui.getEditorText() === "") context.ui.setEditorText(text);
      notify(`/${DELIVERY_COMMAND} is sent only by OMA's mail delivery.`, "warning"); return;
    }
    if (pendingInput) {
      if (context?.ui.getEditorText() === "") context.ui.setEditorText(text);
      notify("Waiting for the previous input to be accepted.", "warning"); return;
    }
    if (!humanPromptFitsFrame(text, limits.frameBytes)) {
      if (context?.ui.getEditorText() === "") context.ui.setEditorText(text);
      notify("Input exceeds the allowed size.", "warning"); return;
    }
    const id = `ui-${++inputSequence}`;
    pendingInput = { id, text };
    ui.send({ type: "human_input", id, text });
  };
  let runtime: Awaited<ReturnType<typeof createAgentSessionRuntime>> | undefined;
  let modules: ExtensionModules | undefined, mode: InteractiveMode | undefined;
  /** The engine's own model list: every model of every provider it is logged in to. */
  const chooseModel = (session: AgentSession, current: EngineModel | undefined): Promise<EngineModel | undefined> =>
    context!.ui.custom<EngineModel | undefined>((tui, _theme, _keys, done) =>
      new ModelSelectorComponent(tui, current, session.modelRuntime, session.scopedModels, model => done(model), () => done(undefined)));
  /** The engine's own effort list for a model; a model with one level has nothing to choose.
   * What is chosen here is always kept, so the list's "set as default" key
   * chooses as Enter does rather than doing nothing. */
  const chooseEffort = (current: string, levels: readonly string[]): Promise<string | undefined> =>
    levels.length <= 1 ? Promise.resolve(levels[0]) : context!.ui.custom<string | undefined>((_tui, _theme, _keys, done) =>
      new ThinkingSelectorComponent((levels.includes(current) ? current : levels[0]) as EngineEffort, [...levels] as EngineEffort[],
        level => done(level), () => done(undefined), level => done(level)));
  /** The Principal's model and effort: the engine's default, as its own lists
   * save one -- this session and the next. */
  const choosePrincipalModel = async (): Promise<void> => {
    const epoch = uiEpoch, session = runtime?.session;
    if (!context || !session || !currentUi(epoch)) return;
    const model = await chooseModel(session, session.model);
    if (model === undefined || !currentUi(epoch)) return;
    await session.setModel(model, { persist: true });
    if (!currentUi(epoch)) return;
    const level = await chooseEffort(session.thinkingLevel, session.getAvailableThinkingLevels());
    if (!currentUi(epoch)) return;
    if (level !== undefined) session.setThinkingLevel(level as EngineEffort, { persist: true });
    reportEngine();
  };
  /** A Worker's model and effort, which oma saves in the project's settings. */
  const chooseWorkerModel = async (): Promise<void> => {
    const epoch = uiEpoch, session = runtime?.session;
    if (!context || !session || !currentUi(epoch)) return;
    const same = "Same as the Principal", own = "Choose a model and effort";
    const kind = await context.ui.select("Worker model", [same, own]);
    if (!currentUi(epoch)) return;
    if (kind === same) { ui.send({ type: "worker_model", same: true }); return; }
    if (kind !== own) return;
    const model = await chooseModel(session, undefined);
    if (model === undefined || !currentUi(epoch)) return;
    const level = await chooseEffort(session.thinkingLevel, effortLevelsOf(model));
    if (level === undefined || !currentUi(epoch)) return;
    ui.send({ type: "worker_model", provider: model.provider, model: model.id, thinking: level });
  };
  const reportEngine = (): void => {
    const current = runtime?.session;
    if (!current || !currentUi(uiEpoch)) return;
    ui.send({ type: "engine_state", model: current.model ? `${current.model.provider}/${current.model.id}` : "",
      thinking: current.thinkingLevel });
  };
  /** `/resume`: the engine's own session list, over every session of this
   * project. A session of this society is opened here, as the engine would;
   * another one is its society's, which the parent reopens whole. */
  const showResume = (): void => {
    const epoch = uiEpoch;
    if (!context || !currentUi(epoch)) return;
    const project = brand.project;
    void context.ui.custom<void>((tui, _theme, keybindings, done) => {
      const load = async (_progress: unknown, signal?: AbortSignal): Promise<SessionInfo[]> => {
        if (!currentUi(epoch)) return [];
        const snapshot = await sessionDirs.snapshot(signal);
        if (snapshot.error !== undefined && currentUi(epoch)) notify(snapshot.error, "warning");
        const found: SessionInfo[] = snapshot.histories.map(info => {
          const identity = parseHostHistoryReference(info.reference);
          return { path: info.reference, id: identity.sessionId, cwd: project, name: `[Personal] ${info.name ?? identity.sessionId}`,
            created: new Date(info.created), modified: new Date(info.modified), firstMessage: info.firstMessage,
            messageCount: info.messageCount, allMessagesText: `${info.name ?? ""} ${info.firstMessage}` };
        });
        for (const dir of snapshot.dirs) {
          signal?.throwIfAborted();
          if (!currentUi(epoch)) return [];
          try { found.push(...await SessionManager.listAll(dir, undefined, signal)); }
          catch { signal?.throwIfAborted(); /* a session the list cannot read is not offered */ }
        }
        if (!currentUi(epoch)) return [];
        return found.map(info => ({ ...info, cwd: project })).sort((a, b) => b.modified.getTime() - a.modified.getTime());
      };
      return new SessionSelectorComponent(load, load, path => {
        done();
        if (!currentUi(epoch)) return;
        if (dirname(path) === ownSessions) void runtime?.switchSession(path).catch(error => {
          if (currentUi(epoch)) notify(String(error), "error");
        });
        else ui.send({ type: "switch", session: path });
      }, () => done(), () => { done(); if (currentUi(epoch)) ui.send({ type: "quit" }); },
      () => { if (currentUi(epoch)) tui.requestRender(); },
      { keybindings, showRenameHint: false }, runtime?.session.sessionFile);
    });
  };
  let session: AgentSession | undefined;
  let unsubscribe: (() => void) | undefined;
  // Pi replaces the session object on /new, /resume and /fork; the run
  // evidence OMA reads follows whichever session is current.
  const follow = (current: AgentSession): void => {
    if (current === session) return;
    unsubscribe?.();
    session = current;
    unsubscribe = current.subscribe(event => {
      if (event.type === "message_end" && event.message.role === "assistant")
        rpc.send({ type: "message_end", message: { role: "assistant", stopReason: event.message.stopReason } });
      else if (event.type === "agent_settled" || event.type === "auto_retry_start" || event.type === "auto_retry_end")
        rpc.send(event as unknown as PiEvent);
    });
  };
  /** oma's own answers to the engine's session commands, and to the ones that mean nothing here. */
  const OMA_COMMANDS = new Set(["new", "resume", ...Object.keys(NOT_IN_OMA)]);
  const isCommand = (text: string): boolean => {
    const trimmed = text.trim();
    const name = commandName(trimmed);
    return trimmed.startsWith("!") || trimmed.startsWith("/") && PI_BUILTIN_COMMANDS.has(name) && !OMA_COMMANDS.has(name);
  };
  // An extension's command runs at once, as the engine runs one it is given;
  // it starts no run of its own unless it sends one, like /oma or /open-tui.
  const extensionCommand = (text: string): boolean => {
    const trimmed = text.trim();
    const name = commandName(trimmed);
    if (!trimmed.startsWith("/")) return false;
    if (name === "new") { ui.send({ type: "switch" }); return true; }
    if (name === "resume") { showResume(); return true; }
    if (NOT_IN_OMA[name] !== undefined) { notify(NOT_IN_OMA[name]!, "info"); return true; }
    if (name === DELIVERY_COMMAND || !runtime?.session.extensionRunner.getCommand(name)) return false;
    void runtime.session.prompt(trimmed).catch(error => { notify(String(error), "error"); });
    return true;
  };
  // The command list says oma, lists nothing a Human cannot send, and drops
  // the `[t]` tag the engine gives extensions only because oma loads them from
  // its command line.
  const suggest = (items: readonly Suggestion[]): Suggestion[] => items
    .filter(item => item.value !== DELIVERY_COMMAND && NOT_IN_OMA[item.value] === undefined)
    .map(item => {
      const words = COMMAND_WORDS[item.value];
      const description = item.description === undefined ? undefined
        : words !== undefined ? item.description.replace(/[^—]*$/, words).replace(/^(?!.*—)/, "").trim()
        : item.description.replace(/^\[t\] ?/, "");
      return { ...item, ...(description === undefined ? {} : { description }) };
    });
  const boundary: ExtensionFactory = pi => {
    pi.registerMarkdownTransformer(markdown => markdown.replace(UNSEEN_EXCEPT_LAYOUT, ""));
    pi.registerCommand("oma", { description: "Open oma settings: Dashboard, Config, Mail (also Ctrl+X)", handler: async () => { openPanel(); } });
    // Listed by the engine's /hotkeys; the editor itself answers the key first.
    pi.registerShortcut("ctrl+x", { description: "Open oma settings (Dashboard, Config, Mail)", handler: async () => { openPanel(); } });
    pi.on("model_select", () => { deferUi(reportEngine); });
    pi.on("thinking_level_select", () => { deferUi(reportEngine); });
    pi.on("session_start", (_event, ctx) => {
      if (stopping || quitting) return;
      leaveUi();
      context = ctx;
      if (runtime) { follow(runtime.session); if (ready) reportEngine(); }
      const original = ctx.ui.setEditorComponent.bind(ctx.ui);
      ctx.ui.setEditorComponent = factory => {
        if (factory) original((tui, theme, keys) => {
          editorInstalled = true;
          return ownedEditor(factory(tui, theme, keys), { submit, isCommand, extensionCommand, panel: openPanel, suggest,
            frameBytes: limits.frameBytes,
            refuse: () => ctx.ui.notify("Input exceeds the allowed size; edit the draft before submitting.", "warning") });
        });
        else original(factory);
      };
      // Open TUI's header and footer, as they ship, naming oma and the project.
      const setHeader = ctx.ui.setHeader.bind(ctx.ui);
      ctx.ui.setHeader = factory => setHeader(factory && ((tui, theme) => {
        const inner = factory(tui, theme);
        return { render: (width: number) => brandHeader(inner.render(width), brand, text => theme.fg("accent", text)),
          invalidate: () => inner.invalidate(), dispose: () => (inner as { dispose?(): void }).dispose?.() };
      }));
      const setFooter = ctx.ui.setFooter.bind(ctx.ui);
      ctx.ui.setFooter = factory => setFooter(factory && ((tui, theme, data) => {
        const inner = factory(tui, theme, data);
        return { render: (width: number) => brandFooter(inner.render(width), brand),
          invalidate: () => inner.invalidate(), dispose: () => (inner as { dispose?(): void }).dispose?.() };
      }));
      const upstreamNotify = ctx.ui.notify.bind(ctx.ui);
      ctx.ui.notify = (message, level) => {
        if (message.startsWith("OMA_PI_BOUNDARY_V1 ")) {
          rpc.send({ type: "extension_ui_request", method: "notify", message, notifyType: level ?? "info" });
        } else upstreamNotify(message, level);
      };
    });
    pi.on("session_shutdown", event => {
      leaveUi();
      // Leaving Pi (Ctrl+C twice, Ctrl+D, /quit) is leaving oma.
      if (event.reason === "quit") { quitting = true; sessionDirs.close(); ui.send({ type: "quit" }); }
    });
  };
  // Pi prints how to resume with the `pi` command on exit; oma resumes its
  // own session, so that line would name a command that does not apply.
  const write = process.stdout.write.bind(process.stdout) as (chunk: unknown, ...rest: unknown[]) => boolean;
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) =>
    quitting && String(chunk).includes("To resume this session:") ? true : write(chunk, ...rest)) as typeof process.stdout.write;
  const rpc = new InteractiveChannel(new Socket({ fd: INTERACTIVE_RPC_FD, readable: true, writable: true }), limits, event => {
    if (!ready) { rpc.send({ type: "response", id: event.id ?? "", command: "prompt", success: false, error: "interactive UI is not ready" }); return; }
    if (event.type !== "prompt" || typeof event.message !== "string" || typeof event.id !== "string") { die(); return; }
    let accepted = false;
    if (!runtime) { die(); return; }
    void runtime.session.prompt(event.message, { source: "rpc", expandPromptTemplates: event.message.startsWith(`/${DELIVERY_COMMAND} `),
      preflightResult: success => {
        if (success) { accepted = true; rpc.send({ type: "response", id: event.id!, command: "prompt", success: true }); }
      },
    }).catch(error => {
      if (!accepted) rpc.send({ type: "response", id: event.id!, command: "prompt", success: false, error: String(error) });
      else context?.ui.notify(String(error), "error");
    });
  }, die);
  const require = createRequire(import.meta.url);
  const upstream = join(dirname(require.resolve("pi-open-tui/package.json")), "extensions/open-tui/index.ts");
  const extensions = [...argv.flatMap((value, index) => value === "-e" ? [argv[index + 1]!] : []), upstream];
  modules = new ExtensionModules(extensions);
  try {
  runtime = await createAgentSessionRuntime(async options => {
    modules!.refresh(extensions);
    const services = await createAgentSessionServices({ ...options,
      settingsManager: SettingsManager.create(cwd, agentDir, { projectTrusted: false }), resourceLoaderOptions: {
      noExtensions: true, noSkills: true, noPromptTemplates: true, noContextFiles: true,
      additionalExtensionPaths: extensions,
      extensionFactories: [boundary],
      // The role prompt replaces Pi's generated base prompt, the same as the
      // RPC session's argv does; an absent flag leaves the loader's own default.
      ...(argv.includes("--system-prompt") ? { systemPrompt: flag("--system-prompt") } : {}),
      appendSystemPrompt: argv.includes("--append-system-prompt") ? [flag("--append-system-prompt")] : [],
      extensionsOverride: loaded => {
        if (loaded.errors.length || !loaded.extensions.some(extension => extension.resolvedPath === upstream)) {
          const error = new Error(`required interactive extensions could not be loaded: ${loaded.errors.length === 0 ? "Open TUI is missing"
            : loaded.errors.map(failure => `${failure.path}: ${failure.error}`).join("; ")}`);
          try { loaded.runtime.invalidate(); }
          catch (cleanup) { throw new AggregateError([error, cleanup], "Interactive extension load and cleanup failed"); }
          throw error;
        }
        for (const extension of loaded.extensions)
          for (const [name, tool] of extension.tools)
            extension.tools.set(name, { ...tool, definition: safeToolPresentation(tool.definition) });
        // The boundary must wrap the public UI before upstream installs components.
        const own = loaded.extensions.filter(extension => extension.path.startsWith("<inline:"));
        return { ...loaded, extensions: [...own, ...loaded.extensions.filter(extension => !extension.path.startsWith("<inline:"))] };
      },
    } });
    const reload = services.resourceLoader.reload.bind(services.resourceLoader);
    services.resourceLoader.reload = async options => { modules!.refresh(extensions); await reload(options); };
    services.settingsManager.applyOverrides({ enableInstallTelemetry: false, enableAnalytics: false, enableSkillCommands: false });
    const modelName = argv.includes("--model") ? flag("--model") : undefined;
    const split = modelName?.indexOf("/") ?? -1;
    const model = modelName === undefined ? undefined
      : services.modelRuntime.getModel(modelName.slice(0, split), modelName.slice(split + 1));
    if (modelName !== undefined && !model) throw new Error(`configured model is unavailable: ${modelName}`);
    try {
      const created = await createAgentSessionFromServices({ services, sessionManager: options.sessionManager, ...(model ? { model } : {}),
        excludeTools: ["bash", "powershell"] });
      const reloadSession = created.session.reload.bind(created.session);
      created.session.reload = async options => {
        try { await reloadSession(options); }
        catch (error) {
          try { services.resourceLoader.getExtensions().runtime.invalidate(); }
          catch (cleanup) { error = new AggregateError([error, cleanup], "Interactive reload and cleanup failed"); }
          if (mode !== undefined) await (mode as unknown as { handleFatalRuntimeError(prefix: string, error: unknown): Promise<void> })
            .handleFatalRuntimeError("Interactive reload failed", error);
          throw error;
        }
      };
      return { ...created, services, diagnostics: services.diagnostics };
    } catch (error) {
      try { services.resourceLoader.getExtensions().runtime.invalidate(); }
      catch (cleanup) { throw new AggregateError([error, cleanup], "Interactive creation and cleanup failed"); }
      throw error;
    }
  }, { cwd, agentDir, sessionManager: process.env.OMA_SESSION_FILE
    // DR24: `/resume` reopened this session; otherwise the society's own latest.
    ? SessionManager.open(process.env.OMA_SESSION_FILE, ownSessions) : SessionManager.continueRecent(cwd, ownSessions) });
  const owned = runtime, dispose = owned.dispose.bind(owned);
  let disposal: Promise<void> | undefined;
  owned.dispose = (): Promise<void> => disposal ??= (async () => {
    quitting = true;
    leaveUi();
    const errors: unknown[] = [];
    try { await owned.session.abort(); } catch (error) { errors.push(error); }
    try { await dispose(); } catch (error) { errors.push(error); }
    try { modules?.close(); } catch (error) { errors.push(error); }
    try { sessionDirs.close(); } catch (error) { errors.push(error); }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Interactive disposal failed");
  })();
  follow(owned.session);
  mode = new InteractiveMode(owned, { tuiMode: "fullscreen" });
  const fatalOwner = mode as unknown as { handleFatalRuntimeError(prefix: string, error: unknown): Promise<void> };
  const fatal = fatalOwner.handleFatalRuntimeError.bind(mode);
  fatalOwner.handleFatalRuntimeError = async (prefix, error) => {
    try { await owned.dispose(); }
    catch (cleanup) { error = new AggregateError([error, cleanup], "Interactive failure and cleanup failed"); }
    await fatal(prefix, error);
  };
  // OMA loads no project resources (no project extensions, skills, prompts or
  // context files), so Pi's project-trust warning has nothing to warn about.
  // It appeared only because the engine's HOME is the Principal's scratch.
  (mode as unknown as { renderProjectTrustWarningIfNeeded(): void }).renderProjectTrustWarningIfNeeded = () => {};
  // oma is not the engine's product: no hint to report a failed turn to the
  // engine's developers, and a crash is resumed with /resume, not `pi -r`.
  const words = mode as unknown as { suggestBugReport(): void; crashReportInstructions(): string };
  words.suggestBugReport = () => {};
  words.crashReportInstructions = () => "Start oma and reopen this session with /resume.";
  // The engine's own name and working directory are not oma's: its title,
  // its export's name and place, and its crash advice say oma's.
  const own = mode as unknown as {
    updateTerminalTitle(): void; ui: { terminal: { setTitle(title: string): void } };
    handleExportCommand(text: string): Promise<void>; getPathCommandArgument(text: string, command: string): string | undefined;
    getCrashExtensionHint(error: unknown): string | undefined;
  };
  own.updateTerminalTitle = () => { own.ui.terminal.setTitle(omaTerminalTitle(owned.session.sessionManager.getSessionName(), projectDir)); };
  const engineExport = own.handleExportCommand.bind(mode);
  own.handleExportCommand = text =>
    engineExport(omaExportCommand(own.getPathCommandArgument(text, "/export"), projectDir, owned.session.sessionFile) ?? text);
  const engineCrashHint = own.getCrashExtensionHint.bind(mode);
  own.getCrashExtensionHint = error => omaCrashHint(engineCrashHint(error));
  // Fetching the engine's search tools is not news on a start; a failure is.
  const toolStatus = mode as unknown as { showManagedToolStatus(status: { type: string; message: string }): void };
  const showToolStatus = toolStatus.showManagedToolStatus.bind(mode);
  toolStatus.showManagedToolStatus = status => { if (status.type === "warning") showToolStatus(status); };
  try {
    await mode.init();
    if (!editorInstalled) throw new Error("Open TUI did not install its editor");
  } catch (error) { stopping = true; leaveUi(); sessionDirs.close(); mode.stop(); throw error; }
  if (stopping || quitting) { mode.stop(); await owned.dispose(); return; }
  ready = true;
  ui.send({ type: "ready" });
  reportEngine();
  for (const { text, level } of notices.splice(0)) context?.ui.notify(text, level);
  } catch (error) {
    const errors: unknown[] = [error];
    try { await runtime?.dispose(); } catch (cleanup) { errors.push(cleanup); }
    if (runtime === undefined) try { modules.close(); } catch (cleanup) { errors.push(cleanup); }
    if (errors.length > 1) throw new AggregateError(errors, "Interactive startup and cleanup failed");
    throw error;
  }
}
