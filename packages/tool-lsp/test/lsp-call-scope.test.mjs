import assert from "node:assert/strict";
import test from "node:test";
import { observeLspCall } from "../dist/lsp-call-scope.js";
function fixture(t) {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const adapter = {}, other = {}, caller = new AbortController();
    let listener = () => { };
    let released = 0;
    const scope = observeLspCall("diagnostics", caller.signal, 1000, 100, new Set([adapter]), callback => {
        listener = callback;
        return () => { released++; };
    });
    return { scope, caller, adapter, other, progress: (which) => listener(which), released: () => released };
}
test("DR40: LSP call observes only its own progress and never shortens a request timeout", t => {
    const f = fixture(t);
    t.after(() => f.scope.stop());
    t.mock.timers.tick(900);
    assert.equal(f.scope.signal.aborted, false);
    f.progress(f.adapter);
    t.mock.timers.tick(900);
    assert.equal(f.scope.signal.aborted, false);
    f.progress(f.other);
    t.mock.timers.tick(100);
    assert.equal(f.scope.signal.aborted, true);
    assert.throws(() => f.scope.rethrow(new Error("upstream abort")), /no LSP server activity for 1000ms/);
});
test("DR40: LSP call releases progress subscriptions exactly once and preserves caller cancellation", t => {
    const f = fixture(t), reason = new Error("caller cancellation");
    f.caller.abort(reason);
    t.mock.timers.tick(1000);
    assert.equal(f.scope.signal.reason, reason);
    assert.throws(() => f.scope.rethrow(reason), error => error === reason);
    f.scope.stop();
    f.scope.stop();
    f.progress(f.adapter);
    t.mock.timers.tick(10000);
    assert.equal(f.released(), 1);
});
