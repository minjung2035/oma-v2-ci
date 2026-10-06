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
import { LspClient } from "../src/extension/vendor/pi-lsp/runtime/lsp-client.js";
import { runDiagnostics, runFix } from "../src/extension/vendor/pi-lsp/runtime/runner.js";
import { selectDiagnosticRoutes } from "../src/extension/vendor/pi-lsp/runtime/routes.js";
import { commandExists } from "../src/extension/vendor/pi-lsp/runtime/command.js";
import { applyTextEdits, collectWorkspaceEdits, hasOverlappingTextEdits } from "../src/extension/vendor/pi-lsp/runtime/text-edits.js";

const BUNDLE = fileURLToPath(new URL("../../src/extension/vendor/pi-lsp/", import.meta.url));
const FIXTURE = join(BUNDLE, "upstream-tests", "fixtures", "diagnostics-server.mjs");
/** OMA's hostile fixture lives outside the byte-pinned bundle. */
const HOSTILE = fileURLToPath(new URL("../../test/fixtures/lsp-hostile-server.mjs", import.meta.url));

function tmp(t: import("node:test").TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "oma-lsp-upstream-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Same adapter shape upstream tests use, narrowed to the .tfix extension. */
function fixtureAdapter(scenario: string, expectedFiles?: number) {
  return {
    name: `fixture-${scenario}`,
    isDefault: false,
    defaultCommand: {
      command: process.execPath,
      args: [FIXTURE, scenario, ...(expectedFiles === undefined ? [] : [String(expectedFiles)])],
    },
    missingCommandHint: "Node is required for the test fixture.",
    extensions: [".tfix"],
    skipDirectories: new Set<string>(),
    diagnosticsSettleMs: 30,
    isSupportedFile: (filePath: string) => filePath.endsWith(".tfix"),
    languageIdFor: () => "tfix",
  };
}

/** The same adapter shape, but the spawned server is OMA's hostile fixture. */
function hostileAdapter(scenario: string) {
  return {
    ...fixtureAdapter(scenario),
    name: `hostile-${scenario}`,
    defaultCommand: { command: process.execPath, args: [HOSTILE, scenario] },
  };
}

test("BL1: LspClient: one process per client -- initialize, answer, shutdown, exit", async t => {
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
      assert.deepEqual(diagnostics.map((entry: { message: string }) => entry.message), ["strict pull diagnostic"]);
    } finally {
      client.close();
    }
  };
  await runClient();
  await runClient();
  const pids = new Set(readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line).pid as number));
  assert.equal(pids.size, 2, "two clients, two server processes -- the runtime never pools");
});

test("BL1: runDiagnostics reports the fixture's pull diagnostics with file details", async t => {
  const root = tmp(t);
  writeFileSync(join(root, "note.tfix"), "hello\n");
  const ctx = { ui: { setStatus() {} } };
  const adapter = fixtureAdapter("pull-strict-optional-params");
  const result = await runDiagnostics(adapter, { root, files: [join(root, "note.tfix")] }, 10_000, new AbortController().signal, ctx, "lsp");
  const text = result.content.map((part: { text?: string }) => part.text ?? "").join("");
  assert.match(text, /strict pull diagnostic/);
  const details = result.details as { summary?: { diagnostics?: number } };
  assert.equal(details.summary?.diagnostics, 1);
});

// ---------------------------------------------------------------------------
// OMA divergences (F1): the vendored runtime carries the declared bounds --
// the tests drive them through the runtime itself, not through the adapter.

test("BL1/F1: runDiagnostics refuses a pull diagnostic message over the bound", async t => {
  const root = tmp(t);
  writeFileSync(join(root, "note.tfix"), "hello\n");
  const ctx = { ui: { setStatus() {} } };
  // The vendored fixture's lifecycle-large path answers with a 60,000-char
  // diagnostic -- over OMA's 8,192-char bound, so the call fails rather than
  // formatting it.
  await assert.rejects(
    runDiagnostics(fixtureAdapter("lifecycle-large"), { root, files: [join(root, "note.tfix")] }, 10_000,
      new AbortController().signal, ctx, "lsp"),
    /60_000|60000|bound/);
});

test("BL1/F1: runDiagnostics refuses a pull diagnostics array over the count bound", async t => {
  const root = tmp(t);
  writeFileSync(join(root, "note.tfix"), "hello\n");
  const ctx = { ui: { setStatus() {} } };
  await assert.rejects(
    runDiagnostics(hostileAdapter("pull-flood"), { root, files: [join(root, "note.tfix")] }, 10_000,
      new AbortController().signal, ctx, "lsp"),
    /2000 diagnostics|bound/);
});

