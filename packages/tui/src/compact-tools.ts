/** B1: compact tool rows on the Principal's screen, through Pi's public
 * `registerToolRenderer` seam — never a prototype patch.
 *
 * A tool call is one row: a status dot, the tool's display name and one line
 * of what it was asked. Its result is a control row — `Done in 1.2s ·
 * 3 lines` — that opens into the output (or the author's own result view)
 * when the row is expanded. `renderShell: "self"` keeps Pi's grey tool box
 * off the row. Names are presentation only: `oma_mail_send` reads as `mail
 * send` while the wire and the registry keep the real name.
 *
 * The engine's own types are not imported here — the product surface borrows
 * only declared pi-tui primitives — so the shapes the resolver needs are
 * stated structurally and checked at the one registration site, which has
 * the real types.
 */
import { truncateToWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import { UNSEEN_EXCEPT_LAYOUT } from "@oma/domain/unseen-text";
import { COMPACT_TOOL_BOUNDS, DURATION_UNITS } from "@oma/domain/surface-bounds";

/** The theme a row is drawn with; the engine's Theme satisfies it. */
export interface CompactTheme {
  fg(color: string, text: string): string;
  bold(text: string): string;
}

/** The render context the engine hands a renderer, structurally. `args` and
 * `state` are the engine's own `unknown`/`any` slots -- mirrored, so the
 * engine's context is assignable here without narrowing. */
export interface CompactContext {
  readonly args: unknown;
  readonly toolCallId: string;
  readonly invalidate: () => void;
  readonly lastComponent: Component | undefined;
  /** The row's own slot, shared between its call and result renders. It is
   * the registered author's too, so compact bookkeeping is never written into
   * it — this module keys its own state on it instead. */
  readonly state: unknown;
  readonly cwd: string;
  readonly executionStarted: boolean;
  readonly argsComplete: boolean;
  readonly isPartial: boolean;
  readonly expanded: boolean;
  readonly showImages: boolean;
  readonly isError: boolean;
}

/** A tool result as the engine hands it to a result renderer. */
export interface CompactResult {
  readonly content: readonly { readonly type: string; readonly text?: string }[];
  readonly details?: unknown;
}

export interface CompactResultOptions {
  readonly expanded: boolean;
  readonly isPartial: boolean;
}

/** What the resolvers after this one, then the registered tool, would draw.
 * Method signatures: the engine's own renderer shapes meet these under
 * strict function checks only where a method's parameters are read both
 * ways, and these members are read, never re-assigned. */
export interface BaseToolRenderers {
  readonly renderShell?: "default" | "self";
  renderCall?(args: unknown, theme: CompactTheme, context: CompactContext): Component;
  renderResult?(result: CompactResult, options: CompactResultOptions,
    theme: CompactTheme, context: CompactContext): Component;
}

/** The engine's ToolRendererResolver, structurally: the host file registers it. */
export type CompactToolResolver =
  (toolName: string, next: () => BaseToolRenderers | undefined) => BaseToolRenderers | undefined;

type AuthorResult = NonNullable<BaseToolRenderers["renderResult"]>;

/** `oma_mail_send` reads as `mail send`; a name without the society's prefix
 * -- an engine built-in, another extension's -- is shown as it is. */
export function toolDisplayName(name: string): string {
  return name.startsWith("oma_") ? name.slice(4).replace(/_/g, " ") : name;
}

type RowStatus = "pending" | "running" | "success" | "error";
type Tone = "muted" | "dim" | "borderMuted" | "success" | "error";

const GLYPH = "⦁";
const FRAMES = COMPACT_TOOL_BOUNDS.indicatorFrames.value;

function indicatorStrength(frame: number): number {
  const phase = ((frame % FRAMES) + FRAMES) % FRAMES;
  const wave = (Math.cos((phase / FRAMES) * Math.PI * 2) + 1) / 2;
  return 0.08 + 0.92 * wave;
}

function indicatorTone(status: RowStatus, frame: number): Tone {
  if (status === "success") return "success";
  if (status === "error") return "error";
  if (status === "pending") return "muted";
  const strength = indicatorStrength(frame);
  return strength >= 0.7 ? "muted" : strength >= 0.35 ? "dim" : "borderMuted";
}

export function paintIndicator(theme: CompactTheme, status: RowStatus, frame: number): string {
  return theme.fg(indicatorTone(status, frame), GLYPH);
}

/** What the engine's own renderers print: sub-minute precision, then grouped. */
export function formatDurationMs(elapsedMs: number): string {
  const seconds = elapsedMs / DURATION_UNITS.msPerSecond;
  if (seconds < DURATION_UNITS.perMinute) return `${seconds.toFixed(3)}s`;
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / DURATION_UNITS.perMinute);
  const rest = whole % DURATION_UNITS.perMinute;
  if (minutes < DURATION_UNITS.perHour) return `${minutes}m ${rest}s`;
  return `${Math.floor(minutes / DURATION_UNITS.perHour)}h ${minutes % DURATION_UNITS.perHour}m ${rest}s`;
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?|\n/g, "\n");
}

