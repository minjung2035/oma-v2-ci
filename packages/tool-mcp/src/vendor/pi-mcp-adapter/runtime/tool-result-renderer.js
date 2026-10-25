import { Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
const plainTheme = { fg: (_name, text) => text };
const DEFAULT_MAX_CALL_INPUT_CHARS = 1500;
const DEFAULT_MAX_COMPACT_INPUT_CHARS = 240;
const DEFAULT_BOXED_COLLAPSED_LINES = 3;
const DEFAULT_COMPACT_COLLAPSED_LINES = 1;
const DEFAULT_MAX_COLLAPSED_CHARS = 8000;
const COLLAPSED_RENDER_CHAR_SLACK = 8;
class EmptyComponent {
    render() {
        return [];
    }
    invalidate() { }
}
class CompactMcpToolResult {
    title;
    inputPreview;
    display;
    theme;
    status;
    rendered = null;
    constructor(title, inputPreview, display, theme, 
    /** Shown after the title and never truncated; the title shrinks instead (e.g. `✗3`). */
    status = "") {
        this.title = title;
        this.inputPreview = inputPreview;
        this.display = display;
        this.theme = theme;
        this.status = status;
    }
    render(width) {
        const safeWidth = Math.max(1, Math.floor(width));
        if (this.rendered?.width === safeWidth)
            return this.rendered.lines;
        const resultLines = this.display.lines.filter((line, index, lines) => {
            return !(this.display.truncated && index === lines.length - 1 && line === "…");
        });
        const lines = resultLines.length > 0 ? resultLines : [""];
        const bodies = lines.map((line, index) => {
            const prefix = index === 0 ? this.renderPrefix(safeWidth) : "";
            return `${prefix}${this.theme.fg("toolOutput", line)}`;
        });
        const hiddenText = this.display.truncated || bodies.some((body) => visibleWidth(body) > safeWidth);
        const rendered = bodies.map((body, index) => {
            const suffix = hiddenText && index === bodies.length - 1 ? " … (Ctrl+O to expand)" : "";
            if (!suffix)
                return truncateToWidth(body, safeWidth, "…");
            if (safeWidth >= suffix.length + 20) {
                return `${truncateToWidth(body, safeWidth - suffix.length, "…")}${this.theme.fg("muted", suffix)}`;
            }
            const shortSuffix = " (Ctrl+O)";
            if (safeWidth >= shortSuffix.length + 5) {
                return `${truncateToWidth(body, safeWidth - shortSuffix.length, "…")}${this.theme.fg("muted", shortSuffix)}`;
            }
            return truncateToWidth(this.theme.fg("muted", shortSuffix.trim()), safeWidth, "…");
        });
        this.rendered = { width: safeWidth, lines: rendered };
        return rendered;
    }
    invalidate() {
        this.rendered = null;
    }
    renderPrefix(width) {
        if (!this.title)
            return "";
        const arrow = " → ";
        const statusWidth = this.status ? visibleWidth(this.status) + 1 : 0;
        const head = (maxWidth) => {
            const title = maxWidth === undefined
                ? this.title
                : truncateToWidth(this.title, Math.max(1, maxWidth - statusWidth), "…");
            const status = this.status ? ` ${this.theme.fg("error", this.status)}` : "";
            return `${this.theme.fg("toolTitle", title)}${status}`;
        };
        if (!this.inputPreview)
            return `${head()}${arrow}`;
        const maxPrefixWidth = Math.max(12, Math.floor(width * 0.55));
        const titleWidth = visibleWidth(this.title) + statusWidth;
        const inputWidth = Math.max(0, maxPrefixWidth - titleWidth - 1);
        if (inputWidth <= 3)
            return `${head(maxPrefixWidth)}${arrow}`;
        const input = truncateToWidth(this.inputPreview, inputWidth, "…");
        return `${head()} ${this.theme.fg("muted", input)}${arrow}`;
    }
}
class CollapsibleText {
    text;
    expanded;
    maxCollapsedLines;
    preTruncated;
    fullText;
    footerText;
    collapsedText = null;
    collapsedRender = null;
    constructor(text, expanded, maxCollapsedLines, ellipsis, expandHint, preTruncated = false) {
        this.text = text;
        this.expanded = expanded;
        this.maxCollapsedLines = maxCollapsedLines;
        this.preTruncated = preTruncated;
        this.fullText = new Text(text, 0, 0);
        this.footerText = new Text(`${ellipsis}\n${expandHint}`, 0, 0);
    }
    render(width) {
        if (this.expanded) {
            return this.fullText.render(width);
        }
        const safeWidth = Math.max(1, Math.floor(width));
        const charBudget = safeWidth * (this.maxCollapsedLines + 1) * COLLAPSED_RENDER_CHAR_SLACK;
        if (!this.collapsedText || this.collapsedText.charBudget !== charBudget) {
            const prefix = this.text.length > charBudget
                ? this.text.slice(0, charBudget)
                : this.text;
            this.collapsedText = {
                charBudget,
                fullyIncluded: prefix === this.text,
                text: new Text(prefix, 0, 0),
            };
            this.collapsedRender = null;
        }
        const lines = this.collapsedText.text.render(width);
        if (!this.preTruncated && this.collapsedText.fullyIncluded && lines.length <= this.maxCollapsedLines)
            return lines;
        if (this.collapsedRender?.width === width && this.collapsedRender.charBudget === charBudget) {
            return this.collapsedRender.lines;
        }
        const rendered = [
            ...lines.slice(0, this.maxCollapsedLines),
            ...this.footerText.render(width),
        ];
        this.collapsedRender = { width, charBudget, lines: rendered };
        return rendered;
    }
    invalidate() {
        this.fullText.invalidate();
        this.footerText.invalidate();
        this.collapsedText?.text.invalidate();
        this.collapsedRender = null;
    }
}
function truncateText(value, maxChars) {
    if (value.length <= maxChars)
        return value;
    return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}
function formatJsonish(value, maxChars) {
    if (typeof value === "string") {
        try {
            return truncateText(JSON.stringify(JSON.parse(value), null, 2), maxChars);
        }
        catch {
            return truncateText(value, maxChars);
        }
    }
    try {
        return truncateText(JSON.stringify(value, null, 2), maxChars);
    }
    catch {
        return truncateText(String(value), maxChars);
    }
}
function hasUsefulObjectContent(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length > 0;
}
export function formatMcpProxyToolCallLines(args, maxInputChars = DEFAULT_MAX_CALL_INPUT_CHARS) {
    if (args.action === "ui-messages")
        return [`mcp ${args.action}`];
    if (args.tool) {
        const target = args.server ? `${args.tool} @ ${args.server}` : args.tool;
        const lines = [`mcp call ${target}`];
        if (args.args)
            lines.push(formatJsonish(args.args, maxInputChars));
        return lines;
    }
    if (args.connect)
        return [`mcp connect ${args.connect}`];
    if (args.describe) {
        const target = args.server ? `${args.describe} @ ${args.server}` : args.describe;
        return [`mcp describe ${target}`];
    }
    if (args.search) {
        let line = `mcp search ${args.search}`;
        if (args.server)
            line += ` @ ${args.server}`;
        if (args.regex === true)
            line += " (regex)";
        if (args.includeSchemas === false)
            line += " (schemas hidden)";
        return [line];
    }
    if (args.server)
        return [`mcp list ${args.server}`];
    if (args.action)
        return [`mcp ${args.action}`];
    return ["mcp status"];
}
export function formatMcpDirectToolCallLines(displayName, args, maxInputChars = DEFAULT_MAX_CALL_INPUT_CHARS) {
    if (!hasUsefulObjectContent(args))
        return [displayName];
    return [displayName, formatJsonish(args, maxInputChars)];
}
export function formatMcpScriptToolCallLines(args, maxInputChars = DEFAULT_MAX_CALL_INPUT_CHARS) {
    return ["mcpScript", truncateText(args.code, maxInputChars)];
}
function renderToolCallLines(lines, theme) {
    const activeTheme = theme ?? plainTheme;
    const [title = "mcp", ...rest] = lines;
    const styledTitle = activeTheme.fg("toolTitle", activeTheme.bold ? activeTheme.bold(title) : title);
    const styledRest = rest.map(line => activeTheme.fg("muted", line));
    return new Text([styledTitle, ...styledRest].join("\n"), 0, 0);
}
function formatCompactInputPreview(lines, maxChars = DEFAULT_MAX_COMPACT_INPUT_CHARS) {
    return truncateText(lines.slice(1).join(" ").replace(/\s+/g, " ").trim(), maxChars);
}
export function resolveMcpToolRenderOptions(settings) {
    const resultRendering = settings?.toolResultRendering === "boxed" ? "boxed" : "compact";
    const collapsedLines = settings?.collapsedResultLines;
    const defaultLines = resultRendering === "boxed" ? DEFAULT_BOXED_COLLAPSED_LINES : DEFAULT_COMPACT_COLLAPSED_LINES;
    return {
        resultRendering,
        collapsedResultLines: collapsedLines === 1 || collapsedLines === 2 || collapsedLines === 3 ? collapsedLines : defaultLines,
    };
}
function shouldUseCompactFinalRender(options, context) {
    return options.resultRendering === "compact"
        && context !== undefined
        && context.isPartial === false
        && context.expanded !== true
        && context.isError !== true;
}
function renderToolCall(lines, theme, context, options) {
    if (context?.state) {
        context.state.compactTitle = lines[0] ?? "mcp";
        context.state.compactInputPreview = formatCompactInputPreview(lines);
    }
    if (shouldUseCompactFinalRender(options, context))
        return new EmptyComponent();
    return renderToolCallLines(lines, theme);
}
export function renderMcpProxyToolCall(args, theme, context) {
    return renderToolCall(formatMcpProxyToolCallLines(args), theme, context, resolveMcpToolRenderOptions());
}
export function createMcpProxyToolCallRenderer(options) {
    return (args, theme, context) => {
        return renderToolCall(formatMcpProxyToolCallLines(args), theme, context, options);
    };
}
export function createMcpDirectToolCallRenderer(displayName, options = resolveMcpToolRenderOptions()) {
    return (args, theme, context) => {
        return renderToolCall(formatMcpDirectToolCallLines(displayName, args), theme, context, options);
    };
}
export function createMcpScriptToolCallRenderer(options = resolveMcpToolRenderOptions()) {
    return (args, theme, context) => {
        // Compact mode hides this call row once the result lands, so leave a title for the result row.
        // The tool list comes from the result's `details.calls` trace (see formatMcpScriptCallSummary);
        // the script code itself is never copied into the compact row.
        if (context?.state)
            context.state.compactTitle = MCP_SCRIPT_TITLE;
        if (shouldUseCompactFinalRender(options, context))
            return new EmptyComponent();
        return renderToolCallLines(formatMcpScriptToolCallLines(args), theme);
    };
}
const MCP_SCRIPT_TITLE = "mcpScript";
const MCP_SCRIPT_SUMMARY_MAX_TOOLS = 4;
const PLAIN_TOOL_PATH = /^[A-Za-z0-9_.\/:@-]+$/;
/**
 * Traced paths are script-supplied. Only identifier-like paths (what MCP tool names look like)
 * are shown bare. Anything else is shown as a quoted, ASCII-escaped JSON string, so it cannot
 * break the row, cannot pass for summary syntax (`foo×2`, `a, b`, ` · `, `+1 more`), and stays
 * distinct from the clean path it may resemble (`demo_red` vs `"\u001b[31mdemo_red"`).
 */
function formatTracedPath(path) {
    if (PLAIN_TOOL_PATH.test(path))
        return path;
    // JSON.stringify quotes and escapes C0 controls, quotes and backslashes; escaping all other
    // non-ASCII too rules out DEL, C1 controls, bidi overrides and invisible characters.
    return JSON.stringify(path).replace(/[^\x20-\x7e]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
/**
 * Failure count and compact-row preview for an mcpScript run, from the `details.calls` trace.
 * The preview lists distinct tool paths in first-call order with repeat counts, then other
 * operation counts, e.g. `github_search_issues×6, slack_post_message · search`.
 * Scripts that only describe tools list the described paths instead (`describe a, b`).
 * The failure count is rendered as a title status, not in the preview: narrow rows drop the
 * preview first, and the status is never truncated (the title shrinks instead).
 * Returns null for non-script results.
 */
export function formatMcpScriptCallSummary(details, maxTools = MCP_SCRIPT_SUMMARY_MAX_TOOLS) {
    if (details?.mode !== "script")
        return null;
    const operations = Array.isArray(details.calls) ? details.calls : [];
    const callCounts = new Map();
    const describeCounts = new Map();
    const metaCounts = new Map();
    let failed = 0;
    for (const operation of operations) {
        if (typeof operation !== "object" || operation === null)
            continue;
        const { operation: kind, path, ok } = operation;
        if (typeof kind !== "string")
            continue;
        if (ok === false)
            failed += 1;
        const target = kind === "call" ? callCounts : kind === "describe" ? describeCounts : null;
        if (target && typeof path === "string") {
            target.set(path, (target.get(path) ?? 0) + 1);
        }
        else {
            metaCounts.set(kind, (metaCounts.get(kind) ?? 0) + 1);
        }
    }
    const withCount = (name, count) => (count > 1 ? `${name}×${count}` : name);
    const listPaths = (counts) => {
        const names = [...counts].map(([path, count]) => withCount(formatTracedPath(path), count));
        return names.length > maxTools
            ? [...names.slice(0, maxTools), `+${names.length - maxTools} more`].join(", ")
            : names.join(", ");
    };
    let tools = listPaths(callCounts);
    if (!tools && describeCounts.size > 0) {
        tools = `describe ${listPaths(describeCounts)}`;
    }
    else {
        const describes = [...describeCounts.values()].reduce((sum, count) => sum + count, 0);
        if (describes > 0)
            metaCounts.set("describe", describes);
    }
    const meta = [...metaCounts].map(([kind, count]) => withCount(kind, count)).join(", ");
    return { failed, preview: [tools, meta].filter(Boolean).join(" · ") };
}
function blockToLines(block) {
    if (block.type === "text") {
        return block.text.split("\n");
    }
    return [`[image: ${block.mimeType}]`];
}
function collectCollapsedResultLines(content, maxLines, maxChars) {
    if (content.length === 0)
        return { lines: ["(empty result)"], truncated: false };
    const lines = [];
    let remainingChars = maxChars;
    let truncated = false;
    const appendLine = (line) => {
        if (lines.length === 0) {
            const previewWidth = Math.min(line.length, remainingChars);
            if (line.slice(0, previewWidth).trim() === "") {
                if (line.length >= remainingChars) {
                    truncated = true;
                    remainingChars = 0;
                    return false;
                }
                remainingChars -= line.length + 1;
                return true;
            }
        }
        if (lines.length >= maxLines || remainingChars <= 0) {
            truncated = true;
            return false;
        }
        if (line.length > remainingChars) {
            lines.push(line.slice(0, remainingChars));
            truncated = true;
            remainingChars = 0;
            return false;
        }
        lines.push(line);
        remainingChars -= line.length + 1;
        return true;
    };
    for (const block of content) {
        if (block.type !== "text") {
            if (!appendLine(`[image: ${block.mimeType}]`))
                break;
            continue;
        }
        let start = 0;
        while (start <= block.text.length) {
            const newline = block.text.indexOf("\n", start);
            const line = newline === -1 ? block.text.slice(start) : block.text.slice(start, newline);
            if (!appendLine(line))
                break;
            if (newline === -1)
                break;
            start = newline + 1;
        }
        if (truncated)
            break;
    }
    if (lines.length === 0)
        lines.push(truncated ? "(leading blank output omitted)" : "");
    if (truncated && lines.length >= maxLines)
        lines.push("…");
    return { lines, truncated };
}
export function formatMcpToolResultIdentity(details) {
    if (details?.mode !== "call")
        return null;
    const server = typeof details.server === "string"
        ? details.server
        : typeof details.hintServer === "string"
            ? details.hintServer
            : null;
    if (!server)
        return null;
    if (typeof details.tool === "string")
        return `MCP ${server}/${details.tool}`;
    if (typeof details.resourceUri === "string")
        return `MCP ${server} resource ${details.resourceUri}`;
    if (typeof details.requestedTool === "string")
        return `MCP ${server}/${details.requestedTool}`;
    return null;
}
export function formatMcpToolResultLines(result, expanded, maxCollapsedLines = DEFAULT_BOXED_COLLAPSED_LINES, maxCollapsedChars = DEFAULT_MAX_COLLAPSED_CHARS) {
    if (!expanded) {
        return collectCollapsedResultLines(result.content, maxCollapsedLines, maxCollapsedChars);
    }
    const allLines = result.content.flatMap(blockToLines);
    const lines = allLines.length > 0 ? allLines : ["(empty result)"];
    return { lines, truncated: false };
}
export function renderMcpToolResult(result, options, theme, context, renderOptions = resolveMcpToolRenderOptions()) {
    const activeTheme = theme ?? plainTheme;
    if (options.isPartial) {
        return new Text(activeTheme.fg("warning", "Running MCP tool..."), 0, 0);
    }
    const hasErrorDetails = Boolean(result.details.error);
    const expanded = options.expanded || context?.isError === true || hasErrorDetails;
    if (!expanded && renderOptions.resultRendering === "compact") {
        const display = formatMcpToolResultLines(result, false, renderOptions.collapsedResultLines);
        const scriptSummary = formatMcpScriptCallSummary(result.details);
        if (scriptSummary) {
            const status = scriptSummary.failed > 0 ? `✗${scriptSummary.failed}` : "";
            return new CompactMcpToolResult(MCP_SCRIPT_TITLE, scriptSummary.preview, display, activeTheme, status);
        }
        const title = context?.state?.compactTitle ?? formatMcpToolResultIdentity(result.details) ?? "";
        const inputPreview = context?.state?.compactInputPreview ?? "";
        return new CompactMcpToolResult(title, inputPreview, display, activeTheme);
    }
    const display = formatMcpToolResultLines(result, expanded, renderOptions.collapsedResultLines);
    const identity = formatMcpToolResultIdentity(result.details);
    const output = [
        ...(identity ? [activeTheme.fg("muted", identity)] : []),
        ...display.lines.map((line) => activeTheme.fg("toolOutput", line)),
    ].join("\n");
    return new CollapsibleText(output, expanded, renderOptions.collapsedResultLines + (identity ? 1 : 0), activeTheme.fg("muted", "…"), activeTheme.fg("muted", "(Ctrl+O to expand)"), display.truncated);
}
export function createMcpToolResultRenderer(renderOptions) {
    return (result, options, theme, context) => renderMcpToolResult(result, options, theme, context, renderOptions);
}
