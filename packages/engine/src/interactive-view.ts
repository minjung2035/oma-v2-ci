import { DynamicBorder, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { UNSEEN_EXCEPT_LAYOUT } from '@oma/domain/unseen-text';
import type { EnginePresentation } from './presentation.js';
import type { InteractiveOutput } from './interactive-state.js';
import type { PiEvent } from './pi-rpc.js';
export function createInteractiveView(input: {
    readonly presentation: EnginePresentation;
}, ui: InteractiveOutput) {
    let editorInstalled = false;
    let context: ExtensionContext | undefined;
    let releaseUi: (() => void) | undefined;
    let ready = false;
    const notices: {
        text: string;
        level: "info" | "warning" | "error";
    }[] = [];
    const notify = (text: string, level: "info" | "warning" | "error"): void => {
        const clean = text.replace(UNSEEN_EXCEPT_LAYOUT, "");
        if (context && ready)
            context.ui.notify(clean, level);
        else
            notices.push({
                text: clean, level
            });
    };
    let panelOpen = false;
    let panelDone: (() => void) | undefined;
    let panelLines: string[] = [];
    let redraw: (() => void) | undefined;
    // B3: the waiting queue is the session's fact; these are only its latest
    // picture, repainted on every snapshot and re-applied across reloads.
    let queuedPrompts: readonly string[] = [];
    let queuedTotal = 0;
    const applyQueueWidget = (): void => {
        if (!context)
            return;
        const prompts = queuedPrompts, total = queuedTotal;
        context.ui.setWidget("oma-queue", prompts.length === 0 ? undefined : (_tui, theme) => {
            const rows = [`Queued (${total}) — sent in order:`,
                ...prompts.map((text, index) => ` ${index + 1}. ${text}`),
                ...(total > prompts.length ? [` +${total - prompts.length} more`] : [])];
            return {
                render: (width: number) => rows.map(row => theme.fg("muted", row.length > width ? `${row.slice(0, Math.max(0, width - 1))}…` : row)),
                invalidate() {
                }
            };
        }, {
            placement: "aboveEditor"
        });
    };
    let stopping = false;
    let quitting = false;
    // P0-4: deferred UI work belongs to one session, never its replacement.
    let uiEpoch = 0;
    const uiTimers = new Set<ReturnType<typeof setTimeout>>();
    const currentUi = (epoch: number): boolean => !stopping && !quitting && context !== undefined && epoch === uiEpoch;
    const leaveUi = (): void => {
        uiEpoch++;
        for (const timer of uiTimers)
            clearTimeout(timer);
        uiTimers.clear();
        const done = panelDone;
        panelDone = undefined;
        redraw = undefined;
        panelOpen = false;
        panelLines = [];
        releaseUi?.();
        releaseUi = undefined;
        context = undefined;
        done?.();
    };
    const deferUi = (action: () => void): void => {
        const epoch = uiEpoch;
        if (!currentUi(epoch))
            return;
        const timer = setTimeout(() => {
            if (!uiTimers.delete(timer) || !currentUi(epoch))
                return;
            action();
        }, 0);
        uiTimers.add(timer);
    };
    const openPanel = (): void => {
        const epoch = uiEpoch;
        if (!context || !currentUi(epoch) || panelOpen)
            return;
        panelOpen = true;
        void context.ui.custom<void>((tui, theme, _keys, done) => {
            panelDone = () => done();
            redraw = () => tui.requestRender();
            const border = new DynamicBorder(text => theme.fg("borderAccent", text));
            // The panel takes the editor's place, as the engine's own selectors do.
            const rows = (): number => Math.max(10, Math.min(tui.terminal.rows - 6, 32));
            ui.send({
                type: "panel_open", columns: tui.terminal.columns, rows: rows()
            });
            let previous = "";
            return {
                render(width: number) {
                    if (!currentUi(epoch))
                        return [];
                    const size = `${width}/${rows()}`;
                    if (size !== previous) {
                        previous = size;
                        ui.send({
                            type: "panel_size", columns: width, rows: rows()
                        });
                    }
                    return [...border.render(width), ...input.presentation.stylePanel(panelLines, theme), ...border.render(width)];
                },
                invalidate() {
                },
                handleInput(data: string) {
                    if (currentUi(epoch))
                        ui.send({
                            type: "panel_key", data
                        });
                },
            };
        }).finally(() => {
            if (epoch !== uiEpoch)
                return;
            panelOpen = false;
            panelDone = undefined;
            redraw = undefined;
        });
    };
    const receive = (event: PiEvent, choices: {
        choosePrincipalModel(): Promise<void>;
        chooseWorkerModel(): Promise<void>;
    }): void => {
        const { choosePrincipalModel, chooseWorkerModel } = choices;
        if (event.type === 'queued_prompts' && Array.isArray(event.prompts) && event.prompts.every((line: unknown) => typeof line === 'string')) {
            queuedPrompts = event.prompts;
            const total = event.total;
            queuedTotal = typeof total === "number" && total >= queuedPrompts.length ? total : queuedPrompts.length;
            applyQueueWidget();
        }
        else if (event.type === 'notice' && typeof event.text === 'string')
            notify(event.text, 'info');
        else if (event.type === 'engine_command' && (event.command === 'principal-model' || event.command === 'worker-model')) {
            // DR24: the engine's own lists take the screen the panel leaves -- the
            // model, then its effort, in one go -- and give oma's settings back.
            const epoch = uiEpoch;
            panelDone?.();
            const choose = event.command === "principal-model" ? choosePrincipalModel : chooseWorkerModel;
            deferUi(() => {
                void choose().catch(error => {
                    if (currentUi(epoch))
                        notify(error instanceof Error ? error.message : String(error), "error");
                }).finally(() => {
                    if (currentUi(epoch))
                        deferUi(openPanel);
                });
            });
        }
        else if (event.type === 'panel_frame' && Array.isArray(event.lines) && event.lines.every(x => typeof x === 'string')) {
            panelLines = event.lines;
            redraw?.();
            if (event.open === false)
                panelDone?.();
        }
    };
    return {
        get context() {
            return context;
        }, set context(value: ExtensionContext | undefined) {
            context = value;
        }, get epoch() {
            return uiEpoch;
        },
        get ready() {
            return ready;
        }, set ready(value: boolean) {
            ready = value;
        }, get stopping() {
            return stopping;
        }, set stopping(value: boolean) {
            stopping = value;
        },
        get quitting() {
            return quitting;
        }, set quitting(value: boolean) {
            quitting = value;
        }, get editorInstalled() {
            return editorInstalled;
        }, set editorInstalled(value: boolean) {
            editorInstalled = value;
        },
        get releaseUi() {
            return releaseUi;
        }, set releaseUi(value: (() => void) | undefined) {
            releaseUi = value;
        }, get panelDone() {
            return panelDone;
        },
        current: currentUi, leave: leaveUi, defer: deferUi, notify, applyQueueWidget, openPanel, receive,
        flushNotices() {
            for (const { text, level } of notices.splice(0))
                context?.ui.notify(text, level);
        },
    };
}
export type InteractiveView = ReturnType<typeof createInteractiveView>;
