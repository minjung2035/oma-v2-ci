import { type KeyId } from "@earendil-works/pi-tui";
/** The panel keybinding ids the adapter panels resolve through pi-tui. */
export type PanelSelectKeybinding = "tui.select.up" | "tui.select.down" | "tui.select.confirm";
/** Structural subset of pi-tui's `KeybindingsManager` (which satisfies it). */
export interface PanelKeybindings {
    matches(data: string, keybinding: PanelSelectKeybinding): boolean;
    getUserBindings?(): Record<string, KeyId | KeyId[] | undefined>;
}
/**
 * Key matchers for panel actions: user bindings when a manager is provided,
 * otherwise the previous hardcoded defaults.
 */
export interface PanelKeys {
    selectUp(data: string): boolean;
    selectDown(data: string): boolean;
    selectConfirm(data: string): boolean;
    save(data: string): boolean;
    saveLabel(): string | null;
}
export declare function createPanelKeys(keybindings?: PanelKeybindings): PanelKeys;
