import { type BrowserCookiePreset } from "./gemini-web-config.js";
export type CookieMap = Record<string, string>;
export type BrowserCookieAttemptStatus = "missing-database" | "missing-required-cookies" | "password-read-failed" | "decryption-failed" | "sqlite-unavailable" | "sqlite-query-failed" | "unsafe-profile" | "no-host-cookies";
export interface BrowserCookieAttemptDiagnostic {
    browser: string;
    profile: string;
    status: BrowserCookieAttemptStatus;
}
export interface BrowserCookieDiagnosticDetails {
    message: string;
    attempts: BrowserCookieAttemptDiagnostic[];
}
export declare function getLastGoogleCookieDiagnostic(): string | null;
export declare function getLastBrowserCookieDiagnostic(): string | null;
export declare function getLastGoogleCookieDiagnosticDetails(): BrowserCookieDiagnosticDetails | null;
export declare function getGoogleCookies(options?: {
    browser?: BrowserCookiePreset;
    profile?: string;
    requiredCookies?: string[];
}): Promise<{
    cookies: CookieMap;
    warnings: string[];
} | null>;
export declare function getBrowserCookiesForHosts(options: {
    hosts: string[];
    browser?: BrowserCookiePreset;
    profile?: string;
    requiredCookies?: string[];
    cookieNames?: Iterable<string>;
    requiredLabel?: string;
    requestUrl?: URL;
}): Promise<{
    cookies: CookieMap;
    warnings: string[];
    cookieHeader?: string;
} | null>;
