/** App selection of the receipt horizon from actual current society configuration. */
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "@oma/config";
import type { ReceiptWaitFloor } from "@oma/contracts/guest-control";
/** The shortest `limits.receiptWaitSeconds` among the societies whose state
 * roots are under `societiesDir` (each `<society>/config.json`, the layout
 * `hostLaunchLocation` gives the guest's `oma`). A state root without a
 * configuration has no broker to wait on; one whose configuration does not
 * load makes the answer unknown. */
export function receiptWaitFloor(societiesDir: string): ReceiptWaitFloor {
  let names: string[];
  try { names = readdirSync(societiesDir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name); }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? { kind: "none" } : { kind: "unknown" }; }
  let floor: number | null = null;
  for (const name of names) {
    const configPath = join(societiesDir, name, "config.json");
    try { if (lstatSync(configPath, { throwIfNoEntry: false }) === undefined) continue; }
    catch { return { kind: "unknown" }; }
    let seconds: number;
    try { seconds = loadConfig(configPath).limits.receiptWaitSeconds; }
    catch { return { kind: "unknown" }; }
    floor = floor === null ? seconds * 1000 : Math.min(floor, seconds * 1000);
  }
  return floor === null ? { kind: "none" } : { kind: "known", ms: floor };
}

