/** Package-owned native image paths; no process or role is created here. */
import { fileURLToPath } from "node:url";
export function bundledSeatbeltHelper(): string { return fileURLToPath(new URL("./seatbelt/oma-seatbelt", import.meta.url)); }
