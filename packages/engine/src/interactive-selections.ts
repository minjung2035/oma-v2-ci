import { getSupportedThinkingLevels as effortLevelsOf } from '@earendil-works/pi-ai';
import { ModelSelectorComponent, ThinkingSelectorComponent, SessionSelectorComponent, SessionManager, type AgentSession, type ExtensionContext, type SessionInfo } from '@earendil-works/pi-coding-agent';
import { dirname } from 'node:path';
import type { ProjectSessionDirectories } from './session-directories.js';
import type { InteractiveView } from './interactive-view.js';
import type { InteractiveState, InteractiveOutput } from './interactive-state.js';
import type { InteractiveInput } from './interactive-input.js';
type EngineModel = NonNullable<AgentSession['model']>;
type EngineEffort = ConstructorParameters<typeof ThinkingSelectorComponent>[0];
export function createInteractiveSelections(view: InteractiveView, state: InteractiveState, ui: InteractiveOutput, human: Pick<InteractiveInput, 'pendingInput'>, sessionDirs: ProjectSessionDirectories, ownSessions: string, brand: {
    project: string;
}) {
    let modeSelectionPending = false;
    const chooseSessionMode = async (args: string, ctx: ExtensionContext): Promise<void> => {
        const epoch = view.epoch, session = state.runtime?.session;
        if (!session || !view.current(epoch) || modeSelectionPending)
            return;
        const unused = (): boolean => session.messages.length === 0 && ctx.isIdle() && !human.pendingInput;
        if (!unused()) {
            view.notify("Choose Personal or Society before starting a conversation. Use /new for a new session.", "warning");
            return;
        }
        modeSelectionPending = true;
        try {
            const picked = args.trim() || await ctx.ui.select("Session mode — Society", ["Society", "Personal"]);
            if (!view.current(epoch) || state.runtime?.session !== session || !unused() || picked === undefined || picked.toLowerCase() === "society")
                return;
            if (picked.toLowerCase() !== "personal") {
                view.notify("Use /society personal or /society society.", "warning");
                return;
            }
            const result = await session.extensionRunner.emit({
                type: "session_before_switch", reason: "new"
            });
            if (result?.cancel !== true && view.current(epoch) && state.runtime?.session === session && unused())
                ui.send({
                    type: "switch", mode: "personal"
                });
        }
        finally {
            modeSelectionPending = false;
        }
    };
    /** The engine's own model list: every model of every provider it is logged in to. */
    const chooseModel = (session: AgentSession, current: EngineModel | undefined): Promise<EngineModel | undefined> => view.context!.ui.custom<EngineModel | undefined>((tui, _theme, _keys, done) => new ModelSelectorComponent(tui, current, session.modelRuntime, session.scopedModels, model => done(model), () => done(undefined)));
    /** The engine's own effort list for a model; a model with one level has nothing to choose.
     * What is chosen here is always kept, so the list's "set as default" key
     * chooses as Enter does rather than doing nothing. */
    const chooseEffort = (current: string, levels: readonly string[]): Promise<string | undefined> => levels.length <= 1 ? Promise.resolve(levels[0]) : view.context!.ui.custom<string | undefined>((_tui, _theme, _keys, done) => new ThinkingSelectorComponent((levels.includes(current) ? current : levels[0]) as EngineEffort, [...levels] as EngineEffort[], level => done(level), () => done(undefined), level => done(level)));
    /** The Principal's model and effort: the engine's default, as its own lists
     * save one -- this session and the next. */
    const choosePrincipalModel = async (): Promise<void> => {
        const epoch = view.epoch, session = state.runtime?.session;
        if (!view.context || !session || !view.current(epoch))
            return;
        const model = await chooseModel(session, session.model);
        if (model === undefined || !view.current(epoch))
            return;
        await session.setModel(model, {
            persist: true
        });
        if (!view.current(epoch))
            return;
        const level = await chooseEffort(session.thinkingLevel, session.getAvailableThinkingLevels());
        if (!view.current(epoch))
            return;
        if (level !== undefined)
            session.setThinkingLevel(level as EngineEffort, {
                persist: true
            });
        reportEngine();
    };
    /** A Worker's model and effort, which oma saves in the project's settings. */
    const chooseWorkerModel = async (): Promise<void> => {
        const epoch = view.epoch, session = state.runtime?.session;
        if (!view.context || !session || !view.current(epoch))
            return;
        const same = "Same as the Principal", own = "Choose a model and effort";
        const kind = await view.context.ui.select("Worker model", [same, own]);
        if (!view.current(epoch))
            return;
        if (kind === same) {
            ui.send({
                type: "worker_model", same: true
            });
            return;
        }
        if (kind !== own)
            return;
        const model = await chooseModel(session, undefined);
        if (model === undefined || !view.current(epoch))
            return;
        const level = await chooseEffort(session.thinkingLevel, effortLevelsOf(model));
        if (level === undefined || !view.current(epoch))
            return;
        ui.send({
            type: "worker_model", provider: model.provider, model: model.id, thinking: level
        });
    };
    const reportEngine = (): void => {
        const current = state.runtime?.session;
        if (!current || !view.current(view.epoch))
            return;
        ui.send({
            type: "engine_state", model: current.model ? `${current.model.provider}/${current.model.id}` : "",
            thinking: current.thinkingLevel
        });
    };
    /** `/resume`: the engine's own session list, over every session of this
     * project. A session of this society is opened here, as the engine would;
     * another one is its society's, which the parent reopens whole. */
    const showResume = (): void => {
        const epoch = view.epoch;
        if (!view.context || !view.current(epoch))
            return;
        const project = brand.project;
        void view.context.ui.custom<void>((tui, _theme, keybindings, done) => {
            const load = async (_progress: unknown, signal?: AbortSignal): Promise<SessionInfo[]> => {
                if (!view.current(epoch))
                    return [];
                const snapshot = await sessionDirs.snapshot(signal);
                if (snapshot.error !== undefined && view.current(epoch))
                    view.notify(snapshot.error, "warning");
                const found: SessionInfo[] = [];
                for (const dir of snapshot.dirs) {
                    signal?.throwIfAborted();
                    if (!view.current(epoch))
                        return [];
                    try {
                        found.push(...await SessionManager.listAll(dir, undefined, signal));
                    }
                    catch {
                        signal?.throwIfAborted(); /* a session the list cannot read is not offered */
                    }
                }
                if (!view.current(epoch))
                    return [];
                return found.map(info => ({
                    ...info, cwd: project
                })).sort((a, b) => b.modified.getTime() - a.modified.getTime());
            };
            return new SessionSelectorComponent(load, load, path => {
                done();
                if (!view.current(epoch))
                    return;
                if (dirname(path) === ownSessions)
                    void state.runtime?.switchSession(path).catch(error => {
                        if (view.current(epoch))
                            view.notify(String(error), "error");
                    });
                else
                    ui.send({
                        type: "switch", session: path
                    });
            }, () => done(), () => {
                done();
                if (view.current(epoch))
                    ui.send({
                        type: "quit"
                    });
            }, () => {
                if (view.current(epoch))
                    tui.requestRender();
            }, {
                keybindings, showRenameHint: false
            }, state.runtime?.session.sessionFile);
        });
    };
    return {
        chooseSessionMode, choosePrincipalModel, chooseWorkerModel, showResume, reportEngine
    };
}
