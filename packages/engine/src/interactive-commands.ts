import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { UNSEEN } from '@oma/domain/unseen-text';
import { PI_BUILTIN_COMMANDS } from './pi-compat/commands.js';
/** The effort levels the engine offers for a model, as its own effort list
 * does (the engine's getSupportedThinkingLevels); a test holds this to it. */
export const effortLevelsOf = getSupportedThinkingLevels;
// The engine's own commands (A3): the mirror lives in the compat boundary and
// is held to the engine's list by test/interactive-input.test.ts.
export { PI_BUILTIN_COMMANDS };
/** How oma describes the engine's commands whose own words name the engine as
 * the product. */
export const COMMAND_WORDS: Readonly<Record<string, string>> = Object.freeze({
    quit: "Quit oma",
    changelog: "Show the bundled engine's changelog",
    new: "Start a new oma session (its own conversation, mail, workers and repositories)",
    resume: "Reopen an earlier oma session of this project",
});
/** The engine's commands that mean nothing in oma, or would mix another
 * product's state into it, and what is said instead. */
export const NOT_IN_OMA: Readonly<Record<string, string>> = Object.freeze({
    trust: "oma loads no project-local resources in a Society session -- its extensions, skills, prompts and context files come from its role and the installed packages -- so there is no project trust to grant.",
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
        if (sessionFile === undefined)
            return null;
        target = join(project, `oma-session-${basename(sessionFile, ".jsonl")}.html`);
    }
    else if (given.startsWith("~") || isAbsolute(given))
        return null;
    else
        target = resolve(project, given);
    if (!/\s/.test(target) && !/^["']/.test(target))
        return `/export ${target}`;
    const quote = !target.includes('"') ? '"' : !target.includes("'") ? "'" : null;
    return quote === null ? null : `/export ${quote}${target}${quote}`;
}
/** The engine's advice when a crash points at an extension names its own CLI
 * (`pi config`, `pi -ne`), which would change another Pi, not oma. A test
 * holds this to the engine's words. */
export const ENGINE_EXTENSION_ADVICE = /Try disabling (it|them) with `pi config`, or run `pi -ne` to confirm\./;
export function omaCrashHint(hint: string | undefined): string | undefined {
    return hint?.replace(ENGINE_EXTENSION_ADVICE, (_advice, pronoun: string) => `If you added ${pronoun}, turn ${pronoun} off in Ctrl+X > Config > Extensions to confirm.`);
}
/** The terminal's title names oma, the session and the Human's project, as
 * the header does; the engine's names itself and its working directory. */
export function omaTerminalTitle(session: string | undefined, project: string): string {
    const name = session?.replace(UNSEEN, "").trim();
    return ["oma", ...(name ? [name] : []), basename(project).replace(UNSEEN, "")].join(" - ");
}
/** The OMA-internal delivery command. Only the host's delivery sends it. */
export const DELIVERY_COMMAND = "oma-deliver";
export const commandName = (text: string): string => text.trim().slice(1).split(/\s/, 1)[0] ?? "";
/** True for a Human's typing of the delivery command. It is refused before it
 * could reach the engine: only OMA's own delivery, which owns the run it
 * starts, may send `/${DELIVERY_COMMAND}`. */
export function isDeliveryCommand(text: string): boolean {
    return text.trim().startsWith("/") && commandName(text) === DELIVERY_COMMAND;
}
/** The options every RPC prompt is sent with, Human's or the delivery's.
 * Expansion is the engine's own semantics: a Human's `/skill:name` or prompt
 * template expands the way Pi's own UI expands it, and a registered extension
 * command -- the delivery's `/oma-deliver` -- dispatches through the same
 * upstream flag that gates it (agent-session's prompt runs extension commands
 * only when expansion is on). */
export function rpcPromptOptions(_message: string): {
    readonly source: "rpc";
    readonly expandPromptTemplates: true;
} {
    return {
        source: "rpc", expandPromptTemplates: true
    };
}
