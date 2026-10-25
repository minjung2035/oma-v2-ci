import test from "node:test";
import assert from "node:assert/strict";
import { displayCopy, safeToolPresentation } from "@oma/engine/interactive-display";
test("DR22: render copies remove untrusted controls without changing tool or receipt bytes", () => {
    const text = "한글\x1b[2J‮evil⁦\n👩‍💻";
    const value = { content: [{ type: "text", text }], details: { receipt: text } };
    const clean = displayCopy(value);
    assert.equal(value.content[0].text, text);
    assert.equal(value.details.receipt, text);
    assert.equal(clean.content[0].text, "한글[2Jevil\n👩‍💻");
    assert.equal(clean.details.receipt, clean.content[0].text);
    // The copy is a normal object: a renderer's hasOwnProperty, toString or
    // template interpolation must not meet a null-prototype record.
    assert.equal(Object.getPrototypeOf(clean), Object.prototype);
    assert.equal(clean.hasOwnProperty("content"), true);
    assert.doesNotThrow(() => `${clean}`);
    // And an own "__proto__" key in hostile args arrives as data, never as the
    // copy's prototype.
    const hostile = JSON.parse('{"__proto__": {"polluted": true}, "safe": "a"}');
    const hostileCopy = displayCopy(hostile);
    assert.equal(Object.getPrototypeOf(hostileCopy), Object.prototype);
    assert.deepEqual(hostileCopy["__proto__"], { polluted: true });
    const deep = {};
    let leaf = deep;
    for (let i = 0; i < 20000; i++) {
        const next = {};
        leaf.next = next;
        leaf = next;
    }
    leaf.text = text;
    leaf.loop = deep;
    assert.doesNotThrow(() => displayCopy(deep), "provider-controlled depth cannot overflow a recursive walk");
});
test("DR22: upstream tool renderers get sanitized copies but execute keeps its original arguments", () => {
    const observed = [];
    const original = {
        name: "example", label: "Example", description: "Test", parameters: {},
        execute: async () => ({ content: [], details: {} }),
        renderCall: (args) => { observed.push(args); return { render: () => [], invalidate() { } }; },
        renderResult: (value) => { observed.push(value); return { render: () => [], invalidate() { } }; },
    };
    const wrapped = safeToolPresentation(original);
    assert.equal(wrapped.execute, original.execute);
    const args = { path: "a‮b" };
    const result = { content: [{ type: "text", text: "a\x1b[2Jb" }], details: {} };
    const context = { args };
    wrapped.renderCall(args, {}, context);
    wrapped.renderResult(result, { expanded: false, isPartial: false }, {}, context);
    assert.equal(observed[0].path, "ab");
    assert.equal(observed[1].content[0].text, "a[2Jb");
    assert.equal(args.path, "a‮b");
    assert.equal(result.content[0].text, "a\x1b[2Jb");
});
