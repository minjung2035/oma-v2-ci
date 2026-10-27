/** B1: the compact tool rows — resolver chaining, display names, the live
 * dot, the control row and expansion — asserted on what the row draws. */
import test from "node:test";
import assert from "node:assert/strict";
import { createCompactToolRuntime, toolDisplayName, callSummary, formatDurationMs, resultText, paintIndicator,
  type BaseToolRenderers, type CompactContext, type CompactResult, type CompactTheme } from "@oma/tui/compact-tools";
import { COMPACT_TOOL_BOUNDS } from "@oma/domain/surface-bounds";

/** A theme that tags color and weight in-band, so assertions read text. */
const theme: CompactTheme = {
  fg: (color, text) => `\u001b[${color}]${text}\u001b[/]`,
  bold: text => `\u001b[bold]${text}\u001b[/]`,
};
const plain = (lines: readonly string[]): string => lines.join("\n").replace(/\u001b\[[^\]]*\]?/g, match => match.endsWith("]") ? "" : match);

let invalidated = 0;
const ctx = (over: Partial<CompactContext> = {}, state: object = {}): CompactContext => ({
  args: {}, toolCallId: "call-1", invalidate: () => { invalidated += 1; }, lastComponent: undefined,
  state, cwd: "/workspace", executionStarted: false, argsComplete: true, isPartial: false,
  expanded: false, showImages: true, isError: false, ...over,
});
const result = (text: string): CompactResult => ({ content: [{ type: "text", text }] });

test("B1: the display name drops only the society's prefix", () => {
  assert.equal(toolDisplayName("oma_mail_send"), "mail send");
  assert.equal(toolDisplayName("oma_mail_read"), "mail read");
  assert.equal(toolDisplayName("oma_merge"), "merge");
  assert.equal(toolDisplayName("oma_challenge"), "challenge");
  assert.equal(toolDisplayName("oma_status"), "status");
  assert.equal(toolDisplayName("oma_society"), "society");
  assert.equal(toolDisplayName("oma_agent_lifecycle"), "agent lifecycle");
  // Engine built-ins and other extensions keep their own names.
  assert.equal(toolDisplayName("read"), "read");
  assert.equal(toolDisplayName("some_other_tool"), "some_other_tool");
});

test("B1: the resolver returns the self-rendered compact row for any tool", () => {
  const runtime = createCompactToolRuntime();
  for (const name of ["oma_mail_send", "read", "unregistered_elsewhere"]) {
    const renderers = runtime.resolver(name, () => undefined);
    assert.equal(renderers?.renderShell, "self");
    assert.equal(typeof renderers?.renderCall, "function");
    assert.equal(typeof renderers?.renderResult, "function");
  }
});

test("B1: resolvers chain — the base the rest of the chain resolves is still seen", () => {
  const runtime = createCompactToolRuntime();
  const author: BaseToolRenderers = { renderResult: () => ({ render: () => ["author body"], invalidate() {} }) };
  // The runner asks resolvers in load order, each seeing the rest's answer.
  const seen: string[] = [];
  const outer = (_name: string, next: () => BaseToolRenderers | undefined) => { seen.push("outer"); return next(); };
  const resolved = runtime.resolver("oma_status", () => outer("oma_status", () => author));
  assert.deepEqual(seen, ["outer"], "our resolver called next() once, so a later resolver still runs");
  // The author's own result renderer draws the expanded body.
  const rendered = resolved!.renderResult!(result("x"), { expanded: true, isPartial: false }, theme, ctx());
  assert.ok(rendered.render(80).join("\n").includes("author body"));
});

test("B1: a call row is one line — dot, display name, one-line arguments", () => {
  const runtime = createCompactToolRuntime();
  const renderers = runtime.resolver("oma_mail_send", () => undefined)!;
  const component = renderers.renderCall!({ to: ["worker-a"], subject: "Interactive ownership" }, theme,
    ctx({ args: { to: ["worker-a"], subject: "Interactive ownership" } }));
  const lines = component.render(80);
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /⦁/);
  assert.match(lines[0]!, /mail send/);
  assert.doesNotMatch(lines[0]!, /oma_mail_send/);
  assert.match(lines[0]!, /worker-a/);
  assert.match(lines[0]!, /Interactive ownership/);
});

test("B1: a running call's dot is painted a live tone; a pending row's is muted", () => {
  const runtime = createCompactToolRuntime();
  runtime.agentStarted();
  const renderers = runtime.resolver("read", () => undefined)!;
  const pending = renderers.renderCall!({ path: "/x" }, theme, ctx());
  assert.match(pending.render(80)[0]!, /\u001b\[muted\]⦁/);
  const running = renderers.renderCall!({ path: "/x" }, theme, ctx({ executionStarted: true }));
  assert.match(running.render(80)[0]!, /\u001b\[(muted|dim|borderMuted)\]⦁/);
  runtime.agentEnded();
});

test("B1: the control row carries duration and line count", () => {
  const runtime = createCompactToolRuntime(() => now);
  let now = 1_000;
  const renderers = runtime.resolver("oma_mail_read", () => undefined)!;
  const state = {};
  renderers.renderCall!({ messageId: "m1" }, theme, ctx({}, state));
  runtime.toolStarted("call-1");
  now += 1_250;
  runtime.toolEnded("call-1");
  const row = renderers.renderResult!(result("first\nsecond\nthird"), { expanded: false, isPartial: false }, theme,
    ctx({}, state));
  const text = plain(row.render(80));
  assert.match(text, /Done in 1\.250s/);
  assert.match(text, /3 lines/);
  assert.match(text, /└/);
});