/** The text blocks of a result, joined — the same blocks the fallback renderer shows. */
export function resultText(result: CompactResult): string {
  return normalizeLineEndings(result.content.filter(block => block.type === "text")
    .map(block => block.text ?? "").join("\n")).trimEnd();
}

function countLines(text: string): number {
  const trimmed = text.trimEnd();
  return trimmed.length === 0 ? 0 : trimmed.split("\n").length;
}

/** One printable line of a value; controls already removed by the caller's
 * display copy, this guards a surviving one. */
function inline(value: string, cells: number): string {
  const flat = normalizeLineEndings(value.replace(UNSEEN_EXCEPT_LAYOUT, ""))
    .replace(/[\x00-\x1f\x7f]/gu, " ").replace(/\s+/gu, " ").trim();
  return flat.length > cells ? `${flat.slice(0, cells - 1).trimEnd()}…` : flat;
}

function listed(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.filter(item => typeof item === "string" || typeof item === "number").map(String);
    if (parts.length > 0) return parts.join(", ");
  }
  return undefined;
}

/** The argument a one-line call row shows, per tool; anything else is the
 * generic "first useful argument" reading. */
const SUMMARY: Readonly<Record<string, (args: Record<string, unknown>) => string | undefined>> = {
  oma_mail_send: args => {
    const to = listed(args.to), subject = listed(args.subject);
    return [to, subject].filter((part): part is string => part !== undefined && part !== "").join(" · ") || undefined;
  },
  oma_mail_read: args => listed(args.messageId),
  oma_mail_ack: args => listed(args.messageId),
  oma_status: args => listed(args.agent),
  oma_society: args => listed(args.action),
  oma_agent_lifecycle: args => [listed(args.name), listed(args.action)]
    .filter((part): part is string => part !== undefined).join(" ") || undefined,
  oma_merge: args => [listed(args.action), listed(args.name)].filter((part): part is string => part !== undefined).join(" ") || undefined,
  oma_challenge: args => [listed(args.action), listed(args.name)].filter((part): part is string => part !== undefined).join(" ") || undefined,
  read: args => listed(args.path) ?? listed(args.file_path),
  write: args => listed(args.path) ?? listed(args.file_path),
  edit: args => listed(args.path) ?? listed(args.file_path),
  ls: args => listed(args.path) ?? ".",
  find: args => `${listed(args.pattern) ?? "…"} in ${listed(args.path) ?? "."}`,
  grep: args => `/${listed(args.pattern) ?? "…"}/ in ${listed(args.path) ?? "."}`,
};

/** Argument names that usually say what a call is about, most useful first. */
const GENERIC_SUMMARY_KEYS = [
  "command", "query", "q", "url", "path", "file_path", "pattern", "messageId",
  "subject", "to", "name", "agent", "action", "id",
];

export function callSummary(name: string, args: Record<string, unknown>): string | undefined {
  const specific = SUMMARY[name];
  const picked = specific !== undefined ? specific(args) : undefined;
  const value = picked ?? GENERIC_SUMMARY_KEYS.map(key => listed(args[key])).find(item => item !== undefined && item !== "")
    ?? Object.entries(args).map(([key, item]) => {
      const inner = listed(item);
      return inner === undefined ? undefined : `${key}: ${inner}`;
    }).find(item => item !== undefined);
  return value === undefined ? undefined : inline(value, COMPACT_TOOL_BOUNDS.summaryCells.value);
}

/** The last readable line of a failed call's output, one row long. */
export function failureSummary(output: string): string | undefined {
  const lines = output.split("\n").map(line => inline(line, COMPACT_TOOL_BOUNDS.failureCells.value)).filter(Boolean);
  return lines.length === 0 ? undefined : lines[lines.length - 1];
}

/** A component that is whatever lines `draw` answers at render time — the
 * status dot's color is read then, so a repaint animates it without the row
 * being rebuilt. */
class Lines implements Component {
  constructor(private readonly draw: (width: number) => string[]) {}
  render(width: number): string[] { return this.draw(Math.max(1, Math.floor(width))); }
  invalidate(): void {}
}

