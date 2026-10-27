import { type HashStore } from "./hash-store.js";
export type RegistryEvent = {
    kind: "session";
    sessionFile: string;
} | {
    kind: "allocate";
    path: string;
    rows: [string, string][];
} | {
    kind: "free";
    path: string;
    anchors?: string[];
} | {
    kind: "minted";
    anchors: string[];
} | {
    kind: "clear";
};
export interface OwnedAnchor {
    path: string;
    checksum: string;
}
export interface AnchorSessionContext {
    sessionManager?: {
        getSessionFile?: () => string | undefined;
        getSessionId?: () => string;
    };
}
interface OwnedAnchorMap {
    readonly size: number;
    has(anchor: string): boolean;
    get(anchor: string): OwnedAnchor | undefined;
    set(anchor: string, entry: OwnedAnchor): unknown;
    delete(anchor: string): boolean;
    clear(): void;
    keys(): Iterable<string>;
    values(): Iterable<OwnedAnchor>;
    entries(): Iterable<[string, OwnedAnchor]>;
    [Symbol.iterator](): IterableIterator<[string, OwnedAnchor]>;
}
interface AnchorMintedSet {
    has(anchor: string): boolean;
    add(anchor: string): unknown;
    [Symbol.iterator](): IterableIterator<string>;
}
interface SessionState {
    owned: OwnedAnchorMap;
    served: Map<string, Map<string, string>>;
    everMinted: AnchorMintedSet;
    probe: number;
    allocatedChecksum: Map<string, string>;
    lastUsedAt: Map<string, number>;
    usageClock: number;
    reclaimed: string[];
    shadow?: boolean;
}
export declare const SIDECAR_COMPACT_LINE_BYTES: number;
export declare const SIDECAR_HEADER_BYTES: number;
export declare function foldRegistryEvents(events: RegistryEvent[], seed?: string): SessionState;
export declare function parseRegistryLog(raw: string): RegistryEvent[];
export declare function shouldCompactSidecar(raw: string): boolean;
export declare function buildCompactedLog(sessionFile: string, state: SessionState): string;
export declare function initRegistry(sessionFile: string | undefined): Promise<string>;
export declare function sessionKeyFor(ctx: AnchorSessionContext | undefined): string | undefined;
export declare function withAnchorSession<T>(ctx: AnchorSessionContext | undefined, fn: () => Promise<T> | T): Promise<T>;
export declare const MINT_PROBE_LIMIT = 8192;
export declare function reclaimAnchorSpace(state: SessionState, protectPath?: string): string | undefined;
export declare function mintAnchor(state: SessionState, protectPath?: string): string;
export declare function takeReclaimedPaths(): string[];
export declare function formatAnchorReclaimNotice(paths: string[]): string | undefined;
export declare function allocateAnchor(path: string, checksum: string): string;
export declare function freeAnchors(path: string, anchors?: string[]): void;
export declare function clearRegistry(): void;
export declare function servedForPath(path: string): Map<string, string> | undefined;
export declare function markServed(path: string, entries: Array<[string, string]>, scope?: ReadonlySet<string>): void;
export declare function ownerOf(anchor: string): OwnedAnchor | undefined;
export interface CaseFoldedOwner {
    anchor: string;
    path: string;
}
export declare function ownersDifferingOnlyByCase(anchor: string, paths?: ReadonlySet<string>): CaseFoldedOwner[];
export declare function ownersForPath(path: string): Map<string, string>;
export declare function ensureRegistry(): void;
export declare function shadowStateFrom(state: SessionState): SessionState;
export interface Aligned {
    anchors: string[];
    freed: string[];
    minted: string[];
}
export declare function alignOwnershipWithSpans(path: string, prevAnchors: string[], prevChecksums: string[], newChecksums: string[], spans: {
    start: number;
    end: number;
    replacementCount: number;
    carry?: number;
}[], options?: {
    shadow?: boolean;
}): Aligned;
export declare function alignOwnership(path: string, prevAnchors: string[] | undefined, prevChecksums: string[] | undefined, newChecksums: string[], options?: {
    shadow?: boolean;
}): Aligned;
export declare function allocateFileAnchors(store: HashStore, path: string, content: string, options?: {
    persist?: boolean;
    shadow?: boolean;
    previous?: {
        content: string;
        hashes: string[];
        spans?: {
            start: number;
            end: number;
            replacementCount: number;
            carry?: number;
        }[];
    };
}): Promise<string[]>;
export declare function adoptAnchors(path: string, entries: Map<string, string>): void;
export declare function resetRegistryForTests(): void;
export declare function readSidecarHeader(sidecar: string): Promise<string>;
export declare function readSidecarSessionFile(sidecar: string): Promise<string | undefined>;
export declare function releaseRegistrySession(key: string): void;
export declare function gcRegistrySidecars(): Promise<void>;
export {};
