import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type LineEnding } from "./normalize.js";
import { type EditToolFlags } from "./edit-common.js";
export interface UndoEntry {
    content: string;
    bom: string;
    originalEnding: LineEnding;
    separators?: LineEnding[];
    hashes: string[];
    resultContent: string;
    resultSeparators?: LineEnding[];
    mode?: number;
}
export declare function saveUndo(path: string, entry: UndoEntry): Promise<{
    persisted: boolean;
    restore: () => Promise<void>;
}>;
export declare function getUndo(path: string): Promise<UndoEntry | undefined>;
export declare function clearUndo(path: string): Promise<void>;
export declare function regUndo(pi: ExtensionAPI, flags?: EditToolFlags): void;