test("B1: a failed row says Failed and carries its last output line", () => {
  const runtime = createCompactToolRuntime();
  const renderers = runtime.resolver("oma_mail_send", () => undefined)!;
  const row = renderers.renderResult!(result("context\nno such address"), { expanded: false, isPartial: false },
    theme, ctx({ isError: true }));
  const text = plain(row.render(120));
  assert.match(text, /Failed/);
  assert.match(text, /no such address/);
  assert.doesNotMatch(text, /lines\b/);
});

test("B1: a partial result is reported as still running, not done", () => {
  const runtime = createCompactToolRuntime();
  const renderers = runtime.resolver("read", () => undefined)!;
  const row = renderers.renderResult!(result("partial"), { expanded: false, isPartial: true }, theme, ctx({ isPartial: true }));
  assert.match(plain(row.render(80)), /Running…/);
});

test("B1: expansion shows the arguments under the rail; the output opens under it", () => {
  const runtime = createCompactToolRuntime();
  const renderers = runtime.resolver("oma_mail_send", () => undefined)!;
  const args = { to: ["worker-a"], subject: "s", body: "the whole body line" };
  const call = renderers.renderCall!(args, theme, ctx({ args, expanded: true }));
  const callText = plain(call.render(80));
  assert.match(callText, /"to"/);
  assert.match(callText, /worker-a/);
  const row = renderers.renderResult!(result("line one\nline two"), { expanded: true, isPartial: false }, theme,
    ctx({ args, expanded: true }));
  const resultLines = plain(row.render(80)).split("\n");
  assert.ok(resultLines.some(line => line.includes("line one")));
  assert.ok(resultLines.some(line => line.includes("line two")));
  assert.ok(resultLines.some(line => /Done/.test(line)), "the control row stays under an opened result");
});

test("B1: a row never writes its bookkeeping into the author's shared state", () => {
  const runtime = createCompactToolRuntime();
  const renderers = runtime.resolver("oma_status", () => undefined)!;
  const shared: Record<string, unknown> = {};
  const context = ctx({ executionStarted: true }, shared);
  runtime.agentStarted();
  renderers.renderCall!({}, theme, context);
  renderers.renderResult!(result("ok"), { expanded: false, isPartial: false }, theme, context);
  assert.deepEqual(Object.keys(shared), []);
  runtime.agentEnded();
});

test("B1: timings stay bounded — the oldest finished entry is dropped first", () => {
  const runtime = createCompactToolRuntime(() => 42);
  const bound = COMPACT_TOOL_BOUNDS.trackedCalls.value;
  // The first call finishes; the rest stay open so the finished one is evicted first.
  runtime.toolStarted("finished-first");
  runtime.toolEnded("finished-first");
  for (let index = 0; index < bound + 5; index++) runtime.toolStarted(`open-${index}`);
  const renderers = runtime.resolver("read", () => undefined)!;
  const evicted = renderers.renderResult!(result("x"), { expanded: false, isPartial: false }, theme,
    ctx({ toolCallId: "finished-first" }));
  assert.doesNotMatch(plain(evicted.render(80)), / in /, "an evicted timing renders Done with no invented duration");
  const kept = renderers.renderResult!(result("x"), { expanded: false, isPartial: false }, theme,
    ctx({ toolCallId: `open-${bound + 4}` }));
  assert.match(plain(kept.render(80)), /Done in 0\.000s/);
});

test("B1: formatDurationMs and resultText keep the engine's own shapes", () => {
  assert.equal(formatDurationMs(0), "0.000s");
  assert.equal(formatDurationMs(12_345), "12.345s");
  assert.equal(formatDurationMs(61_000), "1m 1s");
  assert.equal(formatDurationMs(3_661_000), "1h 1m 1s");
  assert.equal(resultText({ content: [{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }] }), "a\nb");
  assert.equal(resultText({ content: [] }), "");
});

test("B1: callSummary prefers the argument that names the call", () => {
  assert.equal(callSummary("oma_status", {}), undefined);
  assert.equal(callSummary("oma_status", { agent: "worker-a" }), "worker-a");
  assert.equal(callSummary("read", { path: "/tmp/x", offset: 3 }), "/tmp/x");
  assert.equal(callSummary("find", { pattern: "*.ts", path: "/w" }), "*.ts in /w");
  assert.equal(callSummary("grep", { pattern: "needle" }), "/needle/ in .");
  assert.equal(callSummary("whatever", { query: "the question" }), "the question");
  const long = callSummary("whatever", { query: "x".repeat(500) })!;
  assert.ok(long.endsWith("…") && long.length <= COMPACT_TOOL_BOUNDS.summaryCells.value);
});

test("B1: the running dot paints at draw time through the pulse tones", () => {
  for (const status of ["pending", "success", "error"] as const)
    assert.match(paintIndicator(theme, status, 0), new RegExp(`\\[(muted|success|error)\\]⦁`));
  const live = new Set([0, 1, 2, 3, 4, 5, 6].map(frame => paintIndicator(theme, "running", frame)));
  assert.ok(live.size > 1, "the running dot cycles tones across frames");
});
