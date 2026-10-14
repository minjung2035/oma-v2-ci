import { type Theme } from "@earendil-works/pi-coding-agent";
import { type Component } from "@earendil-works/pi-tui";
export declare class McpPanelFrame implements Component {
    private readonly theme;
    private readonly left;
    private readonly right;
    private readonly title?;
    private readonly border;
    constructor(theme: McpPanelTheme, left: string, right: string, title?: string | undefined);
    render(width: number): string[];
    invalidate(): void;
    private renderBorderSegment;
}
export interface McpPanelTheme {
    border(text: string): string;
    title(text: string): string;
    selected(text: string): string;
    direct(text: string): string;
    needsAuth(text: string): string;
    placeholder(text: string): string;
    description(text: string): string;
    hint(text: string): string;
    confirm(text: string): string;
    cancel(text: string): string;
    bold(text: string): string;
    italic(text: string): string;
    inverse(text: string): string;
}
export declare function createMcpPanelTheme(theme?: Theme): McpPanelTheme;
