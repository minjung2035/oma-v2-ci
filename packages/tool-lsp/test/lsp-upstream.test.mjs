/** Direct coverage of the vendored pi-lsp runtime OMA delegates to: the
 * LSP client handshake, the diagnostics runner, route selection, and the
 * command probe. These run against the bundle's own fixture server, which
 * is part of the verified payload -- the same bytes that ship in dist. */
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LspClient } from "../dist/vendor/pi-lsp/runtime/lsp-client.js";
import { runDiagnostics, runFix } from "../dist/vendor/pi-lsp/runtime/runner.js";
import { selectDiagnosticRoutes } from "../dist/vendor/pi-lsp/runtime/routes.js";
import { commandExists } from "../dist/vendor/pi-lsp/runtime/command.js";
import { applyTextEdits, collectWorkspaceEdits, hasOverlappingTextEdits } from "../dist/vendor/pi-lsp/runtime/text-edits.js";
const BUNDLE = fileURLToPath(new URL("../dist/vendor/pi-lsp/", import.meta.url));
const FIXTURE = join(BUNDLE, "upstream-tests", "fixtures", "diagnostics-server.mjs");
/** OMA's hostile fixture lives outside the byte-pinned bundle. */
const HOSTILE = fileURLToPath(new URL("./fixtures/lsp-hostile-server.mjs", import.meta.url));
function tmp(t) {
    const dir = mkdtempSync(join(tmpdir(), "oma-lsp-upstream-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
}
/** Same adapter shape upstream tests use, narrowed to the .tfix extension. */
function fixtureAdapter(scenario, expectedFiles) {
    return {
        name: `fixture-${scenario}`,
        isDefault: false,
        defaultCommand: {
            command: process.execPath,
            args: [FIXTURE, scenario, ...(expectedFiles === undefined ? [] : [String(expectedFiles)])],
        },
        missingCommandHint: "Node is required for the test fixture.",
        extensions: [".tfix"],
        skipDirectories: new Set(),
        diagnosticsSettleMs: 30,
        isSupportedFile: (filePath) => filePath.endsWith(".tfix"),
        languageIdFor: () => "tfix",
    };
}
/** The same adapter shape, but the spawned server is OMA's hostile fixture. */
function hostileAdapter(scenario) {
    return {
        ...fixtureAdapter(scenario),
        name: `hostile-${scenario}`,
        defaultCommand: { command: process.execPath, args: [HOSTILE, scenario] },
    };
}
test("BL1: LspClient: one process per client -- initialize, answer, shutdown, exit", async (t) => {
    const root = tmp(t);
    writeFileSync(join(root, "note.tfix"), "hello\n");
    const log = join(root, "spawns.log");
    const runClient = async () => {
        // The vendored merge is deny-by-default now: adapter.env IS the
        // child's whole environment, so the test channel the fixture reads is
        // declared on the adapter instead of inherited from process.env.
        const adapter = { ...fixtureAdapter("pull-strict-optional-params"), env: { PI_LSP_TEST_LOG: log } };
        const client = new LspClient(adapter, adapter.defaultCommand, root, 10_000);
        try {
            await client.start();
            await client.initialize(root);
            const uri = pathToFileURL(join(root, "note.tfix")).href;
            client.didOpen(uri, "hello\n", "tfix");
            const diagnostics = await client.diagnostics(uri);
            assert.deepEqual(diagnostics.map((entry) => entry.message), ["strict pull diagnostic"]);
        }
        finally {
            client.close();
        }
    };
    await runClient();
    await runClient();
    const pids = new Set(readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line).pid));
    assert.equal(pids.size, 2, "two clients, two server processes -- the runtime never pools");
});
test("BL1: runDiagnostics reports the fixture's pull diagnostics with file details", async (t) => {
    const root = tmp(t);
    writeFileSync(join(root, "note.tfix"), "hello\n");
    const ctx = { ui: { setStatus() { } } };
    const adapter = fixtureAdapter("pull-strict-optional-params");
    const result = await runDiagnostics(adapter, { root, files: [join(root, "note.tfix")] }, 10_000, new AbortController().signal, ctx, "lsp");
    const text = result.content.map((part) => part.text ?? "").join("");
    assert.match(text, /strict pull diagnostic/);
    const details = result.details;
    assert.equal(details.summary?.diagnostics, 1);
});
// ---------------------------------------------------------------------------
// OMA divergences (F1): the vendored runtime carries the declared bounds --
// as honest degradation now, not refusals. The tests drive them through the
// runtime itself, not through the adapter.
test("BL1/F1: runDiagnostics truncates an over-bound pull diagnostic message with a visible marker", async (t) => {
    const root = tmp(t);
    writeFileSync(join(root, "note.tfix"), "hello\n");
    const ctx = { ui: { setStatus() { } } };
    // The vendored fixture's lifecycle-large path answers with a 60,000-char
    // diagnostic -- over OMA's 8,192-char bound, so the kept prefix renders
    // with the cut and the original length named.
    const result = await runDiagnostics(fixtureAdapter("lifecycle-large"), { root, files: [join(root, "note.tfix")] }, 10_000, new AbortController().signal, ctx, "lsp");
    const text = result.content.map((part) => part.text ?? "").join("");
    assert.match(text, /truncated at OMA's \d+-char bound; 60000 chars total/);
    const details = result.details;
    const message = details.files[0].diagnostics[0].message;
    assert.ok(message.length <= 8_300, `the message is the bound plus the marker, not 60k: ${message.length}`);
});
test("BL1/F1: runDiagnostics truncates a pull diagnostics flood with a visible count", async (t) => {
    const root = tmp(t);
    writeFileSync(join(root, "note.tfix"), "hello\n");
    const ctx = { ui: { setStatus() { } } };
    const result = await runDiagnostics(hostileAdapter("pull-flood"), { root, files: [join(root, "note.tfix")] }, 10_000, new AbortController().signal, ctx, "lsp");
    const details = result.details;
    const diagnostics = details.files[0].diagnostics;
    assert.equal(diagnostics.length, 1025, "1024 kept plus the marker element");
    const marker = diagnostics.at(-1);
    assert.equal(marker.source, "oma");
    assert.match(marker.message, /976 more diagnostic\(s\) for this file were dropped at OMA's \d+-diagnostic bound/);
});
test("BL1/F1: a pushed-diagnostics flood resolves as a marked truncation, and the count is not re-flagged", async (t) => {
    const root = tmp(t);
    writeFileSync(join(root, "note.tfix"), "hello\n");
    const ctx = { ui: { setStatus() { } } };
    // The pushed store flags at 1024+marker; the pull-path flag pass must
    // not count the marker again or it would report "1 more dropped".
    const result = await runDiagnostics(hostileAdapter("push-flood"), { root, files: [join(root, "note.tfix")] }, 10_000, new AbortController().signal, ctx, "lsp");
    const details = result.details;
    const diagnostics = details.files[0].diagnostics;
    assert.equal(diagnostics.length, 1025);
    assert.match(diagnostics.at(-1).message, /976 more diagnostic\(s\) for this file were dropped/);
});
test("BL1/F1: pushed publications past the tracked-document bound are dropped with a visible count", async (t) => {
    const root = tmp(t);
    writeFileSync(join(root, "note.tfix"), "hello\n");
    const ctx = { ui: { setStatus() { } } };
    // push-uri-flood pushes 4100 documents plus the opened file's own:
    // 4096 tracked, 5 dropped -- the resolved list names them. The scenario
    // advertises a pull provider whose empty answer is the ordering barrier:
    // the response is processed only after every pushed frame (client reads
    // are FIFO), so all five drops are counted before the grace wait settles
    // the dropped-and-never-stored file's list. A push-only settle raced the
    // flood's arrival and could name a partial drop count.
    const adapter = { ...hostileAdapter("push-uri-flood"), pullDiagnosticsGraceMs: 250 };
    const result = await runDiagnostics(adapter, { root, files: [join(root, "note.tfix")] }, 10_000, new AbortController().signal, ctx, "lsp");
    const details = result.details;
    const marker = details.files[0].diagnostics.at(-1);
    assert.match(marker.message, /5 pushed publication\(s\) were dropped at OMA's \d+-document bound/);
});
test("BL1/F1: a declared oversized Content-Length refuses only its request -- the same client still answers", async (t) => {
    const root = tmp(t);
    writeFileSync(join(root, "note.tfix"), "hello\n");
    writeFileSync(join(root, "other.tfix"), "hi\n");
    // oversized-then-serve delivers a COMPLETE oversized frame for the
    // first diagnostics request, then answers the next normally: the drop
    // is bounded and surgical, the wire realigns, and the server lives.
    const adapter = hostileAdapter("oversized-then-serve");
    const client = new LspClient(adapter, adapter.defaultCommand, root, 10_000);
    try {
        await client.start();
        await client.initialize(root);
        const uri = pathToFileURL(join(root, "note.tfix")).href;
        client.didOpen(uri, "hello\n", "tfix");
        await assert.rejects(client.diagnostics(uri), /declared \d+ bytes.*(refused|dropped)|request was refused|stays up/i);
        const second = pathToFileURL(join(root, "other.tfix")).href;
        client.didOpen(second, "hi\n", "tfix");
        const recovered = await client.diagnostics(second);
        assert.deepEqual(recovered.map((entry) => entry.message), ["recovered"], "a follow-up request on the same client answers -- the frame's drop realigned the wire");
    }
    finally {
        client.close();
    }
});
test("BL1/F1: an oversized frame whose body never arrives degrades the one file -- the call still reports it", async (t) => {
    const root = tmp(t);
    writeFileSync(join(root, "note.tfix"), "hello\n");
    const ctx = { ui: { setStatus() { } } };
    // oversized-frame declares 6MiB it never sends. The prefix carries no id
    // to sniff, so the frame is dropped and counted -- the pending request is
    // NOT blamed on it (a notification looks exactly the same); the request's
    // own timeout ends the file's entry with a marker that names both the
    // timeout and the dropped frame. The call resolves with that marker --
    // the teardown still skips a handshake the discarder cannot trust.
    const result = await runDiagnostics(hostileAdapter("oversized-frame"), { root, files: [join(root, "note.tfix")] }, 1_200, new AbortController().signal, ctx, "lsp");
    const text = result.content.map((part) => part.text ?? "").join("");
    assert.match(text, /diagnostics failed for this file/);
    assert.match(text, /timed out|did not return diagnostics/);
    assert.match(text, /1 oversized inbound frame\(s\) dropped/, "the drop count rides the failure tail");
});
test("BL1/F1: a stderr flood is a bounded sample, not an accumulator", async (t) => {
    const root = tmp(t);
    writeFileSync(join(root, "note.tfix"), "hello\n");
    const ctx = { ui: { setStatus() { } } };
    // The server floods past the 64KiB bound, then dies mid-request: the
    // file's entry degrades to an error marker whose message still attaches
    // the bounded stderr tail -- the cap and the truncation marker are both
    // observable in the rendered result.
    const result = await runDiagnostics(hostileAdapter("stderr-flood-exit"), { root, files: [join(root, "note.tfix")] }, 10_000, new AbortController().signal, ctx, "lsp");
    const text = result.content.map((part) => part.text ?? "").join("");
    assert.match(text, /diagnostics failed for this file.*exited/s);
    assert.match(text, /stderr truncated/, "the sample is marked truncated, not silently cut");
    assert.ok(text.length < 90_000, `bounded at 64KiB plus framing, not 200KiB: ${text.length}`);
});
test("BL1/F1: a code-action list resolves completely -- the count is not a bound", async (t) => {
    const root = tmp(t);
    writeFileSync(join(root, "note.tfix"), "hello\n");
    // 300 actions over the old 256 bound now resolve one by one -- each
    // round-trip is already bounded by the request timeout and the call's
    // progress-reset window, so a large legitimate set completes.
    const adapter = hostileAdapter("actions-flood");
    const client = new LspClient(adapter, adapter.defaultCommand, root, 30_000);
    try {
        await client.start();
        await client.initialize(root);
        const actions = Array.from({ length: 300 }, (_v, i) => ({ title: `a${i}`, kind: "source.fixAll" }));
        const resolved = await client.resolveActions(actions);
        assert.equal(resolved.length, 300, "every action answered its resolve round-trip");
    }
    finally {
        client.close();
    }
});
// ---------------------------------------------------------------------------
// OMA divergences round 2 (F1/F3/F4): accumulated edit bounds, the stderr
// sample's exact-boundary edge, and the post-spawn error kill.
test("BL1/F1 round 2: one action's documentChanges flood is refused inside collection", async (t) => {
    const root = tmp(t);
    writeFileSync(join(root, "note.tfix"), "hello\n");
    const ctx = { ui: { setStatus() { } } };
    await assert.rejects(runFix(hostileAdapter("edits-documentchanges-flood"), { root, path: "note.tfix" }, 10_000, new AbortController().signal, ctx, "lsp"), /2048|edits.*bound/i);
});
test("BL1/F1 round 2: the accumulated edit count across actions is bounded", async (t) => {
    const root = tmp(t);
    writeFileSync(join(root, "note.tfix"), "hello\n");
    const ctx = { ui: { setStatus() { } } };
    // Two actions each carrying the per-action bound of edits total 4096 --
    // over the accumulated bound the call fails instead of building the list.
    await assert.rejects(runFix(hostileAdapter("edits-flood"), { root, path: "note.tfix" }, 10_000, new AbortController().signal, ctx, "lsp"), /workspace edits.*2048|2048.*workspace edits|bound/i);
});
test("BL1/F1 round 2: the accumulated replacement bytes across actions are bounded", async (t) => {
    const root = tmp(t);
    writeFileSync(join(root, "note.tfix"), "hello\n");
    const ctx = { ui: { setStatus() { } } };
    // Each resolve frame is under the 4MiB inbound bound; the byte flood is
    // the accumulation -- two 3MiB newTexts in one call.
    await assert.rejects(runFix(hostileAdapter("edit-bytes-flood"), { root, path: "note.tfix" }, 10_000, new AbortController().signal, ctx, "lsp"), /bytes|bound/i);
});
test("BL1/F1 round 2: edits exactly at the bound still apply -- the bound is not the refusal of work", async (t) => {
    const root = tmp(t);
    writeFileSync(join(root, "note.tfix"), "hello\n");
    const ctx = { ui: { setStatus() { } } };
    const result = await runFix(hostileAdapter("edits-at-bound"), { root, path: "note.tfix" }, 30_000, new AbortController().signal, ctx, "lsp");
    const details = result.details;
    assert.equal(details.changed, true);
    assert.equal(details.edits?.length, 2048);
    assert.match(details.text ?? "", /^x{2048}hello\n$/);
});
test("BL1/F1 round 2: collectWorkspaceEdits refuses an over-bound list without building it", () => {
    const uri = "file:///tmp/a.tfix";
    const edit = (n) => ({ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: "x".repeat(n) });
    // changes map: the over-bound list is refused.
    assert.throws(() => collectWorkspaceEdits({ changes: { [uri]: Array.from({ length: 2049 }, () => edit(1)) } }, uri), /2048|bound/i);
    // documentChanges: the refusal lands mid-collection, not after a flatMap
    // materialized the whole list.
    assert.throws(() => collectWorkspaceEdits({
        documentChanges: [
            { textDocument: { uri: "file:///other" }, edits: Array.from({ length: 4096 }, () => edit(1)) },
            { textDocument: { uri }, edits: Array.from({ length: 2049 }, () => edit(1)) },
        ],
    }, uri), /2048|bound/i);
    // At the bound the list collects normally.
    assert.equal(collectWorkspaceEdits({ changes: { [uri]: Array.from({ length: 2048 }, () => edit(1)) } }, uri).length, 2048);
});
test("BL1/F1 round 2: the overlap sweep reaches the same verdicts the pair scan did", () => {
    const text = "one\ntwo\nthree\nfour\n";
    const edit = (sl, sc, el, ec) => ({
        range: { start: { line: sl, character: sc }, end: { line: el, character: ec } },
        newText: "x",
    });
    const insert = (line, character) => edit(line, character, line, character);
    // Overlapping non-empty ranges conflict, wherever they sit in the list.
    assert.equal(hasOverlappingTextEdits(text, [edit(0, 0, 0, 3), edit(2, 0, 3, 0), edit(0, 2, 0, 4)]), true);
    assert.equal(hasOverlappingTextEdits(text, [edit(1, 0, 1, 3), edit(0, 0, 2, 1)]), true, "nested ranges conflict");
    // An insert strictly inside a replacement conflicts; at its edges it does not.
    assert.equal(hasOverlappingTextEdits(text, [edit(0, 0, 1, 0), insert(0, 2)]), true);
    assert.equal(hasOverlappingTextEdits(text, [edit(0, 0, 1, 0), insert(0, 0)]), false, "insert at a range's start is an edge, not an interior");
    assert.equal(hasOverlappingTextEdits(text, [edit(0, 0, 1, 0), insert(1, 0)]), false, "insert at a range's end is an edge, not an interior");
    // Inserts never conflict, even at the same offset.
    assert.equal(hasOverlappingTextEdits(text, [insert(1, 1), insert(1, 1), insert(0, 0)]), false);
    // Adjacent non-empty ranges do not conflict.
    assert.equal(hasOverlappingTextEdits(text, [edit(0, 0, 1, 0), edit(1, 0, 2, 0)]), false);
    // An insert at the same offset a range starts at is an edge, not an
    // interior -- even when that range reaches the greatest end in the list.
    assert.equal(hasOverlappingTextEdits(text, [insert(0, 4), edit(1, 0, 3, 0)]), false);
    // ...but an insert one character earlier lands strictly inside it.
    assert.equal(hasOverlappingTextEdits(text, [insert(0, 4), edit(1, 0, 3, 0), edit(0, 0, 1, 1)]), true, "an interior insert still conflicts even when a later range starts at the same offset");
});
test("BL1/F1 round 2: single-pass apply produces the reverse-sorted application's output", () => {
    const text = "one\ntwo\nthree\n";
    const edit = (sl, sc, el, ec, newText) => ({
        range: { start: { line: sl, character: sc }, end: { line: el, character: ec } },
        newText,
    });
    // A replacement plus inserts at both of its edges and one inside another line.
    const edits = [
        edit(0, 0, 0, 3, "ONE"),
        edit(2, 0, 2, 0, "!"),
        edit(1, 0, 1, 0, "?"),
        edit(0, 0, 0, 0, ">"),
        edit(0, 3, 0, 3, "<"),
    ];
    assert.equal(applyTextEdits(text, edits), ">ONE<\n?two\n!three\n");
    // Two inserts at the same offset keep list order -- the reverse-sorted
    // application produced earlier-indexed text first, and so does this.
    assert.equal(applyTextEdits("ab", [edit(0, 1, 0, 1, "1"), edit(0, 1, 0, 1, "2")]), "a12b");
    // Adjacent replacements concatenate exactly like the old code's.
    assert.equal(applyTextEdits(text, [edit(0, 0, 0, 3, "ONE"), edit(1, 0, 1, 3, "TWO")]), "ONE\nTWO\nthree\n");
});
test("BL1/F3 round 2: a stderr sample that lands exactly on the bound still marks a later drop", async () => {
    // Exercise the current bundle's stderr truncation boundary directly.
    const { appendStderrSample } = await import("../dist/vendor/pi-lsp/runtime/lsp-client.js");
    const bound = 64 * 1024;
    // Exact landing: nothing was dropped yet, so no marker -- the bug this
    // round fixed silently dropped every chunk after this state.
    const exact = appendStderrSample({ sample: "x".repeat(bound - 3), dropped: false }, "abc");
    assert.deepEqual(exact, { sample: "x".repeat(bound - 3) + "abc", dropped: false });
    const over = appendStderrSample(exact, "one more byte");
    assert.equal(over.dropped, true);
    assert.match(over.sample, /stderr truncated/);
    assert.ok(over.sample.length <= bound + 100, `the marked sample itself stays bounded: ${over.sample.length}`);
    // Once dropped, the marker is sticky -- more chunks never unmark it.
    const marked = appendStderrSample({ sample: "s", dropped: false }, "z".repeat(bound));
    assert.equal(marked.dropped, true);
    assert.equal(appendStderrSample(marked, "extra"), marked, "a dropped sample keeps its marker");
});
test("BL1/F4 round 2: a post-spawn child 'error' event kills the process -- the client never orphans", async (t) => {
    const root = tmp(t);
    writeFileSync(join(root, "note.tfix"), "hello\n");
    // The permanent 'error' listener is a private-field closure; the child
    // object it was registered on is captured through the prototype seam so
    // the test can raise exactly the event a real post-spawn failure raises.
    const { ChildProcess } = await import("node:child_process");
    const realOn = ChildProcess.prototype.on;
    let captured;
    ChildProcess.prototype.on = function (event, listener) {
        if (event === "error")
            captured = this;
        return realOn.call(this, event, listener);
    };
    const adapter = fixtureAdapter("pull-strict-optional-params");
    const client = new LspClient(adapter, adapter.defaultCommand, root, 10_000);
    try {
        await client.start();
        await client.initialize(root);
        assert.ok(captured, "the permanent error listener is registered");
        const child = captured;
        const uri = pathToFileURL(join(root, "note.tfix")).href;
        client.didOpen(uri, "hello\n", "tfix");
        const pending = client.diagnostics(uri);
        child.emit("error", new Error("injected post-spawn failure"));
        await assert.rejects(pending, /process error|injected/);
        assert.equal(child.killed, true, "the error path kills the child -- clearing the refs alone left it running");
        // The cleared bookkeeping makes shutdown() return early; the kill above
        // is what guarantees there is no orphan left for the session to drain.
        await client.shutdown();
        await once(child, "exit");
    }
    finally {
        ChildProcess.prototype.on = realOn;
        client.close();
    }
});
test("BL1: selectDiagnosticRoutes marks an uninstalled default server skipped, never clean", async (t) => {
    const root = tmp(t);
    mkdirSync(join(root, "sub"), { recursive: true });
    writeFileSync(join(root, "sub", "a.ghost"), "x\n");
    const ghost = {
        ...fixtureAdapter("pull-strict-optional-params"),
        name: "ghost",
        isDefault: true,
        defaultCommand: { command: "oma-no-such-binary", args: [] },
        extensions: [".ghost"],
        isSupportedFile: (filePath) => filePath.endsWith(".ghost"),
    };
    const { routes, skipped } = selectDiagnosticRoutes([ghost], { root }, 50);
    assert.equal(routes.length, 0);
    assert.equal(skipped.length, 1);
    assert.match(skipped[0].reason, /command missing/);
    // An explicitly selected missing server is not pre-skipped -- it is tried
    // and the client's start surfaces the missing command.
    const explicit = selectDiagnosticRoutes([ghost], { root, paths: ["sub/a.ghost"], server: "ghost" }, 50);
    assert.equal(explicit.routes.length, 1);
    assert.equal(commandExists("oma-no-such-binary", root, undefined), false);
});
// ---------------------------------------------------------------------------
// OMA divergences round 3 (UX-38 residuals): stdin backpressure in the
// didOpen loop, per-file settled results, correct tail-marker accounting,
// URI-drop counts on every return path, and surgical oversized-frame
// attribution.
test("BL1/F-4: a backpressured didOpen reports it and didDrain settles the write", async (t) => {
    const root = tmp(t);
    writeFileSync(join(root, "note.tfix"), "hello\n");
    // slow-drain pauses stdin ~350ms after the first didOpen frame, so a
    // 1MiB second write buffers instead of reaching the wire: the write
    // returns false, didDrain() waits, and the resume completes the call.
    const adapter = hostileAdapter("slow-drain");
    const client = new LspClient(adapter, adapter.defaultCommand, root, 30_000);
    try {
        await client.start();
        await client.initialize(root);
        const first = pathToFileURL(join(root, "note.tfix")).href;
        const second = pathToFileURL(join(root, "big.tfix")).href;
        client.didOpen(first, "hello\n", "tfix");
        const buffered = client.didOpen(second, "x".repeat(1024 * 1024), "tfix");
        assert.equal(buffered, false, "a 1MiB frame past the stream's buffer reports backpressure");
        // The cast keeps this file compiling against a bundle that predates
        // the export -- the missing method is itself the regression.
        await client.didDrain();
        const diagnostics = await client.diagnostics(second);
        assert.deepEqual(diagnostics.map((entry) => entry.message), ["pull answer"]);
    }
    finally {
        client.close();
    }
});
test("BL1/F-4: the open loop waits for drain -- a corpus past the pipe completes against a slow reader", async (t) => {
    const root = tmp(t);
    const files = ["a.tfix", "b.tfix", "c.tfix"].map(name => join(root, name));
    for (const file of files)
        writeFileSync(file, "y".repeat(768 * 1024));
    const ctx = { ui: { setStatus() { } } };
    // Three ~768KiB didOpens into a server that stops reading for 350ms:
    // without the drain wait the corpus piles into this process's memory;
    // with it the call still completes once the server resumes.
    const result = await runDiagnostics(hostileAdapter("slow-drain"), { root, files }, 30_000, new AbortController().signal, ctx, "lsp");
    const details = result.details;
    assert.equal(details.summary?.files, 3);
    assert.equal(details.summary?.diagnostics, 3, "every file answered once the drain resumed");
});
test("BL1/F-4: a server that never drains is a bounded failure, not a hang", async (t) => {
    const root = tmp(t);
    // stdin-stall stops reading after the first didOpen: the second file's
    // 1MiB write backpressures and the drain wait hits the request budget.
    writeFileSync(join(root, "note.tfix"), "hello\n");
    writeFileSync(join(root, "big.tfix"), "x".repeat(1024 * 1024));
    const ctx = { ui: { setStatus() { } } };
    const started = Date.now();
    await assert.rejects(runDiagnostics(hostileAdapter("stdin-stall"), { root, files: [join(root, "note.tfix"), join(root, "big.tfix")] }, 900, new AbortController().signal, ctx, "lsp"), /did not drain|stdin closed|stdin failed|not reading/i);
    assert.ok(Date.now() - started < 20_000, "the drain budget bounded the wait");
});
test("BL1/F-4: an abort mid-drain settles the wait and reports as the abort", async (t) => {
    const root = tmp(t);
    writeFileSync(join(root, "note.tfix"), "hello\n");
    writeFileSync(join(root, "big.tfix"), "x".repeat(1024 * 1024));
    const ctx = { ui: { setStatus() { } } };
    const controller = new AbortController();
    const call = runDiagnostics(hostileAdapter("stdin-stall"), { root, files: [join(root, "note.tfix"), join(root, "big.tfix")] }, 30_000, controller.signal, ctx, "lsp");
    setTimeout(() => controller.abort(), 150);
    await assert.rejects(call, /aborted/i);
});
test("BL1/F-5: one file's timeout degrades to a per-file marker -- the answered files keep their results", async (t) => {
    const root = tmp(t);
    const files = ["a.tfix", "b.tfix", "c.tfix", "d.tfix"].map(name => join(root, name));
    for (const file of files)
        writeFileSync(file, "x\n");
    const ctx = { ui: { setStatus() { } } };
    // partial-answers replies to the first two diagnostics requests and lets
    // the rest hang: the whole call resolves -- timed-out files carry their
    // own error markers, the answered files keep their real diagnostics.
    const result = await runDiagnostics(hostileAdapter("partial-answers"), { root, files }, 900, new AbortController().signal, ctx, "lsp");
    const details = result.details;
    assert.equal(details.files.length, 4, "every file's entry is present -- none lost to the timeout");
    assert.deepEqual(details.files.slice(0, 2).map(entry => entry.diagnostics.map((d) => d.message)), [["answered 1"], ["answered 2"]]);
    for (const entry of details.files.slice(2)) {
        assert.equal(entry.diagnostics[0].code, "oma/error");
        assert.match(entry.diagnostics[0].message, /diagnostics failed for this file.*timed out/s);
    }
    const text = result.content.map((part) => part.text ?? "").join("");
    assert.match(text, /answered 1/);
    assert.match(text, /diagnostics failed for this file/);
});
test("BL1/F-3: an oversized NOTIFICATION is dropped and counted -- the pending request is not blamed", async (t) => {
    const root = tmp(t);
    writeFileSync(join(root, "note.tfix"), "hello\n");
    writeFileSync(join(root, "other.tfix"), "hi\n");
    // oversized-notification sends a complete 5MiB window/logMessage frame
    // (no id to sniff) while the diagnostics request pends: the old code
    // refused the sole pending request for a frame that was not answering
    // it; now the frame is dropped, counted, and the request is answered.
    const adapter = hostileAdapter("oversized-notification");
    const client = new LspClient(adapter, adapter.defaultCommand, root, 1_200);
    try {
        await client.start();
        await client.initialize(root);
        const first = pathToFileURL(join(root, "note.tfix")).href;
        const second = pathToFileURL(join(root, "other.tfix")).href;
        client.didOpen(first, "hello\n", "tfix");
        client.didOpen(second, "hi\n", "tfix");
        const diagnostics = await client.diagnostics(first);
        assert.deepEqual(diagnostics.map((entry) => entry.message), ["answer after the dropped notification"], "the pending request survived the unidentifiable oversized frame");
        // The drop is counted, not silent: the next request's own failure tail
        // (this one hangs unanswered past the request budget) reports it.
        await assert.rejects(client.diagnostics(second), /timed out.*1 oversized inbound frame\(s\) dropped/s);
    }
    finally {
        client.close();
    }
});
test("BL1/F-1: a truncated list plus a URI-drop marker re-flag correctly -- both markers survive", async (t) => {
    const root = tmp(t);
    writeFileSync(join(root, "note.tfix"), "hello\n");
    const ctx = { ui: { setStatus() { } } };
    // push-flood-uri-flood stores the opened file's own 2000-diagnostic
    // publication (truncated to 1024+marker at store), overflows the
    // tracked-document bound (5 drops), then republishes. The scenario's
    // empty pull answer is the ordering barrier: the response resolves only
    // after every pushed frame is already stored and counted (the client's
    // reads are FIFO), so the settle composes the complete state instead of
    // racing ~930KB of flood against the settle window -- the push-only form
    // of this fixture resolved mid-delivery with drops still uncounted.
    // The resolved list is [1024 real, truncation marker, URI-drop marker];
    // the runner's flag pass must strip BOTH trailing markers before
    // counting -- counting only the last one misread the earlier marker as
    // a real diagnostic and sliced them both off, reporting a phantom
    // "1 more" drop and losing the real counts.
    const adapter = { ...hostileAdapter("push-flood-uri-flood"), pullDiagnosticsGraceMs: 250 };
    const result = await runDiagnostics(adapter, { root, files: [join(root, "note.tfix")] }, 30_000, new AbortController().signal, ctx, "lsp");
    const details = result.details;
    const diagnostics = details.files[0].diagnostics;
    assert.equal(diagnostics.length, 1026, "1024 real + truncation marker + URI-drop marker");
    assert.match(diagnostics.at(-2).message, /976 more diagnostic\(s\) for this file were dropped at OMA's \d+-diagnostic bound/);
    assert.match(diagnostics.at(-1).message, /5 pushed publication\(s\) were dropped at OMA's \d+-document bound/);
});
test("BL1/F-2: a pull diagnostics answer still reports the URI-bound drops", async (t) => {
    const root = tmp(t);
    writeFileSync(join(root, "note.tfix"), "hello\n");
    const ctx = { ui: { setStatus() { } } };
    // pull-uri-flood overflows the tracked-document bound while the pull
    // request is in flight; the answered list takes the early return, which
    // used to skip the marker entirely -- the drops were silently invisible.
    const result = await runDiagnostics(hostileAdapter("pull-uri-flood"), { root, files: [join(root, "note.tfix")] }, 30_000, new AbortController().signal, ctx, "lsp");
    const details = result.details;
    const diagnostics = details.files[0].diagnostics;
    assert.equal(diagnostics.at(0).message, "pull answer", "the pull answer itself is kept");
    assert.match(diagnostics.at(-1).message, /5 pushed publication\(s\) were dropped at OMA's \d+-document bound/);
});
test("BL1/F-2: a waiter timeout reports the drops the wire already took", async (t) => {
    const root = tmp(t);
    writeFileSync(join(root, "note.tfix"), "hello\n");
    const ctx = { ui: { setStatus() { } } };
    // uri-flood-timeout fills the tracked map (4 drops) but never publishes
    // for the opened file: the waiter times out and the failure -- carried
    // on the file's degrade marker -- names the drops it already took.
    const result = await runDiagnostics(hostileAdapter("uri-flood-timeout"), { root, files: [join(root, "note.tfix")] }, 1_200, new AbortController().signal, ctx, "lsp");
    const text = result.content.map((part) => part.text ?? "").join("");
    assert.match(text, /did not return diagnostics for .*before timeout/s);
    assert.match(text, /4 pushed-diagnostic publication\(s\) dropped/, "the timeout tail reports the counted drops");
});
test("BL1/F-6: OMA's markers are never sent to the server inside the codeAction context", async (t) => {
    const root = tmp(t);
    writeFileSync(join(root, "note.tfix"), "hello\n");
    const ctx = { ui: { setStatus() { } } };
    // marker-context answers diagnostics with a 2000-entry flood (the list
    // OMA hands codeActions is 1024 real + 1 truncation marker), then echoes
    // the context's diagnostics count inside the resolved edit. If a marker
    // ever leaked into the context the count would be 1025.
    const result = await runFix(hostileAdapter("marker-context"), { root, path: "note.tfix" }, 30_000, new AbortController().signal, ctx, "lsp");
    const details = result.details;
    assert.match(details.text ?? "", /context-diagnostics=1024\b/);
});
