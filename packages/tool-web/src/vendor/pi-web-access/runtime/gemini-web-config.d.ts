declare const BROWSER_COOKIE_PRESETS: readonly ["helium", "chrome", "brave", "arc", "chromium", "edge"];
export type BrowserCookiePreset = typeof BROWSER_COOKIE_PRESETS[number];
export interface BrowserCookieSelection {
    browser?: BrowserCookiePreset;
    profile?: string;
}
export declare function normalizeChromeProfile(value: unknown): string | undefined;
export declare function getBrowserCookieSelectionFromConfig(): BrowserCookieSelection;
export declare function isBrowserCookieAccessAllowed(): boolean;
export {};
