import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
/** Signed-helper build inputs, never a PATH-selected helper executable. */
export const MAC_HELPER_SOURCES = dirname(fileURLToPath(new URL("./keychain/main.swift", import.meta.url)));
