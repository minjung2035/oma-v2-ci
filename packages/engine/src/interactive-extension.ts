import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { PI_BOUNDARY_PREFIX } from '@oma/protocol/delivery-boundary';
import { UNSEEN_EXCEPT_LAYOUT } from '@oma/domain/unseen-text';
import { adaptInteractiveUi } from './pi-compat/interactive-ui.js';
import { ownedEditor } from './pi-compat/prompt-editor.js';
import { brandHeader, brandFooter } from './open-tui-brand.js';
import type { EnginePresentation } from './presentation.js';
import type { OpenTuiBrand } from '@oma/contracts/presentation';
import type { InteractiveView } from './interactive-view.js';
import type { InteractiveState, InteractiveOutputs } from './interactive-state.js';
import type { InteractiveInput } from './interactive-input.js';
import type { createInteractiveSelections } from './interactive-selections.js';
import type { createInteractiveEvents } from './interactive-events.js';
import type { ProjectSessionDirectories } from './session-directories.js';
export function createInteractiveExtension(input: {
    presentation: EnginePresentation;
}, view: InteractiveView, state: InteractiveState, human: InteractiveInput, choices: ReturnType<typeof createInteractiveSelections>, events: ReturnType<typeof createInteractiveEvents>, sessionDirs: ProjectSessionDirectories, limits: {
    frameBytes: number;
}, brand: OpenTuiBrand, outputs: InteractiveOutputs, withSearchTools: typeof import('./pi-compat/interactive-tools.js').withSearchTools): ExtensionFactory {
    const { ui, rpc } = outputs;
    return pi => {
        // B1: OMA's own compact tool rows, through the public renderer seam. The
        // wire names and the registry stay the engine's; only the drawing is
        // OMA's, and Pi's own renderers still draw a row's opened body.
        const compact = input.presentation.createCompactTools();
        pi.registerToolRenderer(compact.resolver);
        pi.on("agent_start", () => compact.agentStarted());
        pi.on("agent_end", () => compact.agentEnded());
        pi.on("tool_execution_start", event => compact.toolStarted(event.toolCallId));
        pi.on("tool_execution_end", event => compact.toolEnded(event.toolCallId));
        pi.registerMarkdownTransformer(markdown => markdown.replace(UNSEEN_EXCEPT_LAYOUT, ""));
        pi.registerCommand("oma", {
            description: "Open oma settings: Dashboard, Config, Mail (also Ctrl+X)", handler: async () => {
                view.openPanel();
            }
        });
        pi.registerCommand("society", {
            description: "Choose Personal or Society before starting a conversation", handler: choices.chooseSessionMode
        });
        // Listed by the engine's /hotkeys; the editor itself answers the key first.
        pi.registerShortcut("ctrl+x", {
            description: "Open oma settings (Dashboard, Config, Mail)", handler: async () => {
                view.openPanel();
            }
        });
        pi.on("model_select", () => {
            view.defer(choices.reportEngine);
        });
        pi.on("thinking_level_select", () => {
            view.defer(choices.reportEngine);
        });
        // BL2: the ask_user_question presenter. It reads `context` at request
        // time, so a question asked while no session context is live resolves as
        // a structured cancel, and a session boundary can never strand one.
        input.presentation.registerQuestions(pi, {
            context: () => view.context
        });
        pi.on("session_start", (_event, ctx) => {
            if (view.stopping || view.quitting)
                return;
            view.leave();
            view.context = ctx;
            const searchCwd = ctx.cwd;
            ctx.ui.addAutocompleteProvider(current => withSearchTools(current, searchCwd));
            view.applyQueueWidget();
            if (state.runtime) {
                events.follow(state.runtime.session);
                if (view.ready)
                    choices.reportEngine();
            }
            view.releaseUi = adaptInteractiveUi(ctx.ui, {
                editor: factory => factory && ((tui, theme, keys) => {
                    view.editorInstalled = true;
                    return ownedEditor(factory(tui, theme, keys), {
                        submit: human.submit, isCommand: human.isCommand, thinkingVisibility: human.thinkingVisibility, extensionCommand: human.extensionCommand, panel: view.openPanel, suggest: human.suggest,
                        frameBytes: limits.frameBytes,
                        refuse: () => ctx.ui.notify("Input exceeds the allowed size; edit the draft before submitting.", "warning"),
                        pasteImage: () => ctx.ui.notify("Pasted images are not sent; an oma prompt is text only.", "warning")
                    });
                }),
                header: factory => factory && ((tui, theme) => {
                    const inner = factory(tui, theme);
                    return {
                        render: (width: number) => brandHeader(inner.render(width), brand, text => theme.fg("accent", text)),
                        invalidate: () => inner.invalidate(), dispose: () => inner.dispose?.()
                    };
                }),
                footer: factory => factory && ((tui, theme, data) => {
                    const inner = factory(tui, theme, data);
                    return {
                        render: (width: number) => brandFooter(inner.render(width), brand),
                        invalidate: () => inner.invalidate(), dispose: () => inner.dispose?.()
                    };
                }),
                notify: (message, level, upstream) => {
                    if (message.startsWith(PI_BOUNDARY_PREFIX)) {
                        rpc.send({
                            type: "extension_ui_request", method: "notify", message, notifyType: level ?? "info"
                        });
                    }
                    else
                        upstream(message, level);
                },
            });
            // An invisible widget is the extension API's one path to the terminal's
            // frame request; bound, a running tool row repaints its dot instead of
            // being rebuilt each pulse.
            ctx.ui.setWidget("oma-compact-frame", tui => {
                compact.bindRender(() => tui.requestRender());
                return {
                    render: () => [], invalidate() {
                    }, dispose() {
                        compact.bindRender(undefined);
                    }
                };
            }, {
                placement: "belowEditor"
            });
        });
        pi.on("session_shutdown", event => {
            compact.bindRender(undefined);
            compact.reset(event.reason !== "reload");
            view.leave();
            // Leaving Pi (Ctrl+C twice, Ctrl+D, /quit) is leaving oma.
            if (event.reason === "quit") {
                view.quitting = true;
                sessionDirs.close();
                ui.send({
                    type: "quit"
                });
            }
        });
    };
}
