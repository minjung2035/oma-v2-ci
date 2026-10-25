import { fileURLToPath } from "node:url";
/** Signed-helper build inputs, never a PATH-selected helper executable. */
export const MAC_HELPER_SOURCES = fileURLToPath(new URL("./vmhelper", import.meta.url));
