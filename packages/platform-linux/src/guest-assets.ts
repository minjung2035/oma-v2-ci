/** Original guest image assets, owned and shipped by the Linux adapter. */
import { fileURLToPath } from "node:url";
export const GUEST_IMAGE_ASSETS = fileURLToPath(new URL("./guest", import.meta.url));
