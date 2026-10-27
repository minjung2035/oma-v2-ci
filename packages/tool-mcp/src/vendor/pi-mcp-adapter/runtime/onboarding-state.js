import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { getAgentPath } from "./agent-dir.js";
const DEFAULT_STATE = {
    version: 1,
    sharedConfigHintShown: false,
    setupCompleted: false,
};
export function getOnboardingStatePath() {
    return getAgentPath("mcp-onboarding.json");
}
export function loadOnboardingState() {
    const path = getOnboardingStatePath();
    if (!existsSync(path))
        return { ...DEFAULT_STATE };
    try {
        const raw = JSON.parse(readFileSync(path, "utf-8"));
        if (!raw || typeof raw !== "object")
            return { ...DEFAULT_STATE };
        return {
            version: 1,
            sharedConfigHintShown: raw.sharedConfigHintShown === true,
            setupCompleted: raw.setupCompleted === true,
            ...(typeof raw.lastDiscoveryFingerprint === "string"
                ? { lastDiscoveryFingerprint: raw.lastDiscoveryFingerprint }
                : {}),
            ...(Array.isArray(raw.piSignInImportsAsked)
                ? {
                    piSignInImportsAsked: raw.piSignInImportsAsked.filter((entry) => typeof entry?.server === "string" && typeof entry.url === "string"),
                }
                : {}),
            ...(typeof raw.piBuiltinMcpHandledVersion === "string"
                ? { piBuiltinMcpHandledVersion: raw.piBuiltinMcpHandledVersion }
                : {}),
        };
    }
    catch {
        return { ...DEFAULT_STATE };
    }
}
export function saveOnboardingState(state) {
    const path = getOnboardingStatePath();
    mkdirSync(dirname(path), { recursive: true });
    const tmpPath = `${path}.${process.pid}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
    renameSync(tmpPath, path);
}
export function updateOnboardingState(updater) {
    const next = updater(loadOnboardingState());
    saveOnboardingState(next);
    return next;
}
export function markSharedConfigHintShown(fingerprint) {
    return updateOnboardingState((state) => {
        const lastDiscoveryFingerprint = fingerprint ?? state.lastDiscoveryFingerprint;
        return {
            ...state,
            sharedConfigHintShown: true,
            ...(lastDiscoveryFingerprint !== undefined ? { lastDiscoveryFingerprint } : {}),
        };
    });
}
export function markSetupCompleted(fingerprint) {
    return updateOnboardingState((state) => {
        const lastDiscoveryFingerprint = fingerprint ?? state.lastDiscoveryFingerprint;
        return {
            ...state,
            setupCompleted: true,
            ...(lastDiscoveryFingerprint !== undefined ? { lastDiscoveryFingerprint } : {}),
        };
    });
}
export function markPiSignInImportAsked(server, url) {
    return updateOnboardingState((state) => ({
        ...state,
        piSignInImportsAsked: [...(state.piSignInImportsAsked ?? []), { server, url }],
    }));
}
