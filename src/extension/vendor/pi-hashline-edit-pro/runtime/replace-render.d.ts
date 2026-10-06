import { Markdown, Text } from "@earendil-works/pi-tui";
import { type Theme } from "@earendil-works/pi-coding-agent";
import type { ReplaceDetails } from "./replace.js";
import { getPreviewInput } from "./payload-contract.js";
export { getPreviewInput };
export type FgT = Pick<Theme, "fg">;
export type CallT = Pick<Theme, "fg" | "bold">;
export type MdTheme = Pick<Theme, "fg" | "bold" | "italic" | "underline" | "strikethrough">;
export type RPreview = {
    diff: string;
    path?: string;
} | {
    error: string;
    path?: string;
};
export type RRState = {
    argsKey?: string;
    preview?: RPreview;
    previewGeneration?: number;
    previewTimer?: ReturnType<typeof setTimeout>;
    previewAbort?: AbortController;
    resolvedPath?: string;
};
export declare function colorLines(lines: string[], theme: FgT): string[];
export declare function toNumberedDiff(diff: string, lineNumbers: (number | null | undefined)[]): string;
export declare function fmtPreview(diff: string, expanded: boolean, theme: FgT): string;
export declare function fmtResult(diff: string, theme: FgT): string;
export declare function highlightBatchRefs(text: string, theme: FgT): string;
export declare function fmtCall(args: {
    path?: string;
    remove_from?: string;
    remove_to?: string;
    anchor?: string;
    source_from?: string;
    source_to?: string;
    insert_after?: string;
    replace_from?: string;
    replace_to?: string;
} | undefined, state: RRState, expanded: boolean, theme: CallT, toolName?: string): string;
export declare function getResultText(result: {
    content?: Array<{
        type: string;
        text?: string;
    }>;
}): string | undefined;
export declare function extractWarnings(text: string | undefined): string | undefined;
export declare function extractHints(text: string | undefined): string | undefined;
export declare function isApplied(details: ReplaceDetails | undefined): boolean;
export declare function expandHint(): string;
export declare function buildAppliedText(text: string | undefined, details: ReplaceDetails | undefined, theme: FgT, expanded: boolean): string | undefined;
export declare function fmtResultMd(text: string): string;
export declare function mkMdTheme(theme: MdTheme): {
    heading: (text: string) => string;
    link: (text: string) => string;
    linkUrl: (text: string) => string;
    code: (text: string) => string;
    codeBlock: (text: string) => string;
    codeBlockBorder: (text: string) => string;
    quote: (text: string) => string;
    quoteBorder: (text: string) => string;
    hr: (text: string) => string;
    listBullet: (text: string) => string;
    bold: (text: string) => string;
    italic: (text: string) => string;
    underline: (text: string) => string;
    strikethrough: (text: string) => string;
    highlightCode: (code: string, lang?: string) => string[];
};
export declare const PREVIEW_DEBOUNCE_MS = 150;
export declare function reuseText(context: any, content: string): Text;
export declare function reuseMarkdown(context: any, content: string, theme: any): Markdown;
export declare function makeRenderCall(preview: (args: unknown, cwd: string, signal?: AbortSignal) => Promise<RPreview>, options?: {
    getInput?: (args: unknown) => {
        path?: string;
        remove_from?: string;
        remove_to?: string;
        anchor?: string;
        source_from?: string;
        source_to?: string;
        insert_after?: string;
        replace_from?: string;
        replace_to?: string;
    } | null;
    toolName?: string;
    resolveTarget?: (input: {
        remove_from?: string;
        remove_to?: string;
        anchor?: string;
        source_from?: string;
        source_to?: string;
        insert_after?: string;
        replace_from?: string;
        replace_to?: string;
    }) => string | undefined;
}): (args: any, theme: CallT, context: any) => Text;
export declare function renderEditResult(result: {
    content?: Array<{
        type: string;
        text?: string;
    }>;
    details?: ReplaceDetails;
}, options: {
    isPartial: boolean;
    expanded?: boolean;
} | boolean, theme: FgT, context: any): Text | Markdown;
