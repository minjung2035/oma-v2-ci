import type { InteractiveRuntime, InteractiveState } from './interactive-state.js';
import type { InteractiveView } from './interactive-view.js';
import type { ExtensionModules } from './extension-modules.js';
import type { ProjectSessionDirectories } from './session-directories.js';
/** One actual runtime disposal shared by every caller; no signal/EOF substitutes for it. */
export function ownInteractiveRuntime(owned: InteractiveRuntime, view: InteractiveView, modules: ExtensionModules, sessionDirs: ProjectSessionDirectories): void {
    const dispose = owned.dispose.bind(owned);
    let disposal: Promise<void> | undefined;
    owned.dispose = (): Promise<void> => disposal ??= (async () => {
        view.quitting = true;
        view.leave();
        const errors: unknown[] = [];
        try {
            await owned.session.abort();
        }
        catch (error) {
            errors.push(error);
        }
        try {
            await dispose();
        }
        catch (error) {
            errors.push(error);
        }
        try {
            modules.close();
        }
        catch (error) {
            errors.push(error);
        }
        try {
            sessionDirs.close();
        }
        catch (error) {
            errors.push(error);
        }
        if (errors.length === 1)
            throw errors[0];
        if (errors.length > 1)
            throw new AggregateError(errors, 'Interactive disposal failed');
    })();
}
export async function rejectInteractiveStartup(error: unknown, state: InteractiveState, modules: ExtensionModules): Promise<never> {
    const errors: unknown[] = [error];
    try {
        await state.runtime?.dispose();
    }
    catch (cleanup) {
        errors.push(cleanup);
    }
    if (state.runtime === undefined)
        try {
            modules.close();
        }
        catch (cleanup) {
            errors.push(cleanup);
        }
    if (errors.length > 1)
        throw new AggregateError(errors, 'Interactive startup and cleanup failed');
    throw error;
}
