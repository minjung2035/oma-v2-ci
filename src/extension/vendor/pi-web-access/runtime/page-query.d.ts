import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
export interface PageAnswer {
    text: string;
    model: string;
    inputChars: number;
    originalInputChars: number;
    truncated: boolean;
}
export declare function answerFromPage(input: {
    question: string;
    pageText: string;
    sourceUrl: string;
    model?: string;
}, ctx: ExtensionContext, signal?: AbortSignal): Promise<PageAnswer>;
