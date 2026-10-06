import type { AgentToolResult, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { type Component, Text } from "@earendil-works/pi-tui";
type McpToolResultDetails = Record<string, unknown> & {
    error?: unknown;
};
export interface RenderTheme {
    fg: (name: string, text: string) => string;
    bold?: (text: string) => string;
}
export interface McpProxyToolCallInput {
    tool?: string;
    args?: string | Record<string, unknown>;
    connect?: string;
    describe?: string;
    search?: string;
    regex?: boolean;
    includeSchemas?: boolean;
    server?: string;
    action?: string;
}
interface McpToolRenderState {
    compactTitle?: string;
    compactInputPreview?: string;
}
export interface McpToolRenderContext {
    isError: boolean;
    isPartial?: boolean;
    expanded?: boolean;
    state?: McpToolRenderState;
}
export type McpToolResultRendering = "compact" | "boxed";
export interface McpToolRenderOptions {
    resultRendering: McpToolResultRendering;
    collapsedResultLines: 1 | 2 | 3;
}
export interface McpToolRenderSettings {
    toolResultRendering?: unknown;
    collapsedResultLines?: unknown;
}
export interface McpToolResultDisplay {
    lines: string[];
    truncated: boolean;
}
declare class EmptyComponent implements Component {
    render(): string[];
    invalidate(): void;
}
declare class CompactMcpToolResult implements Component {
    private readonly title;
    private readonly inputPreview;
    private readonly display;
    private readonly theme;
    /** Shown after the title and never truncated; the title shrinks instead (e.g. `✗3`). */
    private readonly status;
    private rendered;
    constructor(title: string, inputPreview: string, display: McpToolResultDisplay, theme: RenderTheme, 
    /** Shown after the title and never truncated; the title shrinks instead (e.g. `✗3`). */
    status?: string);
    render(width: number): string[];
    invalidate(): void;
    private renderPrefix;
}
declare class CollapsibleText implements Component {
    private readonly text;
    private readonly expanded;
    private readonly maxCollapsedLines;
    private readonly preTruncated;
    private readonly fullText;
    private readonly footerText;
    private collapsedText;
    private collapsedRender;
    constructor(text: string, expanded: boolean, maxCollapsedLines: number, ellipsis: string, expandHint: string, preTruncated?: boolean);
    render(width: number): string[];
    invalidate(): void;
}
export declare function formatMcpProxyToolCallLines(args: McpProxyToolCallInput, maxInputChars?: number): string[];
export declare function formatMcpDirectToolCallLines(displayName: string, args: Record<string, unknown>, maxInputChars?: number): string[];
export declare function formatMcpScriptToolCallLines(args: {
    code: string;
}, maxInputChars?: number): string[];
export declare function resolveMcpToolRenderOptions(settings?: McpToolRenderSettings): McpToolRenderOptions;
export declare function renderMcpProxyToolCall(args: McpProxyToolCallInput, theme?: RenderTheme, context?: McpToolRenderContext): Text | EmptyComponent;
export declare function createMcpProxyToolCallRenderer(options: McpToolRenderOptions): (args: McpProxyToolCallInput, theme?: RenderTheme, context?: McpToolRenderContext) => Text | EmptyComponent;
export declare function createMcpDirectToolCallRenderer(displayName: string, options?: McpToolRenderOptions): (args: Record<string, unknown>, theme?: RenderTheme, context?: McpToolRenderContext) => Text | EmptyComponent;
export declare function createMcpScriptToolCallRenderer(options?: McpToolRenderOptions): (args: {
    code: string;
}, theme?: RenderTheme, context?: McpToolRenderContext) => Text | EmptyComponent;
export interface McpScriptCallSummary {
    /** Traced operations that failed; the compact row shows it as `mcpScript ✗N`. */
    failed: number;
    /** What the script touched; "" when it made no MCP operations. */
    preview: string;
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
export declare function formatMcpScriptCallSummary(details: McpToolResultDetails | undefined, maxTools?: number): McpScriptCallSummary | null;
export declare function formatMcpToolResultIdentity(details: McpToolResultDetails | undefined): string | null;
export declare function formatMcpToolResultLines(result: Pick<AgentToolResult<McpToolResultDetails>, "content">, expanded: boolean, maxCollapsedLines?: number, maxCollapsedChars?: number): McpToolResultDisplay;
export declare function renderMcpToolResult(result: AgentToolResult<McpToolResultDetails>, options: ToolRenderResultOptions, theme?: RenderTheme, context?: McpToolRenderContext, renderOptions?: McpToolRenderOptions): Text | CompactMcpToolResult | CollapsibleText;
export declare function createMcpToolResultRenderer(renderOptions: McpToolRenderOptions): (result: AgentToolResult<McpToolResultDetails>, options: ToolRenderResultOptions, theme?: RenderTheme, context?: McpToolRenderContext) => Text | CompactMcpToolResult | CollapsibleText;
export {};
