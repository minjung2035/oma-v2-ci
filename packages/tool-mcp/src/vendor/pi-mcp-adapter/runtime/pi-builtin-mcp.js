import { readFileSync } from "node:fs";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "./agent-dir.js";
import { loadOnboardingState, updateOnboardingState } from "./onboarding-state.js";
const BUILTIN_MCP = "builtin:mcp";
const ADAPTER_VERSION = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")).version;
/**
 * Once per adapter version, adds `-builtin:mcp` to Pi's user `extensions` unless it already has a
 * `builtin:mcp` entry, such as `pi config`'s `+builtin:mcp`. Returns whether it wrote. Throws on a
 * settings read or write error without recording the version, so the next start retries.
 */
export async function turnOffPiBuiltinMcp() {
    if (loadOnboardingState().piBuiltinMcpHandledVersion === ADAPTER_VERSION)
        return false;
    const settings = SettingsManager.create(process.cwd(), getAgentDir(), { projectTrusted: false });
    throwSettingsError(settings);
    const extensions = settings.getGlobalSettings().extensions ?? [];
    const configured = extensions.some((entry) => entry.replace(/^[+!-]/, "") === BUILTIN_MCP);
    if (!configured) {
        settings.setExtensionPaths([...extensions, `-${BUILTIN_MCP}`]);
        await settings.flush();
        throwSettingsError(settings);
    }
    updateOnboardingState((state) => ({ ...state, piBuiltinMcpHandledVersion: ADAPTER_VERSION }));
    return !configured;
}
function throwSettingsError(settings) {
    const failure = settings.drainErrors()[0];
    if (failure)
        throw new Error(`${failure.path ?? "Pi settings"}: ${failure.error.message}`);
}
