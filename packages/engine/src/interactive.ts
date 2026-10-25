/** Principal interactive composition; feature owners retain their own lifetimes. */
import { InteractiveMode } from '@earendil-works/pi-coding-agent';
import { createRequire } from 'node:module';
import { Socket } from 'node:net';
import { dirname, join } from 'node:path';
import type { EngineSettingsFiles } from './pi-compat/settings-files.js';
import type { EnginePresentation } from './presentation.js';
import { PI_RESUME_HINT } from './pi-compat/env.js';
import { adaptInteractiveMode, createInteractiveTerminal } from './pi-compat/interactive-mode.js';
import { preparePiInteractive } from './pi-presentation.js';
import { ExtensionModules } from './extension-modules.js';
import { ProjectSessionDirectories } from './session-directories.js';
import { InteractiveChannel, INTERACTIVE_UI_FD } from './interactive-channel.js';
import { interactiveConfiguration } from './interactive-configuration.js';
import { createInteractiveView } from './interactive-view.js';
import { createInteractiveInput } from './interactive-input.js';
import { createInteractiveSelections } from './interactive-selections.js';
import { createInteractiveEvents } from './interactive-events.js';
import { createInteractiveExtension } from './interactive-extension.js';
import { startInteractiveRuntime } from './interactive-runtime.js';
import { createInteractiveRpc } from './interactive-rpc.js';
import { ownInteractiveRuntime, rejectInteractiveStartup } from './interactive-lifetime.js';
import type { InteractiveState, InteractiveOutputs } from './interactive-state.js';
export { effortLevelsOf, PI_BUILTIN_COMMANDS, NOT_IN_OMA, omaExportCommand, ENGINE_EXTENSION_ADVICE, omaCrashHint, omaTerminalTitle, isDeliveryCommand, rpcPromptOptions } from './interactive-commands.js';
export async function runInteractive(input: {
    readonly version: string;
    readonly settings: EngineSettingsFiles;
    readonly presentation: EnginePresentation;
}): Promise<void> {
    const { withSearchTools } = await import('./pi-compat/interactive-tools.js');
    const config = interactiveConfiguration(input);
    const { limits, argv, flag, agentDir, projectDir, brand } = config;
    preparePiInteractive(input.settings, agentDir);
    const state: InteractiveState = {
        runtime: undefined, mode: undefined, controls: undefined
    };
    const outputs: InteractiveOutputs = {
        ui: {
            send: event => ui.send(event)
        }, rpc: {
            send: event => rpc.send(event)
        }
    };
    const view = createInteractiveView(input, outputs.ui);
    const ownSessions = flag('--session-dir');
    const sessionDirs = new ProjectSessionDirectories(ownSessions, limits.receiptWaitSeconds, event => outputs.ui.send(event));
    const die = () => {
        if (view.stopping)
            return;
        view.stopping = true;
        view.leave();
        sessionDirs.close();
        process.kill(process.pid, 'SIGTERM');
    };
    let choices: ReturnType<typeof createInteractiveSelections>;
    const human = createInteractiveInput(view, state, outputs.ui, limits, {
        showResume: () => choices.showResume()
    });
    choices = createInteractiveSelections(view, state, outputs.ui, human, sessionDirs, ownSessions, brand);
    const events = createInteractiveEvents(outputs.rpc);
    const ui = new InteractiveChannel(new Socket({
        fd: INTERACTIVE_UI_FD, readable: true, writable: true
    }), limits, event => {
        if (view.stopping || view.quitting)
            return;
        if (human.receive(event))
            return;
        if (event.type === 'session_dirs')
            sessionDirs.accept(event);
        else
            view.receive(event, choices);
    }, die);
    const boundary = createInteractiveExtension(input, view, state, human, choices, events, sessionDirs, limits, brand, outputs, withSearchTools);
    const write = process.stdout.write.bind(process.stdout) as (chunk: unknown, ...rest: unknown[]) => boolean;
    process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => view.quitting && String(chunk).includes(PI_RESUME_HINT) ? true : write(chunk, ...rest)) as typeof process.stdout.write;
    const rpc = createInteractiveRpc(view, state, limits, die);
    const packageResolver = createRequire(import.meta.url);
    const upstream = join(dirname(packageResolver.resolve('pi-open-tui/package.json')), 'extensions/open-tui/index.ts');
    const extensions = [...argv.flatMap((value, index) => value === '-e' ? [argv[index + 1]!] : []), upstream];
    const modules = new ExtensionModules(extensions);
    try {
        state.runtime = await startInteractiveRuntime(input, config, view, state, modules, extensions, upstream, boundary, ownSessions);
        const owned = state.runtime;
        ownInteractiveRuntime(owned, view, modules, sessionDirs);
        events.follow(owned.session);
        const terminal = createInteractiveTerminal();
        const mode = state.mode = new InteractiveMode(owned, {
            terminal,
            tuiMode: 'fullscreen'
        });
        try {
            const controls = state.controls = adaptInteractiveMode(mode);
            controls.configureSociety(owned, projectDir, terminal);
            await mode.init();
            if (!view.editorInstalled)
                throw new Error('Open TUI did not install its editor');
        }
        catch (error) {
            view.stopping = true;
            view.leave();
            sessionDirs.close();
            mode.stop();
            throw error;
        }
        if (view.stopping || view.quitting) {
            mode.stop();
            await owned.dispose();
            return;
        }
        view.ready = true;
        ui.send({
            type: 'ready'
        });
        choices.reportEngine();
        view.flushNotices();
    }
    catch (error) {
        return rejectInteractiveStartup(error, state, modules);
    }
}
