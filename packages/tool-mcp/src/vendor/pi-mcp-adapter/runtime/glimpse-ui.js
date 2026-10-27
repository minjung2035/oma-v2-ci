import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { omaAmbientEnv, omaRequirePermit } from "./utils.js";
import { join, dirname } from "node:path";
import { platform } from "node:os";
import { createRequire } from "node:module";
let glimpseAvailable = null;
let resolvedBinaryPath = null;
export function isGlimpseAvailable() {
    if (glimpseAvailable !== null)
        return glimpseAvailable;
    if (platform() !== "darwin") {
        glimpseAvailable = false;
        return false;
    }
    resolvedBinaryPath = getGlimpseBinaryPath();
    glimpseAvailable = resolvedBinaryPath !== null;
    return glimpseAvailable;
}
function getGlimpseBinaryPath() {
    omaRequirePermit("ui-session", "Glimpse viewer resolution");
    if (omaAmbientEnv().GLIMPSE_BINARY && existsSync(omaAmbientEnv().GLIMPSE_BINARY)) {
        return omaAmbientEnv().GLIMPSE_BINARY;
    }
    // Local node_modules
    try {
        const require = createRequire(import.meta.url);
        const glimpseuiPath = require.resolve("glimpseui");
        const binaryPath = join(dirname(glimpseuiPath), "glimpse");
        if (existsSync(binaryPath))
            return binaryPath;
    }
    catch { }
    // Global npm install
    try {
        const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf-8" }).trim();
        const binaryPath = join(globalRoot, "glimpseui", "src", "glimpse");
        if (existsSync(binaryPath))
            return binaryPath;
    }
    catch { }
    return null;
}
export async function openGlimpseWindow(html, options) {
    omaRequirePermit("ui-session", "Glimpse window");
    const modulePath = resolvedBinaryPath
        ? join(dirname(resolvedBinaryPath), "glimpse.mjs")
        : "glimpseui";
    const glimpse = await import(modulePath);
    let active = true;
    const win = glimpse.open(html, {
        width: options.width ?? 900,
        height: options.height ?? 700,
        title: options.title,
    });
    win.on("closed", () => {
        if (!active)
            return;
        active = false;
        options.onClosed();
    });
    return {
        close: () => {
            if (!active)
                return;
            active = false;
            win.close();
        },
    };
}
