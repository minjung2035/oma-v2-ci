/** Direct coverage of the vendored pi-lsp runtime OMA delegates to: the
 * LSP client handshake, the diagnostics runner, route selection, and the
 * command probe. These run against the bundle's own fixture server, which
 * is part of the verified payload -- the same bytes that ship in dist. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LspClient } from "../src/extension/vendor/pi-lsp/runtime/lsp-client.js";
import { runDiagnostics } from "../src/extension/vendor/pi-lsp/runtime/runner.js";
import { selectDiagnosticRoutes } from "../src/extension/vendor/pi-lsp/runtime/routes.js";
import { commandExists } from "../src/extension/vendor/pi-lsp/runtime/command.js";

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
  const previous = process.env.PI_LSP_TEST_LOG;
  process.env.PI_LSP_TEST_LOG = log;
  t.after(() => { if (previous === undefined) delete process.env.PI_LSP_TEST_LOG; else process.env.PI_LSP_TEST_LOG = previous; });
  const runClient = async () => {
    const adapter = fixtureAdapter("pull-strict-optional-params");
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
