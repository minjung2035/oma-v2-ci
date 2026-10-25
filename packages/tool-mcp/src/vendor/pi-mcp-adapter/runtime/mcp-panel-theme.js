import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
export class McpPanelFrame {
    theme;
    left;
    right;
    title;
    border;
    constructor(theme, left, right, title) {
        this.theme = theme;
        this.left = left;
        this.right = right;
        this.title = title;
        this.border = new DynamicBorder((text) => this.theme.border(text));
    }
    render(width) {
        if (width <= 0)
            return [];
        if (width === 1)
            return [truncateToWidth(this.theme.border(this.left), width, "", false)];
        const innerWidth = width - 2;
        if (this.title !== undefined) {
            const titleText = truncateToWidth(` ${this.title} `, innerWidth, "", false);
            const borderLength = Math.max(0, innerWidth - visibleWidth(titleText));
            const leftLength = Math.floor(borderLength / 2);
            const rightLength = borderLength - leftLength;
            return [
                this.theme.border(this.left) +
                    this.renderBorderSegment(leftLength) +
                    this.theme.title(titleText) +
                    this.renderBorderSegment(rightLength) +
                    this.theme.border(this.right),
            ];
        }
        return [
            this.theme.border(this.left) +
                this.renderBorderSegment(innerWidth) +
                this.theme.border(this.right),
        ];
    }
    invalidate() {
        this.border.invalidate();
    }
    renderBorderSegment(width) {
        if (width <= 0)
            return "";
        return this.border.render(width)[0] ?? "";
    }
}
const identity = (text) => text;
const PLAIN_THEME = {
    border: identity,
    title: identity,
    selected: identity,
    direct: identity,
    needsAuth: identity,
    placeholder: identity,
    description: identity,
    hint: identity,
    confirm: identity,
    cancel: identity,
    bold: identity,
    italic: identity,
    inverse: identity,
};
export function createMcpPanelTheme(theme) {
    if (!theme)
        return PLAIN_THEME;
    return {
        border: (text) => theme.fg("border", text),
        title: (text) => theme.fg("accent", text),
        selected: (text) => theme.fg("accent", text),
        direct: (text) => theme.fg("success", text),
        needsAuth: (text) => theme.fg("warning", text),
        placeholder: (text) => theme.fg("dim", text),
        description: (text) => theme.fg("muted", text),
        hint: (text) => theme.fg("dim", text),
        confirm: (text) => theme.fg("success", text),
        cancel: (text) => theme.fg("error", text),
        bold: (text) => theme.bold(text),
        italic: (text) => theme.italic(text),
        inverse: (text) => theme.inverse(text),
    };
}
