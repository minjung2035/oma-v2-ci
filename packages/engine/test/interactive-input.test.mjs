import test from "node:test";
import assert from "node:assert/strict";
import { ownedEditor } from "@oma/engine/pi-compat/prompt-editor";
import { CONVERSATION_BOUNDS } from "@oma/domain/surface-bounds";
test("Open TUI: Pi keeps its commands, shell and shortcuts; only a plain prompt goes to OMA", () => {
    let draft = "";
    const upstream = [];
    const keys = [];
    const history = [];
    let panels = 0;
    let refusals = 0;
    let pasteNotices = 0;
    const submitted = [];
    const original = {
        onSubmit: undefined,
        onPasteImage: undefined,
        actionHandlers: new Map(),
        addToHistory: (text) => { history.push(text); },
        getText: () => draft, getExpandedText: () => draft,
        setText: (value) => { draft = value; },
        render: () => ["original upstream rendering"], invalidate: () => { },
        // As Pi's editor does: Enter clears the draft and hands its text to onSubmit.
        handleInput(value) {
            keys.push(value);
            if (value === "\r") {
                const text = draft.trim();
                draft = "";
                this.onSubmit?.(text);
            }
            else if (!value.startsWith("\x1b") && !/[\x00-\x1f]/.test(value))
                draft += value;
        },
    };
    const editor = ownedEditor(original, {
        submit: value => submitted.push(value),
        isCommand: text => text.startsWith("!") || ["settings", "new"].includes(text.slice(1).split(" ")[0]) && text.startsWith("/"),
        panel: () => { panels += 1; }, refuse: () => { refusals += 1; }, frameBytes: 262144,
        pasteImage: () => { pasteNotices += 1; },
    });
    // Pi wires its own submit handler after the factory returns.
    editor.onSubmit = text => { upstream.push(text); };
    editor.onPasteImage = () => { throw new Error("image paste reached Pi"); };
    for (const line of ["Human draft", "/settings", "!ls -la", "/new", "/not-a-command here"]) {
        editor.handleInput(line);
        editor.handleInput("\r");
    }
    assert.deepEqual(submitted, ["Human draft", "/not-a-command here"]);
    assert.deepEqual(upstream, ["/settings", "!ls -la", "/new"]);
    assert.deepEqual(history, ["Human draft", "/not-a-command here"]);
    // A pasted image reaches no prompt, but the refusal is told, not silent:
    // Pi's own assignment was swallowed, so oma's notice is what fires.
    original.onPasteImage?.();
    assert.equal(pasteNotices, 1, "an image paste must surface a notice");
    // Pi's own keys reach Pi; Ctrl+X is the control panel.
    editor.handleInput("\x03");
    editor.handleInput("\x1b");
    assert.ok(keys.includes("\x03") && keys.includes("\x1b"));
    editor.handleInput("\x18");
    assert.equal(panels, 1);
    assert.equal(keys.includes("\x18"), false);
    // Every app action stays Pi's, except the follow-up key, which is a prompt of its own.
    const selected = [];
    original.actionHandlers.set("app.model.select", () => { selected.push("model"); });
    original.actionHandlers.set("app.message.followUp", () => { selected.push("follow-up"); });
    original.actionHandlers.get("app.model.select")();
    draft = "Follow up";
    original.actionHandlers.get("app.message.followUp")();
    assert.deepEqual(selected, ["model"]);
    assert.equal(submitted.at(-1), "Follow up");
    assert.equal(draft, "");
    assert.deepEqual(editor.render(80), ["original upstream rendering"]);
    // Bounds: an oversized edit is undone and cannot submit a retained prefix.
    draft = "Human draft";
    editor.handleInput("x".repeat(CONVERSATION_BOUNDS.promptBytes.value));
    assert.equal(draft, "Human draft");
    assert.equal(refusals, 1);
    const before = submitted.length;
    editor.handleInput("\r");
    assert.equal(submitted.length, before, "a rejected oversized edit cannot submit the retained prefix");
    assert.equal(draft, "Human draft", "a refused submission gives the draft back");
    editor.handleInput("!");
    editor.handleInput("\r");
    assert.equal(submitted.at(-1), "Human draft!");
    draft = "Human draft!";
    original.getText = () => "[paste marker]";
    original.getExpandedText = () => draft;
    editor.handleInput("x".repeat(CONVERSATION_BOUNDS.promptBytes.value));
    assert.equal(draft, "Human draft!", "overflow recovery restores expanded paste contents, not an orphaned marker");
});
test("B2: /thinking show and /thinking hide are OMA's; every other /thinking stays the engine's", () => {
    let draft = "";
    const upstream = [];
    const history = [];
    const submitted = [];
    const visibility = [];
    const original = {
        onSubmit: undefined,
        actionHandlers: new Map(),
        addToHistory: (text) => { history.push(text); },
        getText: () => draft, getExpandedText: () => draft,
        setText: (value) => { draft = value; },
        render: () => [], invalidate: () => { },
        handleInput(value) {
            if (value === "\r") {
                const text = draft.trim();
                draft = "";
                this.onSubmit?.(text);
            }
            else if (!value.startsWith("\x1b") && !/[\x00-\x1f]/.test(value))
                draft += value;
        },
    };
    const editor = ownedEditor(original, {
        submit: value => submitted.push(value),
        // The engine claims every slash line here: `thinking` is its builtin.
        isCommand: text => text.startsWith("/"),
        thinkingVisibility: text => {
            const trimmed = text.trim();
            if (trimmed !== "/thinking show" && trimmed !== "/thinking hide")
                return false;
            visibility.push(trimmed);
            return true;
        },
        panel: () => { }, refuse: () => { }, frameBytes: 262144, pasteImage: () => { },
    });
    editor.onSubmit = text => { upstream.push(text); };
    for (const line of ["/thinking show", "  /thinking hide  ", "/thinking", "/thinking high",
        "/thinking  show", "/thinking showall", "thinking show"]) {
        editor.handleInput(line);
        editor.handleInput("\r");
    }
    assert.deepEqual(visibility, ["/thinking show", "/thinking hide"], "the exact pair is consumed before built-in routing, whitespace around it tolerated");
    assert.deepEqual(upstream, ["/thinking", "/thinking high", "/thinking  show", "/thinking showall"], "bare /thinking, a level, and malformed variants still reach the engine");
    assert.deepEqual(submitted, ["thinking show"], "a bare word is still a prompt");
    assert.deepEqual(history, ["/thinking show", "/thinking hide", "thinking show"], "consumed commands land in the editor's history like any prompt does");
});
test("B2: the deterministic set flips the engine's toggle only on a difference", async () => {
    const { setThinkingBlockHidden } = await import("@oma/engine/pi-compat/interactive-mode");
    let toggles = 0;
    const internals = { hideThinkingBlock: true, toggleThinkingBlockVisibility() { toggles += 1; this.hideThinkingBlock = !this.hideThinkingBlock; } };
    // OMA's default settings hide thinking; asking to hide again must not invert it.
    assert.equal(setThinkingBlockHidden({ isHidden: () => internals.hideThinkingBlock, toggle: () => internals.toggleThinkingBlockVisibility() }, true), false);
    assert.equal(toggles, 0);
    assert.equal(internals.hideThinkingBlock, true);
    assert.equal(setThinkingBlockHidden({ isHidden: () => internals.hideThinkingBlock, toggle: () => internals.toggleThinkingBlockVisibility() }, false), true);
    assert.equal(internals.hideThinkingBlock, false);
    // And asking twice never accumulates: the second show is a no-op too.
    assert.equal(setThinkingBlockHidden({ isHidden: () => internals.hideThinkingBlock, toggle: () => internals.toggleThinkingBlockVisibility() }, false), false);
    assert.equal(toggles, 1);
    assert.equal(setThinkingBlockHidden({ isHidden: () => internals.hideThinkingBlock, toggle: () => internals.toggleThinkingBlockVisibility() }, true), true);
    assert.equal(internals.hideThinkingBlock, true);
});
test("a Human prompt keeps the engine's own expansion semantics; /oma-deliver stays refused", async () => {
    const { rpcPromptOptions, isDeliveryCommand } = await import("@oma/engine/interactive");
    // `/skill:name` and `/template` are suggested by the engine's autocomplete;
    // upstream's prompt expands them only when expandPromptTemplates is set --
    // the same flag that lets a registered extension command dispatch. The
    // delivery's `/oma-deliver` needs it too, so every RPC prompt gets it.
    for (const text of ["/skill:review check this", "/weekly-report", "an ordinary prompt", "/oma-deliver batch-1"]) {
        const options = rpcPromptOptions(text);
        assert.equal(options.expandPromptTemplates, true, `${text} must reach the engine with upstream expansion on`);
        assert.equal(options.source, "rpc");
    }
    // A Human's typing of the delivery command is refused before it can be sent.
    for (const text of ["/oma-deliver batch-1", "  /oma-deliver x  ", "/oma-deliver"])
        assert.equal(isDeliveryCommand(text), true, text);
    for (const text of ["/oma-deliverx", "/oma", "deliver /oma-deliver", ""])
        assert.equal(isDeliveryCommand(text), false, text);
    // And upstream really does gate command dispatch on the flag: the engine's
    // own source says extension commands run only when expansion is on.
    const engine = new URL("./core/agent-session.js", import.meta.resolve("@earendil-works/pi-coding-agent"));
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(engine, "utf8");
    assert.match(source, /if \(expandPromptTemplates && text\.startsWith\("\/"\)\)/, "upstream no longer gates extension commands on expandPromptTemplates -- /oma-deliver delivery would break");
});

