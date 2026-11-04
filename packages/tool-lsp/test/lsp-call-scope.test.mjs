import assert from "node:assert/strict";
import test from "node:test";
import { observeLspCall, withLspScratch } from "../dist/lsp-call-scope.js";
import { performance } from "node:perf_hooks";
import { mkdirSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { removePrivateStateTree } from "@oma/tool-runtime/private-state";
function fixture(t) {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let now = performance.now();
    t.mock.method(performance, "now", () => now);
    const tick = ms => { now += ms; t.mock.timers.tick(ms); };
    const adapter = {}, other = {}, caller = new AbortController();
    let listener = () => { };
    let released = 0;
    const scope = observeLspCall("diagnostics", caller.signal, 1000, 100, new Set([adapter]), callback => {
        listener = callback;
        return () => { released++; };
    });
    return { scope, caller, adapter, other, tick, progress: (which) => listener(which), released: () => released };
}
test("001. LSP call observes only its own progress and never shortens a request timeout", t => {
    const f = fixture(t);
    t.after(() => f.scope.stop());
    f.tick(900);
    assert.equal(f.scope.signal.aborted, false);
    f.progress(f.adapter);
    f.tick(900);
    assert.equal(f.scope.signal.aborted, false);
    f.progress(f.other);
    f.tick(100);
    assert.equal(f.scope.signal.aborted, true);
    assert.throws(() => f.scope.rethrow(new Error("upstream abort")), /no LSP server activity for 1000ms/);
});
test("002. LSP call releases progress subscriptions exactly once and preserves caller cancellation", t => {
    const f = fixture(t), reason = new Error("caller cancellation");
    f.caller.abort(reason);
    f.tick(1000);
    assert.equal(f.scope.signal.reason, reason);
    assert.throws(() => f.scope.rethrow(reason), error => error === reason);
    f.scope.stop();
    f.scope.stop();
    f.progress(f.adapter);
    f.tick(10000);
    assert.equal(f.released(), 1);
});

test("003. A long real silence window never overflows into an immediate stall", async t => {
    const scope = observeLspCall("diagnostics", new AbortController().signal, 0x80000001, 100,
        new Set(), () => () => {});
    t.after(() => scope.stop());
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(scope.signal.aborted, false);
});

test("004. Read-only scratch descendants cannot replace a successful LSP result with cleanup failure", async t => {
    let directory;
    t.after(() => { if (directory) removePrivateStateTree(directory); });
    const result = await withLspScratch(async scratch => {
        directory = scratch;
        const child = join(scratch, "read-only"); mkdirSync(child);
        writeFileSync(join(child, "result"), "owned scratch"); chmodSync(child, 0o555);
        return "verified result";
    });
    assert.equal(result, "verified result"); assert.equal(existsSync(directory), false);
});
