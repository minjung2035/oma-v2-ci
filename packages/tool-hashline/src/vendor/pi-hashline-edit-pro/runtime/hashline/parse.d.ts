import type { LineEnding } from "../normalize.js";
export type Anchor = {
    hash: string;
};
export declare function parseHashRef(ref: string): Anchor;
export interface ParsedText {
    lines: string[];
    separators: (LineEnding | undefined)[];
}
export declare function parseTextWithSeparators(edit: string[]): ParsedText;
export declare function parseText(edit: string[]): string[];
export declare function parsePayloadText(text: string): ParsedText;
