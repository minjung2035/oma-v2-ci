import { humanPromptFitsFrame } from '@oma/domain/surface-bounds';
import { PI_BUILTIN_COMMANDS, NOT_IN_OMA, COMMAND_WORDS, DELIVERY_COMMAND, commandName, isDeliveryCommand } from './interactive-commands.js';
import type { Suggestion } from './pi-compat/prompt-editor.js';
import type { InteractiveView } from './interactive-view.js';
import type { InteractiveState, InteractiveOutput } from './interactive-state.js';
import type { PiEvent } from './pi-rpc.js';
export function createInteractiveInput(view: InteractiveView, state: InteractiveState, ui: InteractiveOutput, limits: {
    frameBytes: number;
}, choices: {
    showResume(): void;
}) {
    let inputSequence = 0;
    let pendingInput: {
        id: string;
        text: string;
    } | undefined;
    const submit = (text: string): void => {
        // The delivery command presents a broker-prepared batch; only OMA's
        // delivery, which owns the run it starts, sends it.
        if (isDeliveryCommand(text)) {
            if (view.context?.ui.getEditorText() === "")
                view.context.ui.setEditorText(text);
            view.notify(`/${DELIVERY_COMMAND} is sent only by OMA's mail delivery.`, "warning");
            return;
        }
        if (pendingInput) {
            if (view.context?.ui.getEditorText() === "")
                view.context.ui.setEditorText(text);
            view.notify("Waiting for the previous input to be accepted.", "warning");
            return;
        }
        if (!humanPromptFitsFrame(text, limits.frameBytes)) {
            if (view.context?.ui.getEditorText() === "")
                view.context.ui.setEditorText(text);
            view.notify("Input exceeds the allowed size.", "warning");
            return;
        }
        const id = `ui-${++inputSequence}`;
        pendingInput = {
            id, text
        };
        ui.send({
            type: "human_input", id, text
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
        if (!trimmed.startsWith("/"))
            return false;
        if (name === "new") {
            ui.send({
                type: "switch"
            });
            return true;
        }
        if (name === "resume") {
            choices.showResume();
            return true;
        }
        if (NOT_IN_OMA[name] !== undefined) {
            view.notify(NOT_IN_OMA[name]!, "info");
            return true;
        }
        if (name === DELIVERY_COMMAND || !state.runtime?.session.extensionRunner.getCommand(name))
            return false;
        void state.runtime.session.prompt(trimmed).catch(error => {
            view.notify(String(error), "error");
        });
        return true;
    };
    // B2: the exact pair is OMA's; the engine reads a `/thinking` argument as a
    // thinking level and would fail it. Bare `/thinking` and every other form
    // still reach the engine unchanged.
    const thinkingVisibility = (text: string): boolean => {
        const trimmed = text.trim();
        if (trimmed !== "/thinking show" && trimmed !== "/thinking hide")
            return false;
        const hidden = trimmed === "/thinking hide";
        // The editor can only exist after init built the mode, but a refused
        // claim still routes the line to the engine, so nothing is stranded.
        if (state.mode === undefined)
            return false;
        if (!state.controls?.setThinkingHidden(hidden))
            view.notify(`Thinking blocks: ${hidden ? "hidden" : "visible"}`, "info");
        return true;
    };
    // The command list says oma, lists nothing a Human cannot send, and drops
    // the `[t]` tag the engine gives extensions only because oma loads them from
    // its command line.
    const suggest = (items: readonly Suggestion[]): Suggestion[] => items
        .filter(item => item.value !== DELIVERY_COMMAND && NOT_IN_OMA[item.value] === undefined)
        .map(item => {
        const words = COMMAND_WORDS[item.value];
        const description = words ?? item.description?.replace(/^\[t\] ?/, "");
        return {
            ...item, ...(description === undefined ? {} : {
                description
            })
        };
    });
    const receive = (event: PiEvent): boolean => {
        if (event.type === 'input_result' && pendingInput && pendingInput.id === event.id) {
            const text = pendingInput.text;
            pendingInput = undefined;
            if (event.accepted !== true) {
                // The editor cleared the draft on Enter; a refused prompt comes back.
                if (view.context?.ui.getEditorText() === "")
                    view.context.ui.setEditorText(text);
                view.notify(typeof event.reason === "string" ? event.reason : "Input was not accepted", "error");
            }
            else if (event.queued === true)
                view.notify("Queued; it runs after the current response.", "info");
            return true;
        }
        if (event.type === 'return_prompt' && typeof event.text === 'string') {
            view.notify(`Unsent input: ${event.text}`, "error");
            if (view.context?.ui.getEditorText() === "")
                view.context.ui.setEditorText(event.text);
            return true;
        }
        return false;
    };
    return {
        submit, isCommand, extensionCommand, thinkingVisibility, suggest, receive, get pendingInput() {
            return pendingInput;
        }
    };
}
export type InteractiveInput = ReturnType<typeof createInteractiveInput>;