test("BL1/F1: a pushed-diagnostics flood fails the call inside the client", async t => {
  const root = tmp(t);
  writeFileSync(join(root, "note.tfix"), "hello\n");
  const ctx = { ui: { setStatus() {} } };
  await assert.rejects(
    runDiagnostics(hostileAdapter("push-flood"), { root, files: [join(root, "note.tfix")] }, 10_000,
      new AbortController().signal, ctx, "lsp"),
    /pushed 2000 diagnostics|bound/);
});

test("BL1/F1: a declared oversized Content-Length fails without buffering it", async t => {
  const root = tmp(t);
  writeFileSync(join(root, "note.tfix"), "hello\n");
  const ctx = { ui: { setStatus() {} } };
  await assert.rejects(
    runDiagnostics(hostileAdapter("oversized-frame"), { root, files: [join(root, "note.tfix")] }, 10_000,
      new AbortController().signal, ctx, "lsp"),
    /Content-Length|bound|invalid JSON-RPC/i);
});

test("BL1/F1: a stderr flood is a bounded sample, not an accumulator", async t => {
  const root = tmp(t);
  writeFileSync(join(root, "note.tfix"), "hello\n");
  const ctx = { ui: { setStatus() {} } };
  // The server floods past the 64KiB bound, then dies mid-request: the exit
  // path attaches the stderr tail, so both the cap and the truncation
  // marker are observable in the error.
  const error = await runDiagnostics(hostileAdapter("stderr-flood-exit"),
    { root, files: [join(root, "note.tfix")] }, 10_000, new AbortController().signal, ctx, "lsp")
    .then(() => { throw new Error("the flooded call must fail"); }, (caught: unknown) => caught as Error);
  assert.match(error.message, /exited/);
  assert.match(error.message, /stderr truncated/, "the sample is marked truncated, not silently cut");
  assert.ok(error.message.length < 80_000, `bounded at 64KiB plus framing, not 200KiB: ${error.message.length}`);
});

test("BL1/F1: a code-action list over the bound is refused before any resolve request", async t => {
  const root = tmp(t);
  writeFileSync(join(root, "note.tfix"), "hello\n");
  const adapter = hostileAdapter("actions-flood");
  const client = new LspClient(adapter, adapter.defaultCommand, root, 10_000);
  try {
    await client.start();
    await client.initialize(root);
    const actions = Array.from({ length: 300 }, (_v, i) => ({ title: `a${i}`, kind: "source.fixAll" }));
    await assert.rejects(client.resolveActions(actions as never), /300 code actions|256/);
  } finally {
    client.close();
  }
});

// ---------------------------------------------------------------------------
// OMA divergences round 2 (F1/F3/F4): accumulated edit bounds, the stderr
// sample's exact-boundary edge, and the post-spawn error kill.

test("BL1/F1 round 2: one action's documentChanges flood is refused inside collection", async t => {
  const root = tmp(t);
  writeFileSync(join(root, "note.tfix"), "hello\n");
  const ctx = { ui: { setStatus() {} } };
  await assert.rejects(
    runFix(hostileAdapter("edits-documentchanges-flood"), { root, path: "note.tfix" }, 10_000,
      new AbortController().signal, ctx, "lsp"),
    /2048|edits.*bound/i);
});

test("BL1/F1 round 2: the accumulated edit count across actions is bounded", async t => {
  const root = tmp(t);
  writeFileSync(join(root, "note.tfix"), "hello\n");
  const ctx = { ui: { setStatus() {} } };
  // Two actions each carrying the per-action bound of edits total 4096 --
  // over the accumulated bound the call fails instead of building the list.
  await assert.rejects(
    runFix(hostileAdapter("edits-flood"), { root, path: "note.tfix" }, 10_000,
      new AbortController().signal, ctx, "lsp"),
    /workspace edits.*2048|2048.*workspace edits|bound/i);
});

test("BL1/F1 round 2: the accumulated replacement bytes across actions are bounded", async t => {
  const root = tmp(t);
  writeFileSync(join(root, "note.tfix"), "hello\n");
  const ctx = { ui: { setStatus() {} } };
  // Each resolve frame is under the 4MiB inbound bound; the byte flood is
  // the accumulation -- two 3MiB newTexts in one call.
  await assert.rejects(
    runFix(hostileAdapter("edit-bytes-flood"), { root, path: "note.tfix" }, 10_000,
      new AbortController().signal, ctx, "lsp"),
    /bytes|bound/i);
});