class Rows implements Component {
  private readonly children: Component[] = [];
  constructor(...children: readonly (Component | undefined)[]) {
    for (const child of children) if (child !== undefined) this.children.push(child);
  }
  add(child: Component | undefined): void { if (child !== undefined) this.children.push(child); }
  render(width: number): string[] { return this.children.flatMap(child => child.render(width)); }
  invalidate(): void { for (const child of this.children) child.invalidate(); }
}

const RAIL = " │ ";

function underRail(theme: CompactTheme, text: string): Component {
  const rail = theme.fg("borderMuted", RAIL);
  const width = RAIL.length;
  return new Lines(columns => text.replace(/\t/g, "   ").split("\n")
    .flatMap(line => wrapTextWithAnsi(line, Math.max(1, columns - width)))
    .map(line => rail + line));
}

/** Another renderer's output set under the row's rail. */
function railed(component: Component, theme: CompactTheme): Component {
  const rail = theme.fg("borderMuted", RAIL);
  const width = RAIL.length;
  return new Lines(columns => component.render(Math.max(1, columns - width)).map(line => rail + line));
}

interface RowState {
  finished?: boolean;
  startedAt?: number;
  endedAt?: number;
  /** The author result renderer's last component, so its own reuse still works. */
  authorComponent?: Component;
}

interface Timing { startedAt: number; endedAt?: number }
interface Indicator { invalidate: () => void }

/** What a runtime exposes to the host's wiring. Events are what the engine
 * already reports to extensions; a row reads them, it never polls. */
export interface CompactToolRuntime {
  readonly resolver: CompactToolResolver;
  agentStarted(): void;
  agentEnded(): void;
  toolStarted(toolCallId: string): void;
  toolEnded(toolCallId: string): void;
  /** The engine's frame request, bound once through an invisible widget:
   * a running row then repaints its dot instead of being rebuilt. */
  bindRender(request: (() => void) | undefined): void;
  /** Everything transient is dropped between sessions; timings are kept on
   * shutdown only for the reload case the caller flags. */
  reset(clearTimings: boolean): void;
}

