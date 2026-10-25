/** Actual pinned SDK private-file compatibility probes. No provider or native Mac qualification. */
import test from "node:test";
import assert from "node:assert/strict";
test("Open TUI: every command the engine lists as built in reaches the engine, not the model", async () => {
    const { PI_BUILTIN_COMMANDS } = await import("@oma/engine/interactive");
    // The engine's own list, read from its file: the mirror must cover it.
    const engine = new URL("./core/slash-commands.js", import.meta.resolve("@earendil-works/pi-coding-agent"));
    const { BUILTIN_SLASH_COMMANDS } = await import(engine.href);
    const missing = BUILTIN_SLASH_COMMANDS.map(command => command.name).filter(name => !PI_BUILTIN_COMMANDS.has(name));
    assert.deepEqual(missing, []);
});
test("oma's identity: /export writes to the Human's project under oma's name, as the engine's own parser reads it", async () => {
    const { omaExportCommand } = await import("@oma/engine/interactive");
    const engine = new URL("./modes/interactive/interactive-mode.js", import.meta.resolve("@earendil-works/pi-coding-agent"));
    const { InteractiveMode } = await import(engine.href);
    const parse = (command) => InteractiveMode.prototype.getPathCommandArgument.call({}, command, "/export");
    const session = "/state/oma/proj-1/principal/sessions/2026-09-29_abc.jsonl";
    const cases = [
        [undefined, "/home/me/proj", "/home/me/proj/oma-session-2026-09-29_abc.html"],
        ["out.html", "/home/me/proj", "/home/me/proj/out.html"],
        ["notes/s.jsonl", "/home/me/proj", "/home/me/proj/notes/s.jsonl"],
        [undefined, "/home/me/my proj", "/home/me/my proj/oma-session-2026-09-29_abc.html"],
        ["/tmp/x.html", "/home/me/proj", null],
        ["~/x.html", "/home/me/proj", null],
    ];
    for (const [given, project, expected] of cases) {
        const command = omaExportCommand(given, project, session);
        if (expected === null) {
            assert.equal(command, null, String(given));
            continue;
        }
        assert.equal(parse(command), expected, `${String(given)} in ${project}`);
    }
    assert.equal(omaExportCommand(undefined, "/home/me/proj", undefined), null, "an unsaved session is the engine's to refuse");
});
test("oma's identity: a crash's extension advice and the terminal title say oma, not the engine's CLI", async () => {
    const { ENGINE_EXTENSION_ADVICE, omaCrashHint, omaTerminalTitle } = await import("@oma/engine/interactive");
    const engine = new URL("./modes/interactive/interactive-mode.js", import.meta.resolve("@earendil-works/pi-coding-agent"));
    const { formatCrashExtensionHint } = await import(engine.href);
    for (const matches of [["/ext/a.ts"], ["/ext/a.ts", "/ext/b.ts"]]) {
        const words = formatCrashExtensionHint(matches);
        assert.match(words, ENGINE_EXTENSION_ADVICE, "the engine's advice changed; oma's replacement no longer finds it");
        const said = omaCrashHint(words);
        assert.doesNotMatch(said, /pi config|pi -ne/);
        assert.match(said, /Ctrl\+X > Config > Extensions/);
        for (const match of matches)
            assert.ok(said.includes(match), "the extension a crash points at is still named");
    }
    assert.equal(omaCrashHint(undefined), undefined);
    assert.equal(omaTerminalTitle(undefined, "/home/me/proj"), "oma - proj");
    assert.equal(omaTerminalTitle("Alpha\x07\x1b]0;x", "/home/me/proj"), "oma - Alpha]0;x - proj", "a session name cannot end the title's escape");
});
