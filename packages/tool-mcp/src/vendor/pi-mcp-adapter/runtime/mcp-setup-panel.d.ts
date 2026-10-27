import type { Theme } from "@earendil-works/pi-coding-agent";
import { type PanelKeybindings } from "./panel-keys.js";
import type { ImportKind } from "./types.js";
import type { ConfigWritePreview, KnownServerPreset, McpDiscoverySummary, SharedConfigTarget } from "./config.js";
import type { McpOnboardingState } from "./onboarding-state.js";
export interface SetupPanelCallbacks {
    previewImports: (imports: ImportKind[]) => ConfigWritePreview;
    previewStarterConfig: (target: SharedConfigTarget) => ConfigWritePreview;
    previewRepoPrompt: (target: SharedConfigTarget) => ConfigWritePreview | null;
    previewKnownServer: (preset: KnownServerPreset, target: SharedConfigTarget) => ConfigWritePreview;
    adoptImports: (imports: ImportKind[]) => Promise<{
        added: ImportKind[];
        path: string;
    }>;
    scaffoldConfig: (target: SharedConfigTarget) => Promise<{
        path: string;
    }>;
    addRepoPrompt: (target: SharedConfigTarget) => Promise<{
        path: string;
        serverName: string;
    }>;
    addKnownServer: (preset: KnownServerPreset, target: SharedConfigTarget) => Promise<{
        path: string;
        serverName: string;
        reachable?: boolean;
        ignoredBecause?: string;
    }>;
    openPath: (path: string) => Promise<void>;
    markSetupCompleted: () => void;
}
export interface SetupPanelOptions {
    mode: "empty" | "setup";
    onboardingState: McpOnboardingState;
    keybindings?: PanelKeybindings;
    theme?: Theme;
}
/** The subset of Pi's TUI the setup panel uses. `terminal` sizes the panel to the screen. */
export interface SetupPanelTui {
    requestRender(): void;
    terminal?: {
        rows: number;
    };
}
export declare class McpSetupPanel {
    private discovery;
    private callbacks;
    private options;
    private readonly tui;
    private done;
    private screen;
    private actionCursor;
    private importCursor;
    private pathCursor;
    private sharedConfigTarget;
    private selectedImports;
    private busy;
    private detailScroll;
    private notice;
    private readonly view;
    private readonly keys;
    private inactivityTimeout;
    private static readonly INACTIVITY_MS;
    constructor(discovery: McpDiscoverySummary, callbacks: SetupPanelCallbacks, options: SetupPanelOptions, tui: SetupPanelTui, done: () => void);
    private resetInactivityTimeout;
    private cleanup;
    private getActions;
    private getDetectedPaths;
    private sharedTargetLabel;
    private selectedSharedConfigExists;
    handleInput(data: string): void;
    private handleDetailScroll;
    private handleImportsInput;
    private handlePathsInput;
    private runAction;
    private applySelectedImports;
    private runBusy;
    private getViewState;
    render(width: number): string[];
    invalidate(): void;
    dispose(): void;
}
export declare function createMcpSetupPanel(discovery: McpDiscoverySummary, callbacks: SetupPanelCallbacks, options: SetupPanelOptions, tui: SetupPanelTui, done: () => void): McpSetupPanel & {
    dispose(): void;
};