test("oma's identity: the engine's commands that would send the session to its developers or bring another session in are refused", async () => {
    const { NOT_IN_OMA, PI_BUILTIN_COMMANDS } = await import("@oma/engine/interactive");
    for (const name of ["bug", "import", "trust"]) {
        assert.ok(PI_BUILTIN_COMMANDS.has(name), `${name} is not an engine command`);
        assert.match(NOT_IN_OMA[name] ?? "", /oma/, `/${name} reaches the engine in oma`);
    }
    // What stays the engine's own: sharing, exporting and the session commands oma answers itself.
    for (const name of ["share", "export", "new", "resume"])
        assert.equal(NOT_IN_OMA[name], undefined, name);
});


test("DR24: the engine's session keys open oma's sessions, and its command list says oma", async () => {
    const hosted = [];
    const upstream = [];
    let provided;
    const original = {
        onSubmit: undefined,
        actionHandlers: new Map(),
        getText: () => "", getExpandedText: () => "", setText: () => { },
        render: () => [], invalidate: () => { }, handleInput: () => { },
        setAutocompleteProvider(source) { provided = source; },
    };
    const editor = ownedEditor(original, {
        submit: () => { }, isCommand: () => true, panel: () => { }, refuse: () => { }, frameBytes: 262144, pasteImage: () => { },
        extensionCommand: text => { hosted.push(text); return true; },
        suggest: items => items.filter(item => item.value !== "oma-deliver").map(item => ({ ...item, description: `oma: ${item.value}` })),
    });
    editor.onSubmit = text => { upstream.push(text); };
    original.actionHandlers.set("app.session.new", () => { throw new Error("the engine's own new session ran"); });
    original.actionHandlers.set("app.session.resume", () => { throw new Error("the engine's own resume ran"); });
    original.actionHandlers.get("app.session.new")();
    original.actionHandlers.get("app.session.resume")();
    assert.deepEqual(hosted, ["/new", "/resume"]);
    assert.deepEqual(upstream, [], "a session key reached the engine's own command");
    editor.setAutocompleteProvider({
        getSuggestions: async () => ({ prefix: "/", items: [{ value: "quit", label: "quit", description: "Quit pi" },
                { value: "oma-deliver", label: "oma-deliver" }] }),
    });
    assert.deepEqual((await provided.getSuggestions()).items, [{ value: "quit", label: "quit", description: "oma: quit" }]);
});
