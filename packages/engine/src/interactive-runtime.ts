import { createAgentSessionRuntime, createAgentSessionServices, createAgentSessionFromServices, SessionManager, type ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { createEngineSettings } from './pi-compat/settings.js';
import type { EngineSettingsFiles } from './pi-compat/settings-files.js';
import type { ExtensionModules } from './extension-modules.js';
import type { InteractiveConfiguration } from './interactive-configuration.js';
import type { InteractiveView } from './interactive-view.js';
import type { InteractiveState } from './interactive-state.js';
export async function startInteractiveRuntime(input: {
    settings: EngineSettingsFiles;
}, config: InteractiveConfiguration, view: InteractiveView, state: InteractiveState, modules: ExtensionModules, extensions: string[], upstream: string, boundary: ExtensionFactory, ownSessions: string) {
    const { cwd, agentDir, argv, flag, flags } = config;
    return await createAgentSessionRuntime(async (options) => {
        modules!.refresh(extensions);
        const services = await createAgentSessionServices({
            ...options,
            settingsManager: createEngineSettings(input.settings, cwd, agentDir, {
                projectTrusted: false
            }), resourceLoaderOptions: {
                // Discovery stays explicit: only the role's pinned extensions load
                // (`-e`, never a scanned directory), while skills, prompt templates and
                // context files are discovered as Pi ships them -- the trusted core
                // extension then keeps only the context files inside the workspace.
                noExtensions: true,
                additionalExtensionPaths: extensions,
                // C18: the spawn passes each package resource as its own flag, the same
                // spelling Pi's CLI takes.
                additionalSkillPaths: flags("--skill"),
                additionalPromptTemplatePaths: flags("--prompt-template"),
                additionalThemePaths: flags("--theme"),
                extensionFactories: [boundary],
                // The role prompt replaces Pi's generated base prompt, the same as the
                // RPC session's argv does; an absent flag leaves the loader's own default.
                ...(argv.includes("--system-prompt") ? {
                    systemPrompt: flag("--system-prompt")
                } : {}),
                appendSystemPrompt: argv.includes("--append-system-prompt") ? [flag("--append-system-prompt")] : [],
                extensionsOverride: loaded => {
                    if (loaded.errors.length || !loaded.extensions.some(extension => extension.resolvedPath === upstream)) {
                        const error = new Error(`required interactive extensions could not be loaded: ${loaded.errors.length === 0 ? "Open TUI is missing"
                            : loaded.errors.map(failure => `${failure.path}: ${failure.error}`).join("; ")}`);
                        try {
                            loaded.runtime.invalidate();
                        }
                        catch (cleanup) {
                            throw new AggregateError([error, cleanup], "Interactive extension load and cleanup failed");
                        }
                        throw error;
                    }
                    // Presentation policy does not touch the registry: the tools Pi
                    // registered stay the objects Pi loaded, and the render seam below
                    // wraps the definition Pi resolves for display (A7).
                    // The boundary must wrap the public UI before upstream installs components.
                    const own = loaded.extensions.filter(extension => extension.path.startsWith("<inline:"));
                    return {
                        ...loaded, extensions: [...own, ...loaded.extensions.filter(extension => !extension.path.startsWith("<inline:"))]
                    };
                },
            }
        });
        const reload = services.resourceLoader.reload.bind(services.resourceLoader);
        services.resourceLoader.reload = async (options) => {
            modules!.refresh(extensions);
            await reload(options);
        };
        // Skills are discovered and their commands come with them: the engine's
        // persisted settings file carries no suppression (preparePiInteractive
        // scrubs the old pin), so no override is needed here.
        const modelName = argv.includes("--model") ? flag("--model") : undefined;
        const split = modelName?.indexOf("/") ?? -1;
        const model = modelName === undefined ? undefined
            : services.modelRuntime.getModel(modelName.slice(0, split), modelName.slice(split + 1));
        if (modelName !== undefined && !model)
            throw new Error(`configured model is unavailable: ${modelName}`);
        try {
            const created = await createAgentSessionFromServices({
                services, sessionManager: options.sessionManager, ...(model ? {
                    model
                } : {}),
                excludeTools: ["bash", "powershell"]
            });
            const reloadSession = created.session.reload.bind(created.session);
            created.session.reload = async (options) => {
                try {
                    await reloadSession(options);
                }
                catch (error) {
                    try {
                        services.resourceLoader.getExtensions().runtime.invalidate();
                    }
                    catch (cleanup) {
                        error = new AggregateError([error, cleanup], "Interactive reload and cleanup failed");
                    }
                    if (state.mode !== undefined)
                        await state.controls!.fail("Interactive reload failed", error);
                    throw error;
                }
            };
            return {
                ...created, services, diagnostics: services.diagnostics
            };
        }
        catch (error) {
            try {
                services.resourceLoader.getExtensions().runtime.invalidate();
            }
            catch (cleanup) {
                throw new AggregateError([error, cleanup], "Interactive creation and cleanup failed");
            }
            throw error;
        }
    }, {
        cwd, agentDir, sessionManager: process.env.OMA_SESSION_FILE
            // DR24: `/resume` reopened this session; otherwise the society's own latest.
            ? SessionManager.open(process.env.OMA_SESSION_FILE, ownSessions) : SessionManager.continueRecent(cwd, ownSessions)
    });
}
