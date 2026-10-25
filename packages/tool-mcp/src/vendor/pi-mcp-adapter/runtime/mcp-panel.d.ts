import { type Theme } from "@earendil-works/pi-coding-agent";
import { type PanelKeybindings } from "./panel-keys.js";
import type { McpConfig, McpPanelCallbacks, McpPanelResult, ServerProvenance } from "./types.js";
import { type MetadataCache } from "./metadata-cache.js";
declare class McpPanel {
    private config;
    private cache;
    private callbacks;
    private done;
    private noticeLines;
    private prefix;
    private servers;
    private cursorIndex;
    private nameQuery;
    private descSearchActive;
    private descQuery;
    private dirty;
    private confirmingDiscard;
    private discardSelected;
    private importNotice;
    private authNotice;
    private authInFlight;
    private piSignInsImported;
    private inactivityTimeout;
    private visibleItems;
    private tui;
    private readonly view;
    private authOnly;
    private keys;
    static readonly MAX_VISIBLE = 12;
    private static readonly INACTIVITY_MS;
    constructor(config: McpConfig, cache: MetadataCache | null, provenance: Map<string, ServerProvenance>, callbacks: McpPanelCallbacks, tui: {
        requestRender(): void;
    }, done: (result: McpPanelResult) => void, options?: {
        noticeLines?: string[];
        authOnly?: boolean;
        keybindings?: PanelKeybindings;
        theme?: Theme;
    });
    private resetInactivityTimeout;
    private cleanup;
    private rebuildVisibleItems;
    private updateDirty;
    private buildResult;
    handleInput(data: string): void;
    private authenticateSelectedServer;
    private importPiSignIns;
    private authenticateServer;
    private reconnectServer;
    private toggleItem;
    private toggleToolDirect;
    private handleDiscardInput;
    private moveCursor;
    private getOtherCurrentCandidates;
    private rebuildServerTools;
    private getViewState;
    render(width: number): string[];
    invalidate(): void;
    dispose(): void;
}
export declare function createMcpPanel(config: McpConfig, cache: MetadataCache | null, provenance: Map<string, ServerProvenance>, callbacks: McpPanelCallbacks, tui: {
    requestRender(): void;
}, done: (result: McpPanelResult) => void, options?: {
    noticeLines?: string[];
    authOnly?: boolean;
    keybindings?: PanelKeybindings;
    theme?: Theme;
}): McpPanel & {
    dispose(): void;
};
export {};
