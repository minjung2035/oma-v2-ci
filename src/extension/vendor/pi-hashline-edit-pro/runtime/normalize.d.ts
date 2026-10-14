export type LineEnding = "\r\n" | "\n" | "\r";
export declare function detectEnding(content: string): LineEnding;
export declare function toLF(text: string): string;
export declare function restoreEndings(text: string, ending: LineEnding): string;
export declare function stripBOM(content: string): {
    bom: string;
    text: string;
};
