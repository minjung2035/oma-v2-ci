export type AuthFetchRequest = true | string;
export type AuthFetchCache = "session" | "off";
export interface AuthFetchProfile {
    name: string;
    hosts: string[];
    chromeProfile?: string;
    redirects: "same-origin";
    cache: AuthFetchCache;
}
export declare function resolveAuthFetchProfile(request: AuthFetchRequest): AuthFetchProfile;
export declare function assertAuthFetchUrl(profile: AuthFetchProfile, rawUrl: string): URL;
export declare function authFetchRedirectGuard(profile: AuthFetchProfile, from: URL, to: URL): void;
