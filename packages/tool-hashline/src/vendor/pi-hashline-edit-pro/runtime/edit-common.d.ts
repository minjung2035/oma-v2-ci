import { type RPreview, type FgT } from "./replace-render.js";
import type { ReplaceDetails } from "./replace.js";
export declare const editPrepare: (args: unknown) => any;
export interface EditToolFlags {
    requirePath: boolean;
    strictInput: boolean;
    autoRead: boolean;
    autoReadAllActive: boolean;
    replaceWithinEnabled: boolean;
    copyMoveEnabled: boolean;
}
export declare const DEFAULT_EDIT_FLAGS: EditToolFlags;
export declare function currentEditFlags(): Promise<EditToolFlags>;
export declare function withReplacePrompts(base: {
    description: string;
    snippet: string;
    guidelines: string[];
}, flags: EditToolFlags): {
    description: string;
    snippet: string;
    guidelines: string[];
};
export declare function withReadPrompts(base: {
    description: string;
    snippet: string;
    guidelines: string[];
}, flags: EditToolFlags): {
    description: string;
    snippet: string;
    guidelines: string[];
};
export declare function withInsertPrompts(base: {
    description: string;
    snippet: string;
    guidelines: string[];
}, flags: EditToolFlags): {
    description: string;
    snippet: string;
    guidelines: string[];
};
export declare function withReplaceWithinPrompts(base: {
    description: string;
    snippet: string;
    guidelines: string[];
}, flags: EditToolFlags): {
    description: string;
    snippet: string;
    guidelines: string[];
};
export declare function withGrepPrompts(base: {
    description: string;
    snippet: string;
}, flags: EditToolFlags): {
    description: string;
    snippet: string;
};
export declare function withUndoPrompts(base: {
    description: string;
    snippet: string;
    guidelines: string[];
}, flags: EditToolFlags): {
    description: string;
    snippet: string;
    guidelines: string[];
};
export declare function withTransferPrompts(base: {
    description: string;
    snippet: string;
    guidelines: string[];
}, flags: EditToolFlags): {
    description: string;
    snippet: string;
    guidelines: string[];
};
export declare function resolveEditTarget(removeFrom: string, removeTo?: string): string;
export declare function tryResolveEditTarget(removeFrom: string | undefined, removeTo?: string): string | undefined;
export interface PathRequirementInput {
    removeFrom?: string;
    removeTo?: string;
    anchor?: string;
    providedPath?: unknown;
    cwd: string;
}
export declare function resolveEditTargetWithRequirement(input: PathRequirementInput): Promise<string>;
export declare function throwIfStrictInput(warnings: string[]): Promise<void>;
export declare function editRenderCallWrapper(preview: (args: unknown, cwd: string, signal?: AbortSignal) => Promise<RPreview>, getInput?: (args: unknown) => {
    path?: string;
} | null, toolName?: string): (args: any, theme: import("./replace-render.js").CallT, context: any) => import("@earendil-works/pi-tui").Text;
export declare function editRenderResultWrapper(result: {
    content?: Array<{
        type: string;
        text?: string;
    }>;
    details?: ReplaceDetails;
}, opts: {
    isPartial: boolean;
    expanded?: boolean;
} | boolean, theme: FgT, context: any): import("@earendil-works/pi-tui").Text | import("@earendil-works/pi-tui").Markdown;
export declare const editToolBase: {
    prepareArguments: (args: unknown) => any;
    executionMode: "sequential";
    renderShell: "default";
};
export declare function queuedEdit<T>(path: string, cwd: string, signal: AbortSignal | undefined, work: (absolute: string, resolved: string) => Promise<T>): Promise<T>;