export function createCompactToolRuntime(clock: () => number = () => Date.now()): CompactToolRuntime {
  const timings = new Map<string, Timing>();
  const indicators = new Map<string, Indicator>();
  const states = new WeakMap<object, RowState>();
  let frame = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let requestRender: (() => void) | undefined;
  /** Whether the engine is working; undefined until the host says, which
   * counts as working so a row drawn before the first event still animates. */
  let busy: boolean | undefined;

  /** The engine hands a row one shared state object that belongs to the
   * tool's author; compact bookkeeping keys on it rather than writing into it. */
  const slot = (state: unknown): RowState => {
    if (typeof state !== "object" || state === null) return {};
    let row = states.get(state);
    if (row === undefined) { row = {}; states.set(state, row); }
    return row;
  };
  const trimTimings = (): void => {
    if (timings.size <= COMPACT_TOOL_BOUNDS.trackedCalls.value) return;
    // Settled calls drop first so a long-running sibling keeps its start.
    for (const [id, timing] of timings) if (timing.endedAt !== undefined) { timings.delete(id); return; }
    const oldest = timings.keys().next().value;
    if (oldest !== undefined) timings.delete(oldest);
  };
  const stopTimer = (): void => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    indicators.clear();
    frame = 0;
  };
  const tick = (): void => {
    frame += 1;
    if (requestRender !== undefined) { requestRender(); return; }
    for (const indicator of indicators.values()) indicator.invalidate();
  };
  const syncIndicator = (id: string, running: boolean, invalidate: () => void): number => {
    if (!running) {
      if (indicators.delete(id) && indicators.size === 0) stopTimer();
      return frame;
    }
    const existing = indicators.get(id);
    if (existing !== undefined) existing.invalidate = invalidate;
    else indicators.set(id, { invalidate });
    if (timer === undefined) {
      timer = setInterval(tick, COMPACT_TOOL_BOUNDS.indicatorMs.value);
      (timer as { unref?(): void }).unref?.();
    }
    return frame;
  };

  const status = (ctx: CompactContext, row: RowState): RowStatus => {
    if (ctx.isError) return "error";
    if (row.finished === true || row.endedAt !== undefined) return "success";
    const timing = timings.get(ctx.toolCallId);
    const started = ctx.executionStarted || !ctx.argsComplete || timing !== undefined;
    return started && busy !== false ? "running" : "pending";
  };

  const renderCall = (name: string, rawArgs: unknown, theme: CompactTheme,
    ctx: CompactContext): Component => {
    const args = (typeof rawArgs === "object" && rawArgs !== null ? rawArgs : {}) as Record<string, unknown>;
    const row = slot(ctx.state);
    const timing = timings.get(ctx.toolCallId);
    if (timing !== undefined) { row.startedAt = timing.startedAt; if (timing.endedAt !== undefined) row.endedAt = timing.endedAt; }
    // A settled dot never repaints; a live one is painted each time it is drawn.
    let settled: string | undefined;
    const dot = (): string => {
      if (settled !== undefined) return settled;
      const current = status(ctx, row);
      const painted = paintIndicator(theme, current, syncIndicator(ctx.toolCallId, current === "running", () => ctx.invalidate()));
      if (current === "success" || current === "error") settled = painted;
      return painted;
    };
    const title = theme.fg("toolTitle", theme.bold(toolDisplayName(name)));
    const summary = callSummary(name, args);
    const call = new Lines(columns =>
      [truncateToWidth(` ${dot()} ${title}${summary === undefined ? "" : ` ${theme.fg("toolOutput", summary)}`}`, columns, "…")]);
    const container = new Rows(call);
    if (ctx.expanded) {
      const json = JSON.stringify(args, null, 2);
      if (json !== undefined) container.add(underRail(theme, theme.fg("toolOutput", json)));
    }
    return container;
  };

  const renderResult = (name: string, result: CompactResult, options: CompactResultOptions,
    theme: CompactTheme, ctx: CompactContext, author: AuthorResult | undefined): Component => {
    const row = slot(ctx.state);
    if (!options.isPartial) {
      row.finished = true;
      const timing = timings.get(ctx.toolCallId);
      if (timing !== undefined) { row.startedAt = timing.startedAt; row.endedAt = timing.endedAt ?? clock(); }
      syncIndicator(ctx.toolCallId, false, () => ctx.invalidate());
    }
    const output = resultText(result);
    const container = new Rows();
    if (options.expanded) {
      // The author's own view of its result still draws the opened body; a
      // tool with none shows its raw output lines under the same rail.
      if (author !== undefined) {
        try {
          const painted = author(result, { ...options, expanded: true }, theme, { ...ctx, lastComponent: row.authorComponent });
          row.authorComponent = painted;
          container.add(railed(painted, theme));
        } catch {
          if (output !== "") container.add(underRail(theme, theme.fg(ctx.isError ? "error" : "toolOutput", output)));
        }
      } else if (output !== "") container.add(underRail(theme, theme.fg(ctx.isError ? "error" : "toolOutput", output)));
    }
    const chrome = (text: string): string => theme.fg("borderMuted", text);
    let line = "";
    if (options.isPartial) line = chrome("Running…");
    else {
      const duration = row.startedAt === undefined ? undefined
        : formatDurationMs((row.endedAt ?? clock()) - row.startedAt);
      line = chrome(`${ctx.isError ? "Failed" : "Done"}${duration === undefined ? "" : ` in ${duration}`}`);
      if (ctx.isError) {
        const reason = options.expanded ? undefined : failureSummary(output);
        if (reason !== undefined) line += chrome(" · ") + theme.fg("error", reason);
      } else {
        const count = countLines(output);
        if (count > 0) line += chrome(` · ${count} ${count === 1 ? "line" : "lines"}`);
      }
    }
    container.add(new Lines(columns => [truncateToWidth(chrome(" └ ") + line, columns, "…")]));
    return container;
  };

  const resolver: CompactToolResolver = (name, next) => {
    const base = next();
    return {
      renderShell: "self",
      renderCall: (args, theme, ctx) => renderCall(name, args ?? {}, theme, ctx),
      renderResult: (result, options, theme, ctx) => renderResult(name, result, options, theme, ctx, base?.renderResult),
    };
  };

  return {
    resolver,
    agentStarted(): void { busy = true; },
    agentEnded(): void {
      busy = false;
      const animating = indicators.size > 0;
      stopTimer();
      if (animating) requestRender?.();
    },
    toolStarted(id): void {
      if (!timings.has(id)) { timings.set(id, { startedAt: clock() }); trimTimings(); }
    },
    toolEnded(id): void {
      const timing = timings.get(id) ?? { startedAt: clock() };
      timing.endedAt ??= clock();
      timings.set(id, timing);
      trimTimings();
    },
    bindRender(request): void { requestRender = request; },
    reset(clearTimings): void {
      stopTimer();
      busy = undefined;
      if (clearTimings) timings.clear();
    },
  };
}
