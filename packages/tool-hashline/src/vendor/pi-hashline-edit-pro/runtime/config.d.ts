export type AutoReadAllMode = "off" | "on" | "git";
export declare const DEFAULT_DIFF_CONTEXT_LINES = 1;
export declare const MIN_DIFF_CONTEXT_LINES = 0;
export declare const MAX_DIFF_CONTEXT_LINES = 10;
export interface Config {
    autoRead: boolean;
    anchorGrepEnabled: boolean;
    copyMoveEnabled?: boolean;
    replaceWithinEnabled?: boolean;
    autoReadAll?: AutoReadAllMode;
    autoReadAllIgnore?: string[];
    requirePath?: boolean;
    strictInput?: boolean;
    diffContextLines?: number;
}
export declare function normalizeAutoReadAllIgnoreEntry(entry: string): string;
export declare function parseAutoReadAllIgnore(value: unknown): string[];
export declare function normalizeDiffContextLines(value: unknown): number;
export declare function readConfig(): Promise<Config>;
export declare function readConfigWithStatus(): Promise<{
    config: Config;
    corrupted: boolean;
}>;
export declare function updateConfig(mut: (config: Config) => void): Promise<Config>;
export declare function writeConfig(config: Config): Promise<void>;
export declare const toggleAutoRead: () => Promise<boolean>;
export declare const toggleAnchorGrep: () => Promise<boolean>;
export declare const toggleCopyMove: () => Promise<boolean>;
export declare const toggleReplaceWithin: () => Promise<boolean>;
export declare function cycleAutoReadAllMode(): Promise<AutoReadAllMode>;
export declare const toggleRequirePath: () => Promise<boolean>;
export declare const toggleStrictInput: () => Promise<boolean>;
export declare function getDiffContextLines(): Promise<number>;
export declare function adjustDiffContextLines(delta: number): Promise<number>;
export declare function setAutoReadAllIgnore(dirs: string[]): Promise<string[]>;
export declare function setAutoReadAllIgnoreFromText(text: string): Promise<string[]>;