test("BL1/F1 round 2: edits exactly at the bound still apply -- the bound is not the refusal of work", async t => {
  const root = tmp(t);
  writeFileSync(join(root, "note.tfix"), "hello\n");
  const ctx = { ui: { setStatus() {} } };
  const result = await runFix(hostileAdapter("edits-at-bound"), { root, path: "note.tfix" }, 30_000,
    new AbortController().signal, ctx, "lsp");
  const details = result.details as { changed: boolean; text?: string; edits?: unknown[] };
  assert.equal(details.changed, true);
  assert.equal(details.edits?.length, 2048);
  assert.match(details.text ?? "", /^x{2048}hello\n$/);
});

test("BL1/F1 round 2: collectWorkspaceEdits refuses an over-bound list without building it", () => {
  const uri = "file:///tmp/a.tfix";
  const edit = (n: number) => ({ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: "x".repeat(n) });
  // changes map: the over-bound list is refused.
  assert.throws(
    () => collectWorkspaceEdits({ changes: { [uri]: Array.from({ length: 2049 }, () => edit(1)) } } as never, uri),
    /2048|bound/i);
  // documentChanges: the refusal lands mid-collection, not after a flatMap
  // materialized the whole list.
  assert.throws(
    () => collectWorkspaceEdits({
      documentChanges: [
        { textDocument: { uri: "file:///other" }, edits: Array.from({ length: 4096 }, () => edit(1)) },
        { textDocument: { uri }, edits: Array.from({ length: 2049 }, () => edit(1)) },
      ],
    } as never, uri),
    /2048|bound/i);
  // At the bound the list collects normally.
  assert.equal(collectWorkspaceEdits({ changes: { [uri]: Array.from({ length: 2048 }, () => edit(1)) } } as never, uri).length, 2048);
});

test("BL1/F1 round 2: the overlap sweep reaches the same verdicts the pair scan did", () => {
  const text = "one\ntwo\nthree\nfour\n";
  const edit = (sl: number, sc: number, el: number, ec: number) => ({
    range: { start: { line: sl, character: sc }, end: { line: el, character: ec } },
    newText: "x",
  });
  const insert = (line: number, character: number) => edit(line, character, line, character);
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
  assert.equal(hasOverlappingTextEdits(text, [insert(0, 4), edit(1, 0, 3, 0), edit(0, 0, 1, 1)]), true,
    "an interior insert still conflicts even when a later range starts at the same offset");
});

test("BL1/F1 round 2: single-pass apply produces the reverse-sorted application's output", () => {
  const text = "one\ntwo\nthree\n";
  const edit = (sl: number, sc: number, el: number, ec: number, newText: string) => ({
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
  // Dynamic so this test file also compiles against a bundle that predates
  // the export -- the missing function is itself the regression.
  const specifier = "../src/extension/vendor/pi-lsp/runtime/lsp-client.js";
  const { appendStderrSample } = await import(specifier) as {
    appendStderrSample: (state: { sample: string; dropped: boolean }, text: string) => { sample: string; dropped: boolean };
  };
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

test("BL1/F4 round 2: a post-spawn child 'error' event kills the process -- the client never orphans", async t => {
  const root = tmp(t);
  writeFileSync(join(root, "note.tfix"), "hello\n");
  // The permanent 'error' listener is a private-field closure; the child
  // object it was registered on is captured through the prototype seam so
  // the test can raise exactly the event a real post-spawn failure raises.
  const { ChildProcess } = await import("node:child_process");
  const realOn = ChildProcess.prototype.on;
  let captured: import("node:child_process").ChildProcess | undefined;
  ChildProcess.prototype.on = function (event: string | symbol, listener: (...args: any[]) => void) {
    if (event === "error") captured = this;
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
  } finally {
    ChildProcess.prototype.on = realOn;
    client.close();
  }
});

test("BL1: selectDiagnosticRoutes marks an uninstalled default server skipped, never clean", async t => {
  const root = tmp(t);
  mkdirSync(join(root, "sub"), { recursive: true });
  writeFileSync(join(root, "sub", "a.ghost"), "x\n");
  const ghost = {
    ...fixtureAdapter("pull-strict-optional-params"),
    name: "ghost",
    isDefault: true,
    defaultCommand: { command: "oma-no-such-binary", args: [] },
    extensions: [".ghost"],
    isSupportedFile: (filePath: string) => filePath.endsWith(".ghost"),
  };
  const { routes, skipped } = selectDiagnosticRoutes([ghost], { root }, 50);
  assert.equal(routes.length, 0);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0]!.reason, /command missing/);
  // An explicitly selected missing server is not pre-skipped -- it is tried
  // and the client's start surfaces the missing command.
  const explicit = selectDiagnosticRoutes([ghost], { root, paths: ["sub/a.ghost"], server: "ghost" }, 50);
  assert.equal(explicit.routes.length, 1);
  assert.equal(commandExists("oma-no-such-binary", root, undefined), false);
});
