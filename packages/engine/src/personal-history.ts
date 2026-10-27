import { SessionManager, SessionSelectorComponent, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { lstatSync } from "node:fs";
import { StoreError } from "@oma/domain/errors";
import type { SessionMode } from "@oma/domain/session-mode";
import { adaptInteractiveMode } from "./pi-compat/interactive-mode.js";
import type { PersonalEngineInput, PersonalEnginePorts } from "./personal-ports.js";
import type { PersonalSessionState } from "./personal-state.js";
/** History and birth transitions share the current UI epoch and one switch reservation. */
export function createPersonalHistory(input: PersonalEngineInput, ports: PersonalEnginePorts, state: PersonalSessionState) {
  const { birth } = input;
  const current = (epoch: number): boolean => state.current(epoch);
  const beforeSwitch = async (reason: "new" | "resume", file?: string): Promise<boolean> => {
    const result = await state.runtime!.session.extensionRunner.emit({ type: "session_before_switch", reason,
      ...(file === undefined ? {} : { targetSessionFile: file }) });
    return result?.cancel !== true;
  };
  const transition = async (epoch: number, file?: string, society?: string, targetMode?: SessionMode): Promise<void> => {
    if (!current(epoch)) return;
    if ([file, society, targetMode].filter(value => value !== undefined).length > 1) throw new StoreError("INVALID_REQUEST", "A switch carries one target");
    if (file !== undefined && !lstatSync(file).isFile()) throw new StoreError("INVALID_REQUEST", "Session history is not a regular file");
    if (process.send === undefined || state.mode === undefined) throw new StoreError("BROKER_UNAVAILABLE", "Personal host channel is unavailable");
    state.switching = true;
    try {
      // The host owns the meaning of these fields: `session` reopens a saved
      // history, `society` re-enters as `oma --society <name>` — a new birth.
      await new Promise<void>((resolve, reject) => process.send!({ type: "switch",
        ...(file === undefined ? {} : { session: file }), ...(society === undefined ? {} : { society }),
        ...(targetMode === undefined ? {} : { mode: targetMode }) },
        error => { if (error) reject(error); else resolve(); }));
    } catch (error) { state.switching = false; throw error; }
    await adaptInteractiveMode(state.mode).shutdown();
  };
  const society = async (args: string, ctx: ExtensionContext): Promise<void> => {
    const epoch = state.epoch;
    if (!current(epoch) || state.replacing) return;
    const unused = (): boolean => state.runtime!.session.messages.length === 0 && ctx.isIdle();
    if (!unused()) { ctx.ui.notify("Choose Personal or Society before starting a conversation. Use /new for a new session.", "warning"); return; }
    state.replacing = true;
    try {
      const picked = args.trim() || await ctx.ui.select("Session mode — Personal", ["Personal", "Society"]);
      if (!current(epoch) || !unused() || picked === undefined || picked.toLowerCase() === "personal") return;
      if (picked.toLowerCase() !== "society") { ctx.ui.notify("Use /society personal or /society society.", "warning"); return; }
      if (await beforeSwitch("new") && current(epoch) && unused()) await transition(epoch, undefined, undefined, "society");
    }
    finally { state.replacing = false; }
  };
  const bindRuntime = (): void => {
    const runtime = state.runtime!;
    // Every new session returns to birth selection, including an extension's call.
    const sameBirthSwitch = runtime.switchSession.bind(runtime);
    runtime.newSession = async options => {
      const epoch = state.epoch;
      if (!current(epoch) || state.replacing) return { cancelled: true };
      if (options && Object.values(options).some(value => value !== undefined))
        throw new StoreError("INVALID_REQUEST", "A new OMA session selects its birth before extension setup");
      state.replacing = true;
      try { if (await beforeSwitch("new")) await transition(epoch); }
      finally { state.replacing = false; }
      return { cancelled: true };
    };
    runtime.switchSession = async (file, options) => {
      const epoch = state.epoch;
      if (!current(epoch) || state.replacing) return { cancelled: true };
      state.replacing = true;
      try {
        const target = await ports.history.target(file, birth.cwd);
        if (!current(epoch)) return { cancelled: true };
        if (target.id === birth.id && target.mode === "personal") return await sameBirthSwitch(file, options);
        if (options && Object.values(options).some(value => value !== undefined))
          throw new StoreError("INVALID_REQUEST", "Cross-birth resume cannot carry callbacks or cwd overrides");
        if (await beforeSwitch("resume", file)) await transition(epoch, file);
        return { cancelled: true };
      } finally { state.replacing = false; }
    };
  };
  const showHistory = () => {
    const ctx = state.context, epoch = state.epoch;
    if (!ctx || !current(epoch)) return;
    void ctx.ui.custom<void>((tui, _theme, keybindings, done) => {
      const load = async (_progress: unknown, signal?: AbortSignal) => {
        const found = [];
        for (const entry of ports.history.directories(birth.cwd)) {
          signal?.throwIfAborted();
          const sessions = await SessionManager.listAll(entry.dir, undefined, signal);
          found.push(...sessions.map(info => ({ ...info, name: `[${entry.mode === "personal" ? "Personal" : "Society"}] ${info.name ?? ""}`.trim() })));
        }
        return current(epoch) ? found.sort((a, b) => b.modified.getTime() - a.modified.getTime()) : [];
      };
      return new SessionSelectorComponent(load, load, file => { done(); if (current(epoch)) void state.runtime!.switchSession(file)
        .catch(error => { if (current(epoch)) ctx.ui.notify(String(error), "error"); }); },
        done, () => { done(); if (current(epoch)) void adaptInteractiveMode(state.mode!).shutdown(); }, () => tui.requestRender(),
        { keybindings, showRenameHint: false }, state.runtime!.session.sessionFile);
    }).catch(error => { if (current(epoch)) ctx.ui.notify(String(error), "error"); });
  };
  return { society, bindRuntime, showHistory };
}
