import { Markdown, Text } from "@earendil-works/pi-tui";
import { keyHint } from "@earendil-works/pi-coding-agent";
import { abortedBatchMessageFor } from "./batch.js";
import { withLineNumbers } from "./utils.js";
import { getPreviewInput } from "./payload-contract.js";
export { getPreviewInput };
function diffRowKind(line) {
    const withoutGutter = line.replace(/^\s*\d+\s+│\s*/, "");
    if (withoutGutter.startsWith("+") && !withoutGutter.startsWith("+++"))
        return "added";
    if (withoutGutter.startsWith("-") && !withoutGutter.startsWith("---"))
        return "removed";
    return "context";
}
export function colorLines(lines, theme) {
    return lines.map((line) => {
        const kind = diffRowKind(line);
        if (kind === "added")
            return theme.fg("success", line);
        if (kind === "removed")
            return theme.fg("error", line);
        return theme.fg("dim", line);
    });
}
export function toNumberedDiff(diff, lineNumbers) {
    return withLineNumbers(diff, lineNumbers);
}
export function fmtPreview(diff, expanded, theme) {
    const lines = diff.split("\n");
    const maxLines = expanded ? 40 : 16;
    const shown = colorLines(lines.slice(0, maxLines), theme);
    if (lines.length > maxLines) {
        shown.push(theme.fg("muted", `... ${lines.length - maxLines} more diff lines`));
    }
    return shown.join("\n");
}
export function fmtResult(diff, theme) {
    return colorLines(diff.split("\n"), theme).join("\n");
}
export function highlightBatchRefs(text, theme) {
    const pattern = /\b([Bb]atch \d+)\b/g;
    const sections = [];
    let cursor = 0;
    for (;;) {
        const match = pattern.exec(text);
        if (!match)
            break;
        if (match.index > cursor)
            sections.push(theme.fg("error", text.slice(cursor, match.index)));
        sections.push(theme.fg("warning", match[0]));
        cursor = match.index + match[0].length;
    }
    if (cursor < text.length)
        sections.push(theme.fg("error", text.slice(cursor)));
    return sections.join("");
}
export function fmtCall(args, state, expanded, theme, toolName = "replace") {
    const previewPath = state.preview && "path" in state.preview ? state.preview.path : undefined;
    const path = args?.path ?? state.resolvedPath ?? previewPath;
    const anchorFallback = typeof args?.remove_from === "string" && typeof args?.remove_to === "string" ? `${args.remove_from}→${args.remove_to}` : typeof args?.anchor === "string" ? args.anchor : typeof args?.source_from === "string" && typeof args?.insert_after === "string" ? `${args.source_from}→${args.insert_after}` : typeof args?.replace_from === "string" && typeof args?.replace_to === "string" ? `${args.replace_from}→${args.replace_to}` : undefined;
    const pathDisplay = typeof path === "string" && path.length > 0
        ? theme.fg("accent", path)
        : typeof anchorFallback === "string" && anchorFallback.length > 0
            ? theme.fg("accent", anchorFallback)
            : theme.fg("toolOutput", "...");
    let text = `${theme.fg("toolTitle", theme.bold(toolName))} ${pathDisplay}`;
    if (!state.preview) {
        return text;
    }
    if ("error" in state.preview) {
        text += `\n\n${theme.fg("error", state.preview.error)}`;
        return text;
    }
    if (state.preview.diff) {
        text += `\n\n${fmtPreview(state.preview.diff, expanded, theme)}`;
    }
    return text;
}
export function getResultText(result) {
    const textContent = result.content?.find((entry) => entry.type === "text" && typeof entry.text === "string");
    return textContent?.text;
}
export function extractWarnings(text) {
    return text?.match(/(?:^|\n)Warnings:\n[\s\S]*?(?=\n\nHints:\n|$)/)?.[0]?.trimStart();
}
export function extractHints(text) {
    return text?.match(/(?:^|\n)Hints:\n[\s\S]*$/)?.[0]?.trimStart();
}
export function isApplied(details) {
    const metrics = details?.metrics;
    return (metrics?.classification === "applied" &&
        metrics.added_lines !== undefined &&
        metrics.removed_lines !== undefined);
}
const RESULT_PREVIEW_LINES = 16;
export function expandHint() {
    try {
        return keyHint("app.tools.expand", "to expand");
    }
    catch {
        return "ctrl+o to expand";
    }
}
function extractSummary(text) {
    if (!text)
        return undefined;
    if (text.includes("│"))
        return undefined;
    const noticesIdx = text.search(/\n\n(?:Warnings|Hints):\n/);
    const summary = noticesIdx >= 0 ? text.slice(0, noticesIdx) : text;
    return summary.length > 0 ? summary : undefined;
}
const BATCH_HEADER_RE = /^batch \d+:\n/;
function splitBatchHeader(diff, lineNumbers) {
    const match = diff.match(BATCH_HEADER_RE);
    if (!match)
        return { header: undefined, body: diff, lineNumbers };
    return { header: match[0].slice(0, -1), body: diff.slice(match[0].length), lineNumbers: lineNumbers?.slice(1) };
}
export function buildAppliedText(text, details, theme, expanded) {
    const sections = [];
    const summary = extractSummary(text);
    if (summary)
        sections.push(summary);
    if (details?.diff) {
        const { header, body, lineNumbers } = splitBatchHeader(details.diff, details.diffLineNumbers);
        const rawDiff = lineNumbers ? toNumberedDiff(body, lineNumbers) : body;
        const diffLines = body.split("\n");
        const diffSection = expanded
            ? fmtResult(rawDiff, theme)
            : fmtPreview(rawDiff, false, theme);
        const hint = !expanded && diffLines.length > RESULT_PREVIEW_LINES
            ? ` (${expandHint()})`
            : "";
        sections.push(header !== undefined ? `${theme.fg("warning", header)}\n${diffSection}${hint}` : `${diffSection}${hint}`);
    }
    const warnings = details?.warnings?.length ? `Warnings:\n${details.warnings.join("\n")}` : extractWarnings(text);
    if (warnings)
        sections.push(warnings);
    const hints = details?.hints?.length ? `Hints:\n${details.hints.join("\n")}` : extractHints(text);
    if (hints)
        sections.push(hints);
    return sections.length > 0 ? sections.join("\n\n") : undefined;
}
function trimEmpty(lines) {
    let start = 0;
    let end = lines.length;
    while (start < end && lines[start] === "") {
        start++;
    }
    while (end > start && lines[end - 1] === "") {
        end--;
    }
    return lines.slice(start, end);
}
export function fmtResultMd(text) {
    return trimEmpty(text.split("\n")).join("\n");
}
export function mkMdTheme(theme) {
    return {
        heading: (text) => theme.fg("mdHeading", text),
        link: (text) => theme.fg("mdLink", text),
        linkUrl: (text) => theme.fg("mdLinkUrl", text),
        code: (text) => theme.fg("mdCode", text),
        codeBlock: (text) => theme.fg("mdCodeBlock", text),
        codeBlockBorder: (text) => theme.fg("mdCodeBlockBorder", text),
        quote: (text) => theme.fg("mdQuote", text),
        quoteBorder: (text) => theme.fg("mdQuoteBorder", text),
        hr: (text) => theme.fg("mdHr", text),
        listBullet: (text) => theme.fg("mdListBullet", text),
        bold: (text) => theme.bold(text),
        italic: (text) => (theme.italic ? theme.italic(text) : text),
        underline: (text) => theme.underline ? theme.underline(text) : text,
        strikethrough: (text) => theme.strikethrough ? theme.strikethrough(text) : text,
        highlightCode: (code, lang) => code.split("\n").map((line) => {
            if (lang === "diff") {
                const kind = diffRowKind(line);
                if (kind === "added")
                    return theme.fg("toolDiffAdded", line);
                if (kind === "removed")
                    return theme.fg("toolDiffRemoved", line);
                return theme.fg("toolDiffContext", line);
            }
            return theme.fg("mdCodeBlock", line);
        }),
    };
}
export const PREVIEW_DEBOUNCE_MS = 150;
export function reuseText(context, content) {
    const t = context.lastComponent instanceof Text
        ? context.lastComponent
        : new Text("", 0, 0);
    t.setText(content);
    return t;
}
export function reuseMarkdown(context, content, theme) {
    const m = context.lastComponent instanceof Markdown
        ? context.lastComponent
        : new Markdown("", 0, 0, mkMdTheme(theme));
    m.setText(content);
    return m;
}
export function makeRenderCall(preview, options = {}) {
    const getInput = options.getInput ?? getPreviewInput;
    const toolName = options.toolName ?? "replace";
    return (args, theme, context) => {
        const previewInput = getInput(args);
        if (!context.executionStarted && previewInput) {
            const resolved = options.resolveTarget?.(previewInput);
            context.state.resolvedPath = resolved;
        }
        const cancelPendingPreview = () => {
            if (context.state.previewTimer) {
                clearTimeout(context.state.previewTimer);
                context.state.previewTimer = undefined;
            }
            if (context.state.previewAbort) {
                context.state.previewAbort.abort();
                context.state.previewAbort = undefined;
            }
        };
        if (context.executionStarted) {
            cancelPendingPreview();
            context.state.argsKey = undefined;
            context.state.preview = undefined;
            context.state.previewGeneration = (context.state.previewGeneration ?? 0) + 1;
        }
        else if (!context.argsComplete || !previewInput) {
            cancelPendingPreview();
            context.state.argsKey = undefined;
            context.state.preview = undefined;
            context.state.previewGeneration = (context.state.previewGeneration ?? 0) + 1;
        }
        else {
            const argsKey = JSON.stringify(previewInput);
            if (context.state.argsKey !== argsKey) {
                cancelPendingPreview();
                context.state.argsKey = argsKey;
                context.state.preview = undefined;
                const previewGeneration = (context.state.previewGeneration ?? 0) + 1;
                context.state.previewGeneration = previewGeneration;
                context.state.previewTimer = setTimeout(() => {
                    context.state.previewTimer = undefined;
                    const controller = new AbortController();
                    context.state.previewAbort = controller;
                    preview(args, context.cwd, controller.signal)
                        .then((result) => {
                        if (controller.signal.aborted)
                            return;
                        if (context.state.previewAbort === controller)
                            context.state.previewAbort = undefined;
                        if (context.state.argsKey === argsKey &&
                            context.state.previewGeneration === previewGeneration) {
                            context.state.preview = result;
                            context.invalidate();
                        }
                    })
                        .catch((err) => {
                        if (controller.signal.aborted)
                            return;
                        if (context.state.previewAbort === controller)
                            context.state.previewAbort = undefined;
                        if (context.state.argsKey === argsKey &&
                            context.state.previewGeneration === previewGeneration) {
                            context.state.preview = {
                                error: err instanceof Error ? err.message : String(err),
                            };
                            context.invalidate();
                        }
                    });
                }, PREVIEW_DEBOUNCE_MS);
            }
        }
        const text = context.lastComponent ?? new Text("", 0, 0);
        text.setText(fmtCall(getInput(args) ?? undefined, context.state, context.expanded, theme, toolName));
        return text;
    };
}
export function renderEditResult(result, options, theme, context) {
    const isPartial = typeof options === "boolean" ? options : options.isPartial;
    const optionsExpanded = typeof options === "boolean" ? undefined : options.expanded;
    if (isPartial)
        return reuseText(context, theme.fg("warning", "Editing..."));
    const renderedText = getResultText(result);
    const renderState = context.state;
    if (renderState) {
        if (renderState.previewTimer) {
            clearTimeout(renderState.previewTimer);
            renderState.previewTimer = undefined;
        }
        if (renderState.previewAbort) {
            renderState.previewAbort.abort();
            renderState.previewAbort = undefined;
        }
        renderState.preview = undefined;
        renderState.previewGeneration = (renderState.previewGeneration ?? 0) + 1;
    }
    const batch = result.details?.batch;
    if (batch && batch.last === false) {
        const abortedMessage = typeof context?.toolCallId === "string" ? abortedBatchMessageFor(context.toolCallId) : undefined;
        if (abortedMessage !== undefined) {
            return reuseText(context, `\n${highlightBatchRefs(abortedMessage, theme)}`);
        }
        return reuseText(context, theme.fg("warning", `In batch ${batch.id} (queued)`));
    }
    if (context.isError) {
        return renderedText
            ? reuseText(context, `\n${highlightBatchRefs(renderedText, theme)}`)
            : new Text("", 0, 0);
    }
    if (isApplied(result.details)) {
        const isExpanded = optionsExpanded === true || context.expanded === true;
        const appliedText = buildAppliedText(renderedText, result.details, theme, isExpanded);
        return appliedText ? reuseText(context, appliedText) : new Text("", 0, 0);
    }
    if (!renderedText)
        return new Text("", 0, 0);
    return reuseMarkdown(context, fmtResultMd(renderedText), theme);
}
